# Deploy do O Monstro — manual para o Claude (e para humanos)

Este manual explica como publicar a **skill** (Lambda Alexa-hosted + modelo de voz) e gerar o **instalador do
agente** com o script `scripts/deploy.ps1`, e como navegar no **console Alexa Developer** quando precisar
conferir ou corrigir algo à mão.

> Regras que valem sempre:
> - **Nunca** faça `git push` para o GitHub sem autorização do dono.
>   O push do deploy vai para o repositório **interno da skill na Amazon**, não para o GitHub. Mesmo assim,
>   avise o dono antes de rodar o deploy, porque ele muda a skill que ele usa.
> - **Nunca** digite senha, token ou chave em lugar nenhum. O login do ASK CLI é feito **pelo dono**, no navegador.
> - Não cole `secrets.json`, `programas.json` ou `preferencias.json` no chat nem no GitHub: são privados.

---

## 1. O que o deploy faz

```
scripts/deploy.ps1
 ├─ 1. testes: npm test (lambda/ e agent/) + npm run catalog:check
 ├─ 2. skill (Alexa-hosted)
 │    ├─ clone local em %LOCALAPPDATA%\OMonstro\deploy\skill  (ask init na 1ª vez; git pull nas outras)
 │    ├─ node scripts/prepare-deploy.js → copia lambda/ e gera o modelo de voz com:
 │    │     • nome de chamada de %LOCALAPPDATA%\OMonstro\preferencias.json  ("o monstro", "a morgana"…)
 │    │     • verbos de %LOCALAPPDATA%\OMonstro\programas.json  (seção "verbos")
 │    ├─ git commit + git push origin HEAD:master  → a Amazon compila e publica em "development"
 │    └─ espera "SUCCEEDED" em ask smapi get-skill-status (até 10 min)
 └─ 3. agente: npm run build:pacote → abre "Instalar O Monstro.cmd" (pede administrador)
```

O mesmo script roda pelo menu da bandeja: **"Publicar atualização…"**.

## 2. Pré-requisitos (uma vez só, feitos pelo dono)

| Item | Como conferir | Como resolver |
|---|---|---|
| Node.js 22+ oficial | `node --version` | instalar de nodejs.org |
| Git | `git --version` | instalar Git for Windows |
| Login no ASK CLI | existe `%USERPROFILE%\.ask\cli_config` | **o dono** roda `npx ask-cli@2 configure` (abre o navegador; ele entra na conta Amazon Developer). Responder **No** para "vincular conta AWS" |
| Skill ID | `%LOCALAPPDATA%\OMonstro\deploy.json` | o script pergunta na 1ª vez. Onde achar: seção 5.2 |

Na 1ª execução, o `ask init` pergunta o **nome da pasta**: digite `skill`.

## 3. Como o Claude roda o deploy

Na raiz do repositório (PowerShell):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

Opções:

| Opção | Para quê |
|---|---|
| `-SoSkill` | só a skill (mudou só `lambda/` ou o modelo de voz) |
| `-SoAgente` | só o instalador (mudou só `agent/`) |
| `-SemInstalar` | gera o instalador sem abrir (o dono instala depois) |
| `-SemTestes` | pula os testes. **Não use**, salvo pedido explícito do dono |

Passo a passo esperado do Claude:
1. Conferir `git status`. O deploy publica o que está **no disco**, inclusive o que ainda não foi commitado.
2. Avisar o dono: "vou publicar a skill/gerar o instalador".
3. Rodar o script **em segundo plano** e acompanhar a saída. A espera pela Amazon leva de 1 a 5 min.
4. Se terminar em `Pronto.`: pedir ao dono para testar uma frase. Se o agente mudou, o dono precisa concluir o instalador (UAC).
5. Se der erro: ler a mensagem e seguir a seção 4.

**Mudança de protocolo** (ex.: v1 → v2): skill e agente precisam ser atualizados **no mesmo dia**. Rode sem `-SoSkill`/`-SoAgente`.

## 4. Erros comuns

