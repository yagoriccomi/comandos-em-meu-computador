# CLAUDE.md — O Monstro (Alexa → PC Windows)

Automação pessoal: "Alexa, pede para o monstro <ação>" executa uma **ação predefinida** no PC Windows do dono.
Um usuário, uma máquina. Plano de referência: `docs/planos/PLANO-alexa-agente.md`.

## Arquitetura

```
lambda/        Skill Alexa-hosted (Node, CommonJS, compatível com Node 18)
  handlers/    Intents (canHandle/handle do ASK SDK) — sem regra de negócio
  domain/      catálogo público, slot → actionId, validação de params
  messaging/   envia cmd e espera ack pelo broker MQTT
  protocol/    mensagens assinadas (o agente importa daqui via agent/src/shared.js; esbuild embute no bundle)
  config/      segredos lidos de config/secrets.json no bucket S3 da skill
  catalog/     skill-catalog.json — FONTE DA VERDADE pública das ações
interactionModels/custom/pt-BR.json   slot types GERADOS por `npm run catalog:sync` (em lambda/)
agent/         Agente Windows: `npm run build:pacote` → dist/O Monstro/ (node.exe OFICIAL assinado + o-monstro.cjs)
               NÃO voltar para .exe único (SEA/postject): quebra a assinatura e o antivírus bloqueia.
  src/core     núcleo: inicia com o Windows (tarefa agendada S4U), conecta ao broker, executa ações sem tela
  src/desktop  sessão do usuário (logon): ícone na bandeja + ações que precisam de tela, via named pipe
  src/install  assistente de instalação/desinstalação ("Instalar O Monstro.cmd" → node.exe o-monstro.cjs --instalar)
```

Fluxo: fala → intent → `actionId` do catálogo → confirmação por voz se `requiresConfirmation` →
`cmd` assinado em `omonstro/<deviceId>/cmd` → agente valida → executa → `ack` assinado em `.../ack` →
Alexa diz "Feito." ou "Não consegui executar essa ação.".

## Regras inegociáveis

- **Lista fechada.** Nenhum texto vindo da Alexa chega a `exec`, `spawn`, `cmd.exe` ou `powershell.exe`.
  Só `execFile` **sem** `shell`, com executável absoluto e `args` fixos de `actions.json`. Placeholder
  permitido apenas como elemento inteiro (`"{minutos}"`) para params declarados e validados (inteiro + faixa).
- **Mensagens:** HMAC-SHA256 sobre JSON canônico, validade de 30 s, `requestId` único (anti-replay),
  `v:1`. Mudança incompatível → `v:2`. O `ack` também é assinado.
- **Catálogo em duas partes sincronizadas:** `lambda/catalog/skill-catalog.json` (público, sem executáveis)
  e `actions.json` local (executáveis). Todo id novo entra primeiro no catálogo público, depois
  `npm run catalog:sync` em `lambda/`, depois no `actions.json`. Testes quebram se divergirem.
- **LGPD:** a Lambda e o broker nunca recebem nome de usuário, caminhos ou saída de comando. Lambda loga
  só `actionId`, `requestId` e código de resultado. Nunca logar `requestEnvelope`. Log do agente é local
  e mascara `C:\Users\<nome>` e o nome do usuário.
- **Segredos:** nada no Git. Lambda: `config/secrets.json` no S3 da skill. Agente:
  `%ProgramData%\OMonstro\config.json` com ACL restrita. Modelos: `*.example.json`.
- **Erros:** a Alexa só fala as frases de `lambda/speech.js`; sem stack trace. O agente nunca cai por
  mensagem ruim — registra e ignora.

## Convenções

- CommonJS, 4 espaços, aspas simples, nomes descritivos em inglês no código; textos para o usuário em pt-BR.
- Testes com `node:test` (`npm test` em `lambda/` e em `agent/`). Sem dependências de teste externas.
- Conventional Commits (`feat:`, `fix:`, `sec:`, `test:`, `docs:`, `chore:`, `refactor:`). Push só com autorização.
- Nome de chamada: `invocationName` em `interactionModels/custom/pt-BR.json` (hoje "o monstro").
- Jira: não utilizado neste projeto (decisão do dono).
