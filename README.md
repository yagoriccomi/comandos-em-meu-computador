# O Monstro — Alexa → meu PC Windows

"Alexa, pede para **o monstro** abrir a Netflix." → o PC abre a Netflix e a Alexa responde **"Feito."**

Uso pessoal: uma conta, um PC. A Alexa **nunca** envia comandos livres: só o identificador de uma ação que já
existe na lista fechada que você configura no PC.

```
Alexa ─► Skill (Lambda Alexa-hosted) ─► HiveMQ Cloud (MQTT/TLS) ─► agente no PC ─► ação do actions.json
      ◄──────────── "Feito." / "Não consegui executar essa ação." ◄──── resposta assinada ◄┘
```

Detalhes de arquitetura e regras do projeto: [CLAUDE.md](CLAUDE.md) · auditoria: [REVIEW.md](REVIEW.md).

## O que dá para falar

| Frase (depois de "Alexa, pede para o monstro…") | Ação | Pede confirmação? |
|---|---|---|
| abrir a Netflix | `abrir_netflix` | não |
| bloquear a tela | `bloquear_tela` | não |
| desligar o computador em 30 minutos (1 a 240) | `desligar_em_minutos` | **sim** |
| cancelar o desligamento | `cancelar_desligamento` | não |
| reiniciar o computador | `reiniciar_pc` | **sim** |
| rodar o backup | `backup_documentos` (desativado até você configurar) | **sim** |

Abrir a Netflix e bloquear a tela precisam de alguém logado no Windows. Desligar, reiniciar e backup funcionam
já na tela de login.

## Pré-requisitos

- Windows 10/11 e Node.js 22+ **oficial** (nodejs.org). É usado para gerar o pacote, e o próprio `node.exe`
  assinado vai dentro dele.
