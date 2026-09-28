# PLANO DE EXECUÇÃO — alexa-agente

| Campo | Valor |
|---|---|
| **Tarefa** | `alexa-agente` |
| **Origem** | Descrição livre (prompt de arquitetura + rodadas de perguntas) |
| **Tipo** | História (arquitetura + funcionalidade) |
| **Modo de execução** | 💬 Interativo |
| **Data** | 2026-09-28 |
| **Branch** | `feature/agente-e-comunicacao-websocket` |

---

## 1. Enunciado Canônico

- **Problema:** a skill é um "Hello World" e não há nenhum caminho seguro entre a Alexa e o PC.
- **Resultado esperado:** "Alexa, pede para o monstro <ação>" → a skill resolve a fala para um `actionId`
  de uma lista fechada, pede confirmação por voz se a ação for sensível, envia uma mensagem assinada pelo
  broker MQTT, o agente no PC valida e executa **somente** o que está em `actions.json` e devolve um ack
  assinado; a Alexa diz **"Feito."** ou **"Não consegui executar essa ação."**
- **Como validar:** `npm test` verde nos dois pacotes (lambda e agent) + simulação local ponta a ponta
  (script que faz o papel da Lambda publicando no HiveMQ real → agente executa ação inofensiva → ack volta).

## 2. Escopo

**Vou fazer:**
- Lambda (Alexa-hosted) em pt-BR: intents, resolução slot → `actionId`, confirmação por voz, segredos
  lidos do S3 da skill, envio MQTT + espera de ack, tratamento global de erro sem PII.
- Protocolo compartilhado: mensagem `cmd` e `ack` assinadas (HMAC-SHA256), expiração curta, `requestId` único.
- Catálogo em duas partes sincronizadas por script + teste.
- Agente Windows em duas partes: **núcleo** (inicia com o Windows, antes do logon) e **sessão de desktop**
  (inicia no logon: ícone na bandeja + ações de tela), ligados por *named pipe* local autenticado.
- **Um único executável** `o-monstro.exe` (Node SEA) que é agente **e** instalador (`o-monstro.exe` sem
  argumentos → assistente de instalação com elevação de administrador).
- Testes unitários e de integração (transporte em memória).
- `CLAUDE.md`, `.gitignore`, `.env.example`, README.