| Mensagem | Causa | O que fazer |
|---|---|---|
| `ASK CLI ainda sem login` | falta o `ask configure` | pedir ao dono para rodar `npx ask-cli@2 configure` |
| `A pasta '...\skill' não foi criada` | nome errado no `ask init` | apagar `%LOCALAPPDATA%\OMonstro\deploy` e rodar de novo, digitando `skill` |
| `git pull` falha (`non-fast-forward`) | alguém editou o código no console | apagar a pasta `deploy\skill` e rodar de novo (o repositório do GitHub é a fonte da verdade) |
| `A Amazon recusou o deploy` + modelo `FAILED` | erro no modelo de voz (ex.: nome de chamada inválido, frase-modelo duplicada) | console → Build → Interaction Model → **Build Model** mostra o erro exato (seção 5.3) |
| `A Amazon recusou o deploy` + código `FAILED` | o builder (Node 16 + yarn) falhou | console → Code → **Deployment logs** / CloudWatch (seção 5.4). Causa típica: dependência que exige Node > 16 |
| Nome de chamada recusado | regras da Amazon (ex.: uma palavra só) | o dono troca pela bandeja ("Trocar nome de chamada…") usando artigo: "a morgana" |

## 5. Navegar no console Alexa Developer

Base: `https://developer.amazon.com/alexa/console/ask` (o dono já está logado no Chrome dele).

> Use o navegador que o dono indicar. **Desligue a tradução automática do Chrome** nessa página, porque ela
> troca textos na tela (o conteúdo real não muda). Para ler código, prefira JavaScript na página (5.4).

### 5.1 Endereços diretos (troque `<SKILL_ID>`)
| Tela | URL |
|---|---|
| Lista de skills | `https://developer.amazon.com/alexa/console/ask` |
| Build (modelo de voz) | `https://developer.amazon.com/alexa/console/ask/build/custom/<SKILL_ID>/development/pt_BR/dashboard` |
| Editor JSON do modelo | `.../build/custom/<SKILL_ID>/development/pt_BR/json-editor` |
| Code (editor da Lambda) | `https://developer.amazon.com/alexa/console/ask/editor/<SKILL_ID>/development/pt_BR` |
| Test (simulador) | `https://developer.amazon.com/alexa/console/ask/test/<SKILL_ID>/development/pt_BR/` |

### 5.2 Skill ID
Lista de skills → embaixo do nome da skill → **"Copy Skill ID"**. Formato: `amzn1.ask.skill.<uuid>`.

### 5.3 Modelo de voz (aba Build)
- **Invocations → Skill Invocation Name:** nome de chamada atual.
- **Interaction Model → JSON Editor:** modelo inteiro. O deploy já envia; só edite à mão em emergência
  (e depois atualize `interactionModels/custom/pt-BR.json` no repositório, ou o próximo deploy desfaz).
- **Build Model:** compila e mostra os erros de validação em vermelho.

### 5.4 Código (aba Code)
- Árvore de arquivos à esquerda (`lambda/...`); editor Ace no centro.
- "Last Deployed" no canto superior direito mostra a data do último deploy.
- **Ler o arquivo aberto via JavaScript** (mais confiável que a tela):
  `ace.edit(document.querySelector('.ace_editor')).getValue()`
- **Deployment logs / CloudWatch:** botão no topo da aba Code. Lá aparecem erros do builder e da Lambda.
  Os logs só têm `actionId`, `requestId` e códigos, porque nunca logamos dados pessoais.
- **Media storage (S3):** onde fica `config/secrets.json` (senhas do broker). Não abrir nem copiar o
  conteúdo; só confirmar que o arquivo existe se o dono pedir.

### 5.5 Testar sem falar (aba Test)
- Habilite "Development" no seletor do topo.
- Digite como se falasse: `pede para o monstro pausar`. A resposta aparece no chat e o JSON de request/response ao lado.
- O PC precisa estar ligado com o agente rodando para dar "Feito.".

## 6. Depois do deploy (checagem rápida)
1. "Alexa, pede para o monstro abrir a Netflix" → "Feito."
2. "Alexa, pede para o monstro pausar" (com um vídeo tocando)
3. "Alexa, pede para o monstro abrir a Epic" (testa a busca na lista privada)
4. "Alexa, pede para o monstro desligar o computador em 30 minutos" → "sim" → depois "cancelar o desligamento"