- Conta gratuita no [HiveMQ Cloud](https://console.hivemq.cloud) com um cluster Serverless.
- Skill Alexa-hosted criada no [developer console](https://developer.amazon.com/alexa/console/ask) (idioma pt-BR).

## 1. Criar as credenciais no HiveMQ

No cluster: **Access Management** → crie duas credenciais, ambas com **Publish and Subscribe**:

| Username | Usada por |
|---|---|
| `pc-o-monstro` | agente no PC |
| `alexa-o-monstro` | skill da Alexa |

Guarde as senhas no seu gerenciador de senhas e anote o **Cluster URL** (aba Overview).

## 2. Gerar e instalar o agente

```bash
cd agent && npm install && npm run build:pacote
```

Isso gera a pasta `agent\dist\O Monstro\`:

```
O Monstro\
  Instalar O Monstro.cmd      ← dois cliques aqui
  app\node.exe                Node.js oficial, sem alteração (assinado pela OpenJS Foundation)
  app\o-monstro.cjs           o agente
  app\tray.ps1, app\actions.example.json
```

Dê dois cliques em **Instalar O Monstro.cmd**. O assistente pede permissão de administrador uma vez, pergunta o
endereço do cluster, as duas credenciais (e testa a conexão) e o Skill ID, e então:

- instala em `C:\Program Files\OMonstro\`;
- guarda configuração, ações e logs em `C:\ProgramData\OMonstro\` (acesso só seu e dos administradores);
- cria as tarefas agendadas **O Monstro\Nucleo** (inicia com o Windows) e **O Monstro\Area de trabalho** (inicia no logon);
- gera `C:\ProgramData\OMonstro\enviar-para-alexa\secrets.json` para a skill.

> **Antivírus:** o código do agente (conexão à internet + PowerShell + tarefas de inicialização) pode ser
> marcado por heurística como suspeito (falso positivo, ex.: Kaspersky `HEUR:Trojan-Downloader.Script.Generic`).
> Crie exclusões para a pasta do projeto e para `C:\Program Files\OMonstro\` (todos os componentes). Por isso o
> agente não é distribuído como `.exe` único: um `node.exe` modificado perde a assinatura e é bloqueado mesmo
> com exclusões.

**Ícone na bandeja:** 🟢 pronto · 🟡 pausado · ⚪ sem conexão · 🔴 núcleo parado. Menu: Pausar/Retomar ações,
Abrir log, Desligar o agente, Fechar ícone.

**Desinstalar:** dois cliques em `C:\Program Files\OMonstro\Desinstalar O Monstro.cmd`.

## 3. Configurar a skill (publicação)

1. Copie `lambda/`, `interactionModels/` e `skill.json` para o repositório da skill Alexa-hosted (ou use o `ask` CLI).
2. No console da Alexa → **Code → Media storage (S3)**: envie o `secrets.json` gerado pelo instalador como
   `config/secrets.json`. **Depois apague a cópia local**: ela contém a senha da credencial da Alexa.
3. **Build → Build Model** e teste na aba **Test**.
4. Opcional, para aceitar só a sua conta: copie o `userId` do JSON da aba Test e rode
   `npm run hash-user-id -- "amzn1.ask.account…"` em `lambda/`. Coloque o hash em `allowedUserIdHashes` no `secrets.json`.

Os segredos são lidos quando a Lambda inicia. Depois de trocar o `secrets.json`, reimplante a skill.

## Trocar o nome de chamada

Edite `invocationName` em [interactionModels/custom/pt-BR.json](interactionModels/custom/pt-BR.json) (ou no
console: **Build → Invocation**) e recompile o modelo. Não é possível trocar por voz.

## Adicionar ou mudar uma ação

As ações existem em **duas partes que precisam estar sincronizadas**:

1. **Parte pública** (sem executáveis): [lambda/catalog/skill-catalog.json](lambda/catalog/skill-catalog.json).
   Defina o `id`, os sinônimos, `requiresConfirmation` e `requiresDesktop`. Depois, em `lambda/`, rode
   `npm run catalog:sync` para gerar as frases da Alexa.
2. **Parte local** (só no PC): `C:\ProgramData\OMonstro\actions.json`, com o mesmo `id`:

```json
{ "id": "abrir_netflix", "executable": "C:\\Windows\\explorer.exe", "args": ["https://www.netflix.com"], "enabled": true }
```

Regras (o agente recusa o arquivo se não forem seguidas):
- `executable` é um caminho absoluto; `.bat`/`.cmd` não são aceitos (use `cmd.exe` com argumentos fixos);
- `args` são fixos; o único valor variável é um parâmetro declarado no catálogo, ocupando um argumento inteiro:
  `"{minutos}"` ou `"{minutos*60}"`;
- interpretadores (`cmd`, `powershell`…) nunca recebem parâmetros;
- ações síncronas precisam terminar em até 3,5 s (`timeoutMs`); tarefas longas usam `"waitForExit": false`;
- `successExitCodes` aceita códigos de saída não zero que significam sucesso (ex.: `explorer.exe` retorna 1).

Para ativar o backup, aponte `backup_documentos` para o seu script e mude `enabled` para `true`. Em seguida,
use **Desligar o agente** no ícone e reinicie o Windows, ou reinicie a tarefa agendada.

## Testes

```bash
cd lambda && npm test
```

```bash
cd agent && npm test
```

Para testar de verdade, sem publicar a skill (usa o `secrets.json` gerado pelo instalador), rode em `agent/`:

```bash
npm run simular -- bloquear_tela
```

## Privacidade (LGPD)

A Lambda e o broker recebem apenas `actionId`, parâmetros inteiros, `requestId`, horário e assinatura. Nome de
usuário, caminhos do PC e saída dos comandos ficam só no log local (`C:\ProgramData\OMonstro\logs`), com o
nome do usuário mascarado. Desinstalar com "apagar dados" remove tudo do PC; o `secrets.json` do S3 é apagado
pelo console da Alexa.