**NÃO vou fazer (escopo negativo)** [#8]:
- Publicar/deployar a skill (combinado: "depois vemos a publicação").
- Jira, CI/CD, assinatura digital do `.exe` (certificado pago).
- Ações de "apagar arquivos" (não pedidas no kit inicial).
- Personalização do nome de chamada por voz (não suportado pela Alexa; fica documentado como editar 1 campo).
- Histórico de comandos na nuvem (LGPD: nada sai do PC além de id/requestId/timestamp/assinatura).

## 3. Premissas Assumidas

| # | Premissa | Por quê | Se estiver errada… |
|---|---|---|---|
| P1 | "Só minha conta" = skill em **modo desenvolvimento** (só a conta do desenvolvedor a usa) + checagem do **Skill ID** + allowlist **opcional** de hash do `userId` | Evita logar `userId` para descobri-lo [#63]; o console de teste mostra o JSON para quem quiser ativar o hash | Ativar `allowedUserIdHashes` em `secrets.json` (script `hash-user-id` incluído) |
| P2 | Plano gratuito do HiveMQ Serverless não restringe permissão **por tópico**; ambas as credenciais serão "Publish and Subscribe" | Limite do plano | A defesa principal é o HMAC nos dois sentidos (cmd e ack) — credencial vazada não executa nem forja "feito" [#55] |
| P3 | Janela de validade de **30 s** e espera de ack de **5 s** na Lambda | A Alexa corta a resposta em ~8 s | Constantes nomeadas, fáceis de ajustar [#3] |
| P4 | Runtime Node da Lambda Alexa-hosted ≥ 18 → código CommonJS sem recursos mais novos que Node 18 | Compatibilidade | Ajuste pontual se o runtime for outro |
| P5 | Agente compilado com Node 24 (já instalado) via **Single Executable Application** + esbuild | Um único `.exe`, sem instalar Node no destino | Alternativa: instalador Inno Setup (exigiria baixar ferramenta) |
| P6 | Núcleo roda como **tarefa agendada na inicialização**, na conta do usuário, logon **S4U** ("não armazenar senha") | Sem guardar senha, sem serviço de terceiros | Se `shutdown` falhar antes do logon, trocar o núcleo para conta SYSTEM (decisão sua) |
| P7 | Ações de tela antes do logon respondem "Não consegui executar essa ação." | Não existe área de trabalho antes do logon | — |
| P8 | Backup vem **desativado** (`enabled: false`) até você indicar o programa/script | Não sabemos o que é o seu backup | Você edita `actions.json` e reinicia pelo ícone |

## 4. Decisão Visual

- **Tem superfície visual?** Mínima: ícone na bandeja (menu Pausar/Retomar/Abrir log/Sair) e o assistente
  de instalação (janelas de pergunta nativas do Windows).
- **Precisa de mockup?** Não — componentes nativos do Windows (NotifyIcon, InputBox), sem layout próprio.
- **`design-de-interface-projeto` acionada?** Sim, para validar textos, estados (conectado / pausado /
  sem conexão / erro) e cores do ícone antes da etapa 10.
- **Voz (superfície de áudio):** frases curtas em pt-BR centralizadas em `lambda/speech.js`.

## 5. Terreno (o que já existe)

| Arquivo | Papel hoje | O que muda |
|---|---|---|
| `lambda/index.js` | Hello World em inglês, loga envelope inteiro | **Reescrever**: só monta o SkillBuilder |
| `lambda/util.js` | URL pré-assinada S3, loga URL | **Remover** (código morto + log sensível) [#12][#63] |
| `lambda/local-debugger.js` | Script descontinuado pela Amazon | **Remover** [#12] |
| `lambda/package.json` | `hello-world`, `aws-sdk` v2 | Renomear, trocar por `@aws-sdk/client-s3` + `mqtt`, script `test` |
| `interactionModels/custom/pt-BR.json` | `change me`, HelloWorldIntent | `o monstro`, intents novas, slot types gerados do catálogo |
| `skill.json` | Textos de exemplo | Descrição e frases de exemplo em pt-BR |
| `README.md` | 2 linhas | Instalar, configurar, rodar, trocar nome, adicionar ação [#96] |

**Reaproveitamento** [#6]: `ask-sdk-core` já presente; módulo `crypto` nativo para HMAC/UUID; `node:test` nativo.
**Convenções locais** [#5][#13]: CommonJS, 4 espaços, handlers no padrão `canHandle/handle` do ASK SDK.

## 6. Arquitetura alvo

```
Alexa ─► Lambda (Alexa-hosted)                      HiveMQ Cloud (TLS 8883)              PC Windows
         handlers/ ─► domain/slotResolver            omonstro/<deviceId>/cmd  ──────►   núcleo (boot, S4U)
                   ─► messaging/mqttCommandBus  ───► omonstro/<deviceId>/ack  ◄──────     security/verifier + replayGuard
         config/secretsLoader ◄─ S3 config/secrets.json                                    executor/ (execFile, sem shell)
         protocol/ (assina cmd, verifica ack)                                              pipe \\.\pipe\o-monstro ◄─► sessão desktop (logon)
                                                                                                                         tray.ps1 (NotifyIcon)
```

**Mensagens** (JSON canônico, chaves ordenadas; `sig` = HMAC-SHA256 base64url sobre o resto):
- `cmd`: `{ v:1, type:"cmd", actionId, params:{…}, requestId:<uuid>, ts:<epoch ms>, sig }`
- `ack`: `{ v:1, type:"ack", requestId, status:"ok"|"error", ts, sig }` (sem texto de erro, sem saída de terminal)

**Catálogo em duas partes:**
- `lambda/catalog/skill-catalog.json` (fonte da verdade pública): `id`, `tipo` (aplicativo|rotina|sistema),
  `sinonimos[]`, `requiresConfirmation`, `requiresDesktop`, `params[]` (`name`, `type:"integer"`, `min`, `max`).
- `actions.json` (só no PC, em `%ProgramData%\OMonstro`): `id`, `descricao`, `executavel` (caminho absoluto),
  `args[]` fixos (placeholder de elemento inteiro `{minutos}` apenas para params declarados), `enabled`, `timeoutMs`.
- `npm run catalog:sync` gera os slot types do `pt-BR.json` a partir do catálogo; testes falham se o modelo
  de interação, o `actions.example.json` ou o catálogo embutido no `.exe` divergirem.

**Kit inicial:**

| id | Executa | Confirma? | Tela? |
|---|---|---|---|
| `abrir_netflix` | `explorer.exe https://www.netflix.com` | não | sim |
| `bloquear_tela` | `rundll32.exe user32.dll,LockWorkStation` | não | sim |
| `desligar_em_minutos` | `shutdown.exe /s /t {minutos×60}` (1–240) | **sim** | não |
| `cancelar_desligamento` | `shutdown.exe /a` | não | não |
| `reiniciar_pc` | `shutdown.exe /r /t 60` | **sim** | não |
| `backup_documentos` | *(você define; desativado)* | **sim** | não |

## 7. Passos Atômicos

| # | Arquivo alvo | O que muda (1 frase) | Prática | Como verificar | Skill |
|---|---|---|---|---|---|
| 1 | `.gitignore`, `CLAUDE.md`, `docs/planos/` | Ignora `.env`, `secrets.json`, `actions.json`, `node_modules`, `dist`, logs; registra arquitetura e regras | [#37][#40] | `git check-ignore` nos arquivos sensíveis | criar / git-flow |
| 2 | `lambda/util.js`, `local-debugger.js`, `index.js` | Remove exemplo e o log do envelope da sessão | [#12][#63] | grep sem `JSON.stringify(handlerInput` | refatorar |
| 3 | `lambda/protocol/*` + `agent/src/protocol/*` | Cria/verifica mensagens assinadas com expiração; cópia idêntica nos dois pacotes | [#51][#56] | testes: assinatura adulterada/expirada/futura rejeitada | refatorar + testes |
| 4 | `lambda/catalog/skill-catalog.json`, `scripts/sync-catalog.js`, `pt-BR.json` | Catálogo público + geração dos slot types e nome "o monstro" | [#6][#87] | `npm run catalog:check` verde | banco-de-dados |
| 5 | `lambda/domain/*` | Resolve slot (entity resolution → id) e valida params (inteiro 1–240) | [#51][#9] | testes de mapeamento e de rejeição | refatorar + testes |
| 6 | `lambda/config/secretsLoader.js` | Lê e valida `config/secrets.json` do bucket S3, com cache de instância | [#80][#55] | teste com S3 mockado; segredo ausente → "não consegui" | banco-de-dados |
| 7 | `lambda/messaging/mqttCommandBus.js` | Publica `cmd` (QoS 1, sem retain) e espera `ack` assinado até 5 s | [#75][#93] | teste com transporte em memória e timeout | refatorar + testes |
| 8 | `lambda/handlers/*`, `speech.js`, `index.js` | Intents, `Dialog.ConfirmIntent` para sensíveis, ErrorHandler global sem stack | [#22][#93] | testes de handler: confirmar/negar/desconhecida | refatorar + testes |
| 9 | `agent/src/config/*`, `actions.example.json` | Carrega e valida `actions.json` (caminho absoluto, sem shell, ids ⊆ catálogo) | [#51][#80] | teste: ação inválida é recusada na carga | banco-de-dados |
| 10 | `agent/src/executor/*` | `execFile` sem `shell`, com timeout, substituindo só placeholders de params validados | [#51] | teste com `execFile` mockado; `"30; del"` rejeitado | refatorar + testes |
| 11 | `agent/src/security/*` | Verificação HMAC + janela 30 s + `requestId` único (memória com TTL) | [#51][#56] | testes de replay e expiração | segurança + testes |
| 12 | `agent/src/logger/*` | Log JSON local com rotação e máscara de usuário/caminhos | [#63][#91][#92] | teste: `C:\Users\<nome>` vira `%USERPROFILE%` | revisar |
| 13 | `agent/src/transport/mqttTransport.js`, `core.js` | Núcleo conecta ao broker com reconexão e backoff, publica ack assinado, nunca cai | [#93] | integração com transporte em memória | refatorar + testes |
| 14 | `agent/src/desktop/*`, `tray.ps1` | Pipe local autenticado + sessão desktop + ícone (conectado/pausado/offline) | [#13] | teste do pipe; conferência manual do ícone | design-de-interface |
| 15 | `agent/src/install/*` | Assistente: elevação, cópia p/ `%ProgramFiles%`, config em `%ProgramData%` com ACL, gera segredo HMAC e `secrets.json` p/ upload, registra 2 tarefas, desinstalação | [#55][#80] | instalação real conduzida por você; `schtasks /query` | criar |
| 16 | `agent/build/*` | Bundle esbuild + Node SEA → `agent/dist/o-monstro.exe` | [#79] | `npm run build:exe` gera o `.exe` e `--version` responde | criar |
| 17 | `agent/scripts/simular-alexa.js` | Faz o papel da Lambda para teste ponta a ponta local | [#42][#43] | "bloquear_tela" executa e ack volta | testes |
| 18 | `REVIEW.md` | Auditoria: injeção, replay, PII em logs, segredos, dependências | [#34][#64] | nenhum item crítico aberto | revisar + segurança |
| 19 | `README.md` | Instalar, HiveMQ, S3, trocar nome, adicionar ação, desinstalar | [#96] | leitura | documentar |

Commits atômicos em Conventional Commits, um por passo (ou par de passos acoplados) [#31][#32]. Push só com a sua autorização.

## 8. Impacto em Dados e Contratos

- **Banco de dados:** nenhum. "Dados" = dois arquivos JSON validados por esquema.
- **Contrato:** protocolo `v:1`; mudança incompatível sobe para `v:2` [#28].
- **Configuração:** `secrets.json` (S3): `skillId`, `deviceId`, `hmacSecret`, `mqtt.{url,username,password}`,
  `allowedUserIdHashes?`. Agente: mesmo `deviceId`/`hmacSecret` + credencial MQTT do PC em
  `%ProgramData%\OMonstro\config.json` (ACL: SYSTEM, Administradores, seu usuário). Nada no Git [#37][#80].
- **LGPD:** Lambda e broker nunca recebem nome de usuário, caminhos ou saída de comandos. Lambda loga só
  `actionId`, `requestId` e código de resultado. Saída das ações só no log local do PC [#63].

## 9. Plano de Testes

| Nível | O que cobre | Caminho de falha coberto |
|---|---|---|
| Unidade [#41] | slot → actionId; params; assinatura; expiração; replay; executor; máscara de log | slot desconhecido; `minutos` 0/241/"30;del"/2.5; sig inválida/ausente; ts velho/futuro; requestId repetido; ação desativada |
| Integração [#42] | Lambda bus ↔ núcleo ↔ executor via transporte em memória; núcleo ↔ desktop via pipe | ack não chega (timeout → "não consegui"); ack com sig inválida; desktop ausente |
| Sincronia | catálogo × `pt-BR.json` × `actions.example.json` × protocolo duplicado | qualquer divergência falha o teste |
| E2E manual [#43] | `simular-alexa` contra HiveMQ real com ação inofensiva | agente pausado → "não consegui" |

**Comando:** `npm test` em `lambda/` e em `agent/`.

## 10. Riscos e Rollback

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| `.exe` sem assinatura digital gera alerta SmartScreen/Defender | Alta | Aviso na instalação | Documentar "Mais informações → Executar assim mesmo"; build reproduzível a partir do código |
| `shutdown` sem permissão no logon S4U antes do logon | Média | Desligar não funciona na tela de login | Testar na instalação; alternativa: núcleo como SYSTEM |
| Relógio do PC dessincronizado | Baixa | Mensagens recusadas como expiradas | Janela 30 s; log local "relógio fora" |
| Lambda sem ack em 5 s (PC desligado/offline) | Média | Alexa responde "não consegui" | Comportamento esperado |
| Runtime Node da Alexa-hosted diferente | Baixa | Erro de sintaxe na publicação | CommonJS, sem recursos pós-Node 18 |

**Rollback** [#84]: branch isolada; `o-monstro.exe --desinstalar` remove tarefas, arquivos e config; revert por commit.

## 11. Definição de Pronto

- [ ] Passos 1–19 executados
- [ ] `npm test` verde em `lambda/` e `agent/` [#49]
- [ ] `o-monstro.exe` gerado e instalado por você; ícone aparece no logon
- [ ] Simulação ponta a ponta com HiveMQ real conferida
- [ ] Nenhum `exec(`, `shell: true`, `cmd.exe` ou `powershell.exe` recebendo dado externo [#51]
- [ ] Sem segredo no Git [#37]; sem PII em log da Lambda [#63]
- [ ] Commits atômicos Conventional Commits [#31][#32]
- [ ] `docs/planos/ENTREGA-alexa-agente.md` escrito; `CLAUDE.md` atualizado
