# CLAUDE.md — O Monstro (Alexa → PC Windows)

Automação pessoal: "Alexa, pede para o monstro <ação>" executa uma **ação predefinida** no PC Windows do dono.
Um usuário, uma máquina. Plano de referência: `docs/planos/PLANO-alexa-agente.md`.

## Arquitetura

```
lambda/        Skill Alexa-hosted (Node 16, CommonJS). O builder usa yarn 1.7 com checagem RÍGIDA de engines:
               toda dependência precisa aceitar Node 16 (yarn.lock versionado). NÃO declarar o SDK da AWS:
               o runtime já traz (v2 no Node 16, v3 no 18+) — ver config/secretsLoader.js
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
  src/desktop  sessão do usuário (logon): ícone na bandeja + ações que precisam de tela, via canal local TCP 127.0.0.1
               (porta em core-endpoint.json; NÃO named pipe: a DACL do pipe criado em S4U bloqueia a sessão interativa)
  src/install  assistente de instalação/desinstalação ("Instalar O Monstro.cmd" → node.exe o-monstro.cjs --instalar)
  src/internal ações INTERNAS (mídia, pesquisa, programas): código fixo do agente; actions.json só liga/desliga
  src/desktop/input-helper.ps1   PowerShell persistente com LISTA FECHADA de verbos (teclas, menu de mídia, processos)
  src/desktop/scan-programs.ps1  detecta programas do menu Iniciar (só leitura)
  src/programs lista PRIVADA %LOCALAPPDATA%\OMonstro\programas.json (nunca no Git) + busca aproximada
  src/claude   Claude Code da ASSINATURA (`claude -p`, login do dono): perguntas (Sonnet, só WebSearch/WebFetch) e
               ordens (pasta escolhida na bandeja; --continue ou "novo chat" com Opus/medium/auto). Assíncrono:
               a resposta é falada pelo PC (speak.ps1, voz pt-BR) e o resumo volta no ack de "a resposta do Claude".
               Trava das ordens: PIN 6 dígitos (scrypt) → sessão de 3 h; "encerrar sessão" revoga; 5 erros = 15 min.
scripts/deploy.ps1   deploy completo (testes → skill via ASK CLI/git push na Alexa-hosted → instalador). Manual: docs/DEPLOY.md
```

Fluxo: fala → intent → `actionId` do catálogo → confirmação por voz se `requiresConfirmation` →
`cmd` assinado em `omonstro/<deviceId>/cmd` → agente valida → executa → `ack` assinado em `.../ack` →
Alexa diz "Feito." ou "Não consegui executar essa ação.".
Programas: o nome falado vai como TEXTO; o PC compara com a lista privada. Sem vencedor claro, o ack volta
`ambiguous`/`not_found` com até 3 nomes e a Alexa pergunta "qual deles?" (aceita "o segundo", o nome ou "sim").

## Regras inegociáveis

- **Lista fechada.** Nenhum texto vindo da Alexa chega a `exec`, `spawn`, `cmd.exe` ou `powershell.exe`.
  Só `execFile` **sem** `shell`, com executável absoluto e `args` fixos de `actions.json`. Placeholder
  permitido apenas como elemento inteiro (`"{minutos}"`) para params **inteiros** declarados e validados.
- **Texto da Alexa (tipo `text`) só em dois usos:** (1) pesquisa: vira só o `q=` CODIFICADO de
  `https://www.google.com/search`; (2) nome de programa: só é COMPARADO com a lista privada, e o que executa é
  o `abrirCom`/`processos` da lista; (3) pergunta/ordem ao Claude Code: SÓ pelo STDIN do `claude.exe`, com
  argumentos fixos de `agent/src/claude/claudeCli.js` (e PIN válido para ordens). Texto nunca vai para argumentos
  de executável nem para o input-helper. Fala do PC (speak.ps1) também recebe texto só pelo stdin.
- **Processos se identificam por pasta + exe**, nunca só pelo nome (`claude.exe` do app ≠ do Claude Code).
- **Mensagens:** HMAC-SHA256 sobre JSON canônico, validade de 30 s, `requestId` único (anti-replay),
  **`v:2`** (params inteiros ou texto ≤ 200 sem caracteres de controle; ack com `ambiguous`/`not_found` +
  `choices` ≤ 3 × 60). Mudança incompatível → `v:3` e deploy de skill + agente no MESMO dia. O `ack` também é assinado.
- **Catálogo em duas partes sincronizadas:** `lambda/catalog/skill-catalog.json` (público, sem executáveis)
  e `actions.json` local (executáveis). Todo id novo entra primeiro no catálogo público, depois
  `npm run catalog:sync` em `lambda/`, depois no `actions.json`. Testes quebram se divergirem.
- **LGPD:** a Lambda e o broker nunca recebem nome de usuário, caminhos ou saída de comando. Lambda loga
  só `actionId`, `requestId` e código de resultado. Nunca logar `requestEnvelope`, texto de pesquisa,
  nome falado de programa, as opções do "qual deles?", o PIN, a pergunta/ordem nem a resposta do Claude (esses só
  trafegam assinados). Voice ID: a Lambda só loga o HASH do personId. Log do agente é local
  e mascara `C:\Users\<nome>` e o nome do usuário.
- **Lista de programas e preferências** (`%LOCALAPPDATA%\OMonstro\`) são privadas: nunca no Git (o repositório
  é PÚBLICO). Só o deploy as usa, para o repositório interno da skill na Amazon.
- **Segredos:** nada no Git. Lambda: `config/secrets.json` no S3 da skill. Agente:
  `%ProgramData%\OMonstro\config.json` com ACL restrita. Modelos: `*.example.json`.
- **Erros:** a Alexa só fala as frases de `lambda/speech.js`; sem stack trace. O agente nunca cai por
  mensagem ruim — registra e ignora.

## Convenções

- CommonJS, 4 espaços, aspas simples, nomes descritivos em inglês no código; textos para o usuário em pt-BR.
- Testes com `node:test` (`npm test` em `lambda/` e em `agent/`). Sem dependências de teste externas.
- Conventional Commits (`feat:`, `fix:`, `sec:`, `test:`, `docs:`, `chore:`, `refactor:`). Push só com autorização.
- Nome de chamada: o versionado em `interactionModels/custom/pt-BR.json` é "o monstro"; o do dono vem de
  `preferencias.json` (bandeja → "Trocar nome de chamada…") e o `deploy.ps1` aplica.
- Deploy: `scripts/deploy.ps1` (ver `docs/DEPLOY.md`). Avisar o dono antes; o login do ASK CLI é dele.
- Skill única / Casa Inteligente: CANCELADA pelo dono (2026-10-04). Branch `feature/skill-unica-casa-inteligente` arquivada.
- Jira: não utilizado neste projeto (decisão do dono).
