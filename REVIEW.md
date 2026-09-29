# 🔍 Relatório de Auditoria e Revisão de Código

> Branch `feature/agente-e-comunicacao-websocket` · 2026-09-28 · escopo: `lambda/`, `agent/`, `interactionModels/`, `skill.json`, `.gitignore`.
> Itens marcados **✅ Corrigido** foram resolvidos nesta mesma branch (commit indicado).

## 📊 Resumo Executivo

Stack: skill Alexa-hosted em Node (ASK SDK v2, CommonJS) → HiveMQ Cloud (MQTT/TLS 8883) → agente Windows em Node 24
distribuído como pasta com o `node.exe` oficial assinado + bundle, com núcleo em tarefa agendada (S4U, boot) e sessão de desktop
(logon) ligadas por named pipe. Não há banco de dados, front-end web nem API HTTP própria.

**Nível de risco atual: BAIXO.** O caminho crítico (voz → execução) está fechado por lista: o `actionId` sai do
catálogo, o parâmetro é inteiro validado nas duas pontas, a mensagem é assinada (HMAC-SHA256) com validade de
30 s e `requestId` único, e a execução usa só `execFile`/`spawn` com `shell: false` e executável absoluto.
`npm audit`: 0 vulnerabilidades em `lambda/` e `agent/`. Nenhum segredo no código nem no histórico do Git.

Três achados de risco Alto/Médio foram corrigidos durante a auditoria (pipe squatting, pasta de dados
pré-criada, orçamento de tempo da Alexa). O bloqueio do antivírus sobre o `.exe` único foi resolvido trocando
a distribuição por uma pasta com o Node oficial assinado — ver Risco Alto.

**Não auditado:** comportamento real no Windows das tarefas S4U antes do logon, o instalador interativo e o
ícone ponta a ponta (dependem da instalação real); configuração do cluster HiveMQ (fora do repositório).

## 🔥 Top 5 Causas de Vazamento — veredicto obrigatório

| # | Causa | Veredicto | Evidência | Prática |
|---|-------|-----------|-----------|---------|
| V1 | Banco sem RLS / regras abertas | ➖ NÃO SE APLICA | Não há banco. Análogo — broker sem ACL por tópico no plano gratuito do HiveMQ: mitigado porque toda mensagem é assinada e verificada (`lambda/protocol/message.js:126`, `agent/src/security/commandGuard.js:55`) | [#55] |
| V2 | Autorização decidida no front-end | ✅ PROTEGIDO | Lambda valida Skill ID e allowlist no servidor (`lambda/handlers/actionHandler.js:20`); o agente só confia na assinatura HMAC, nunca em campo do cliente | [#51][#56] |
| V3 | IDOR (ID sem checagem de dono) | ➖ NÃO SE APLICA | Nenhum recurso é buscado por ID; `requestId` só correlaciona o ack e é checado junto com a assinatura (`lambda/messaging/commandBus.js:42`) | [#55] |
| V4 | Segredo chumbado no código/Git | ✅ PROTEGIDO | Segredos em S3 (`lambda/config/secretsLoader.js`) e `%ProgramData%\OMonstro\config.json` com ACL; `.gitignore` cobre `secrets.json`, `config.json`, `actions.json`, `.env`; varredura do histórico sem ocorrências | [#37][#80] |
| V5 | Input sem tratamento (XSS / injeção) | ✅ PROTEGIDO | Sem HTML. Equivalente aqui é injeção de comando: slot → id do catálogo (`lambda/domain/actionResolver.js:30`), params só inteiros (`lambda/protocol/message.js:75`), `shell:false` (`agent/src/executor/actionExecutor.js:45`), `.bat/.cmd` e params para interpretadores proibidos (`agent/src/config/localActions.js:61`) | [#51] |

## 🚨 Risco Crítico (Segurança e LGPD)

* Nenhum achado nesta categoria.
* **Nota LGPD:** o tratamento é feito por pessoa natural para fins exclusivamente particulares e não econômicos
  (Lei 13.709/2018, art. 4º, I). Ainda assim, a minimização foi aplicada: nenhuma PII chega à Lambda ou ao
  broker; o `userId` da Alexa não é logado (`lambda/handlers/builtInHandlers.js:35`, teste
  `lambda/test/skill.test.js` › `shouldNeverLogPersonalData`); a saída das ações fica só no log local mascarado
  (`agent/src/logger/localLogger.js:23`). Exclusão: `Desinstalar O Monstro.cmd` apaga dados locais; o
  `config/secrets.json` do S3 é apagado manualmente no console da Alexa (documentado no README).

## 🐛 Risco Alto (Bugs e Arquitetura)

* **✅ Corrigido (`bdf77c0`) — Pipe squatting entregava o segredo do pipe [#55][#56]**: a sessão de desktop
  enviava o `pipeSecret` em claro no `hello`. Um processo local que criasse `\\.\pipe\o-monstro` antes do
  núcleo capturaria o segredo e poderia se passar pelo núcleo.
  * **Onde estava:** `agent/src/desktop/desktopSession.js` (handshake), `agent/src/core/desktopBridge.js`.
  * **Como foi refatorado:** autenticação mútua por desafio-resposta (HMAC sobre nonces); o segredo nunca
    trafega e a sessão só obedece a um núcleo que provou conhecê-lo. Teste `shouldNotRevealSecretToImpostorPipeServer`.
* **✅ Corrigido (`258f64b`) — Pasta de dados pré-criada por outra conta [#55]**: em `%ProgramData%` qualquer
  conta cria pastas; quem criasse `OMonstro` antes seria dona dela e poderia plantar um `actions.json` que o
  instalador preservaria.
  * **Onde estava:** `agent/src/install/installer.js` (`runInstall`).
  * **Como foi refatorado:** o instalador aborta se o dono não for Administradores/SYSTEM/o próprio usuário e
    fixa o dono em Administradores antes de aplicar a ACL restrita.
* **✅ Resolvido (branch `feature/instalador-em-pasta`) — Executável único bloqueado pelo antivírus (entrega) [#79][#84]**:
  o Kaspersky classificava o `o-monstro.exe` (Node SEA: `node.exe` modificado por `postject`, assinatura
  invalidada) como `HEUR:Trojan-Downloader.Script.Generic` pela heurística sobre o `o-monstro.cjs` embutido,
  colocava-o no grupo "Não confiável" do Controle de Aplicativos e bloqueava a inicialização, **mesmo com exclusões**.
  O `node.exe` oficial foi classificado como Confiável (KSN, OpenJS Foundation).
  * **Onde estava:** `agent/build/build-exe.js` (removido).
  * **Solução aplicada:** `agent/build/build-package.js` gera uma pasta com o `node.exe` oficial **inalterado**
    (o build falha se a assinatura não for válida da OpenJS Foundation) + `o-monstro.cjs` + `Instalar O Monstro.cmd`;
    as tarefas agendadas executam `node.exe "…\o-monstro.cjs" --nucleo|--desktop`. Nenhuma tentativa de
    contornar a detecção: o JavaScript continua sendo analisado e depende de exclusão/falso positivo reportado.

## ⚠️ Risco Médio (Performance e Infraestrutura)

* **✅ Corrigido (`9221730`) — Orçamento de tempo acima do limite da Alexa [#93]**: conexão (3 s) + espera do ack
  (5 s) somavam ~8 s, o limite da Alexa; em rede lenta o usuário ouviria o erro genérico da Alexa em vez de
  "Não consegui executar essa ação."
  * **Solução aplicada:** conexão ≤ 2,5 s e ack ≤ 4,5 s; ações síncronas no PC limitadas a 3,5 s.
* **✅ Corrigido (`1c5972b`) — Allowlist de conta sem ferramenta [#56]**: o plano previa o script de hash do
  `userId`, que faltava. Agora `npm run hash-user-id -- "<userId>"` em `lambda/`.
* **Aberto — Allowlist de conta vazia por padrão [#55]**: com `allowedUserIdHashes: []`, qualquer conta com
  acesso à skill pode acioná-la. Enquanto a skill estiver em modo desenvolvimento, só a conta do desenvolvedor
  (e beta testers convidados) tem acesso.
  * **Impacto:** relevante apenas se a skill for publicada ou houver beta testers.
  * **Solução:** preencher `allowedUserIdHashes` no `secrets.json` do S3 ao publicar.
* **Aberto — Credenciais MQTT sem restrição por tópico [#55]**: limite do plano gratuito do HiveMQ.
  * **Impacto:** credencial vazada permite publicar lixo (DoS leve); não executa nada (HMAC) nem forja "Feito."
    (ack também assinado). Payload limitado a 4 KB e 20 comandos válidos/min (`agent/src/security/commandGuard.js:11`).
  * **Solução:** em plano pago, restringir `alexa-o-monstro` a publicar em `omonstro/+/cmd`/ler `…/ack` e o inverso para o PC.

## 💡 Risco Baixo (Clean Code e Dívida Técnica)

* **Memória anti-replay não persiste entre reinícios** (`agent/src/security/commandGuard.js:13`): um comando
  capturado poderia ser repetido se o núcleo reiniciasse em menos de 30 s. O reinício automático ocorre após
  1 min, então a janela já expirou. **Recomendação:** aceitar; se um dia houver reinício rápido, persistir os
  `requestId` dos últimos 60 s.
* **Segredos da Lambda só recarregam em cold start** (`lambda/config/secretsLoader.js:51`): rotação exige
  reimplantar a skill. **Recomendação:** documentado no README.
* **Cópia local do `secrets.json` da Alexa** (`%ProgramData%\OMonstro\enviar-para-alexa\`) contém a senha da
  credencial da Alexa até o usuário apagar. **Recomendação:** o instalador já avisa; considerar apagar
  automaticamente após confirmação do upload.
* **Entrada oculta de senha usa API interna do readline** (`agent/src/install/consolePrompt.js:9`,
  `_writeToOutput`). **Recomendação:** funciona no Node 24; revisar ao atualizar o Node.
* **Remoção adiada via `cmd.exe`** na desinstalação (`agent/src/install/installer.js`, `removeInstallDirectory`):
  usa apenas o caminho fixo de `%ProgramFiles%` do próprio administrador; sem dado externo. Mantido.

## 🛡️ Modelo de ameaças (resumo — etapa `seguranca-projeto`)

| Ameaça | Controle | Evidência |
|---|---|---|
| Alguém fala uma "ação" fora da lista | Entity resolution → id do catálogo; resto = "Não conheço essa ação." | `lambda/test/actionResolver.test.js` |
| Texto malicioso em parâmetro (`30; shutdown /r`) | Regex de dígitos + faixa na Lambda; inteiro + faixa no protocolo e no executor | `lambda/test/protocol.test.js`, `agent/test/actionExecutor.test.js` |
| Mensagem forjada no broker | HMAC-SHA256, comparação em tempo constante; sem ack para forjadas | `agent/test/agentCore.integration.test.js` |
| Replay de mensagem capturada | Validade 30 s + `requestId` único em memória | `agent/test/commandGuard.test.js` |
| Ack falso ("Feito." sem executar) | Ack assinado e amarrado ao `requestId` | `lambda/test/commandBus.test.js` |
| Processo local imitando núcleo/desktop | Desafio-resposta mútuo no pipe | `agent/test/desktopPipe.test.js` |
| Ação perigosa por engano | Confirmação por voz (`requiresConfirmation`) + pausa pelo ícone | `lambda/test/skill.test.js` |
| Vazamento de dados pessoais | Lambda/broker sem PII; log local mascarado | `lambda/test/skill.test.js`, `agent/test/localLogger.test.js` |

## ✅ Plano de Ação Imediato

1. Reportar o falso positivo `HEUR:Trojan-Downloader.Script.Generic` ao Kaspersky (opentip.kaspersky.com).
2. Instalar pelo `Instalar O Monstro.cmd`, conferir o ícone e rodar `npm run simular -- bloquear_tela` e `-- cancelar_desligamento` em `agent/`.
3. Confirmar que `desligar_em_minutos` funciona **antes do logon** (limitação conhecida do S4U); se não, avaliar núcleo como SYSTEM.
4. Na publicação: enviar `secrets.json` ao S3, apagar a cópia local e preencher `allowedUserIdHashes`.
