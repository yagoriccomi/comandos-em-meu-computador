# PLANO DE EXECUÇÃO — midia-e-programas (v2, plano completo)

| Campo | Valor |
|---|---|
| **Tarefa** | `midia-e-programas` (inclui a retomada da skill única e as integrações com Claude) |
| **Origem** | descrição livre (conversa com o dono, 2026-10-04, 3ª rodada) |
| **Tipo** | Épico, fatiado em fases |
| **Modo** | 💬 Interativo |
| **Branch** | `feature/midia-e-programas`; a fase 2 continua em `feature/skill-unica-casa-inteligente` |

---

## 0. Decisões do dono (2026-10-04, 4ª rodada) — prevalecem sobre o resto do documento

- **Skill única (Casa Inteligente) cancelada.** "Ligar o PC" continua com a skill e a rotina de terceiros. As frases sem nome de skill ("Alexa, pausar o monstro") ficam fora. A branch `feature/skill-unica-casa-inteligente` fica arquivada.
- **Formas de chamar** (pt-BR oficial):
  - "pede/peça para o monstro …", "pergunta para o monstro …", "abre/abrir o monstro e/para …", "usa/usar o monstro e …", "começa o monstro e …";
  - "manda o monstro …" e "fecha no monstro …" **não são oficiais**: testar e, se não funcionarem, usar rotina;
  - a Amazon não oferece API para cadastrar rotinas, então o dono cria as que quiser no app, a partir da lista que a bandeja gera.
- **Frases livres = apelidos:** "alterna para a TV", "troca para monitores" e "ativa todos" são **apelidos** de programas/scripts e funcionam com qualquer forma de chamar. Se a frase não for uma ação conhecida, vai para o PC, que procura na lista privada.
- **Nome de chamada personalizável:** "o monstro" é o nome do PC do dono; cada pessoa escolhe o seu ("a Morgana"). A bandeja grava o nome e o deploy aplica.
  - Para aceitar "o" e "a", tentar o nome **sem artigo** (uma palavra). Se a Amazon recusar, o nome é gravado com o artigo escolhido.
- **Escolha entre opções:** a Alexa fala os nomes. A resposta pode ser o nome ou "o primeiro", "o segundo", "o terceiro"…
- **Pular:** "pede para o monstro pular" (botão genérico Pular/Skip/abertura/créditos/introdução/recapitulação/próximo episódio) entra na fase 1.
- **Deploy:** `scripts/deploy.ps1` + `docs/DEPLOY.md` (manual para o Claude: como rodar o script e como navegar no console Alexa Developer).
- **Claude Code (fase 4):**
  - "manda o Claude Code …" repassa a ordem **completa**;
  - num **chat já aberto**: mantém o modelo do chat e só repassa o texto;
  - num **chat novo**: modo **automático**, **Opus mais atual** (alias `opus`), esforço **médio**;
  - **trava:** Voice ID da pessoa autorizada + **PIN de 6 dígitos** falado dígito a dígito ("um, dois, três…"), pedido a cada **3 horas** de "sessão ativa";
  - "**encerrar sessão do Claude Code**" revoga a sessão na hora;
  - PIN guardado só como hash.

## 1. Enunciado Canônico

- **Problema:** controlar mídia, programas e pesquisa no PC só pela voz, com frases naturais, sem colar modelo no site da Alexa e sem expor a lista de programas.
- **Resultado esperado:**
  1. "Alexa, **pausar o monstro**", "**aumentar volume do monstro**", "**avançar o monstro em 30 segundos**", "**pular no monstro**";
  2. "Alexa, pede para o monstro **abrir a Epic**": o PC procura o programa na lista privada, entende nome curto e erro de pronúncia, e pergunta qual quando houver mais de um;
  3. pesquisa no Google;
  4. arquivo privado de programas editável pela bandeja;
  5. deploy por script e pela bandeja.
- **Como validar:** cada frase da seção 2 funciona por voz no PC real.

## 2. Frases e por onde passam

A Alexa só entende "**verbo + o monstro**" sem o "pede para" quando o monstro é um **aparelho de Casa Inteligente**. Isso exige a **skill única**, que depende da sua conta AWS.

| Frase | Canal | Interface (pt-BR) | Situação |
|---|---|---|---|
| Alexa, ligar o monstro | Casa Inteligente | PowerController + WakeOnLAN | WoL não está oficialmente em pt-BR; a fase 2 testa |
| Alexa, pausar o monstro / continuar no monstro / despausar o monstro | Casa Inteligente | **PlaybackController** (pt-BR ✅) | fase 2 |
| Alexa, avançar o monstro em 30 segundos / voltar no monstro em 3 minutos | Casa Inteligente | **SeekController** (pt-BR ✅) | fase 2 |
| Alexa, aumentar/abaixar volume do monstro | Casa Inteligente | Speaker **não** tem pt-BR → **RangeController "Volume"** (pt-BR ✅) | fase 2, **precisa de teste** |
| Alexa, pular no monstro | Casa Inteligente | PlaybackController "Next" (o pular genérico) | fase 2, **precisa de teste** da frase em pt-BR |
| Alexa, ativa todos / (scripts) | Casa Inteligente | **SceneController** (pt-BR ✅): cada script vira uma cena | fase 2 |
| Alexa, **pede para o monstro** pausar / aumentar o volume / avançar 30 segundos / pular / tela cheia / mudo | Skill personalizada | — | **fase 1 (já funciona hoje, sem AWS)** |
| Alexa, pede para o monstro pesquisar no Google … | Skill personalizada | AMAZON.SearchQuery | fase 1 |
| Alexa, pede para o monstro abrir/executar/fechar/destravar … | Skill personalizada | slot livre + busca no PC | fase 1 |
| Alexa, pergunta para o Claude … | Skill personalizada | API da Anthropic (Sonnet 5.5) | fase 3 |
| Alexa, manda o Claude Code … | Skill personalizada | agente → Claude Code no PC, com trava | fase 4 (respostas pendentes) |

Atalhos sem "monstro" ("Alexa, alterna para a TV") só funcionam por **rotina do app Alexa** ou por **cena** ("Alexa, ativar TV"). A bandeja ganha um item que gera a lista pronta de rotinas para você criar no app.

## 3. Escopo por fase

### Fase 1: skill personalizada (Alexa-hosted, funciona hoje)

**1.1 Mídia**
- Pausar/continuar, avançar/voltar exato e pular agem no **menu de mídia do Windows** (SMTC) quando há algo tocando nele.
- Sem SMTC, as teclas vão para a janela da frente:
  - YouTube: K, J/L (10 s) e setas (5 s);
  - outros sites: espaço e setas (10 s).
- Volume do Windows: ±20% por padrão, ou o valor dito.
- Mudo.
- Tela cheia: **F** no navegador e **F11** fora dele; para sair, **Esc** e **F11**.

**1.2 Pular genérico**
- Procura na janela da frente um botão cujo nome comece com: Pular, Skip, Ignorar, Avançar abertura, Pular abertura, Pular introdução, Pular créditos, Pular recapitulação, Próximo episódio.
- Funciona em YouTube, Netflix, Prime, Disney+, Max e outros que exponham o botão. É **experimental**.

**1.3 Pesquisa**
- Abre `google.com/search?q=<texto codificado>`.
- O texto nunca é gravado em log e nunca vira comando.

**1.4 Programas (sem colar modelo no site da Alexa)**
- **Lista privada** em `%LOCALAPPDATA%\OMonstro\programas.json`, só no seu PC e fora do Git. Ela é criada por detecção automática:
  - menu Iniciar (atalhos, apps da Loja, scripts Python);
  - **processos de cada programa**, detectados pela pasta de instalação. Exemplos: Discord = `Discord.exe` + `Update.exe`; Claude = app, Cowork e Code.
- Cada programa tem:
  - `ativo`;
  - `apelidos` (quantos quiser);
  - `verbos` por ação, todos ativos por padrão;
  - `processos` (editável).
- **Verbos (os "sufixos")** são listas globais editáveis, que cada programa liga ou desliga:
  - abrir: abrir, abre, executar, executa, iniciar, inicia, rodar, roda, ligar, liga;
  - fechar: fechar, fecha, encerrar, encerra, sair do;
  - destravar: destravar, destrava, reabrir, reiniciar.
  - Um verbo novo exige atualizar o modelo de voz, o que o **deploy** faz sozinho.
- **Busca no PC** (é aqui que a Alexa "procura se o nome existe"):
  - a Alexa envia o nome falado (texto) e o agente compara com nomes e apelidos da lista;
  - a comparação ignora acentos e pontuação e aceita início de palavras ("Epic" → Epic Games Launcher), letras juntas ou separadas ("pp ssp p" → PPSSPP) e erros pequenos ("ppspp");
  - se houver **um** resultado claro, executa;
  - se houver **vários**, a Alexa diz: "Encontrei Cloudflare WARP e Cloudflare One. Qual deles?". Você responde o nome ou "o primeiro" / "o segundo";
  - se não houver nenhum, ela cita os **parecidos**, quando existirem.
- **Fechar:**
  - pede para fechar normalmente, como clicar no X;
  - depois de 5 s, encerra à força só os processos **sem janela visível** (os escondidos na bandeja).
- **Destravar:**
  - encerra à força **todos os processos listados**, pelo **caminho** do executável e não só pelo nome, para não derrubar outro programa com o mesmo nome;
  - depois abre o programa de novo.

**1.5 Bandeja (menu novo)**
- Atualizar lista de programas: detecta de novo e mantém os seus apelidos, verbos e escolhas.
- Editar lista de programas: abre no Bloco de Notas.
- Trocar a palavra de chamada: grava a palavra nova; o próximo deploy aplica.
- Gerar lista de rotinas do app Alexa.
- Publicar atualização: roda o deploy.

**1.6 Deploy** (`scripts/deploy.ps1`, também chamado pela bandeja)
1. Testes (`npm test` nos dois pacotes).
2. ASK CLI: envia o código e o modelo de voz (com a palavra de chamada e os verbos atuais) para o **repositório interno da Alexa-hosted** (`ask init --hosted-skill-id` + `git push`). A Amazon compila sozinha, **sem colar nada no site**.
3. Build do agente e abertura do instalador.
4. Um `docs/DEPLOY.md` explica como o Claude roda o deploy.

### Fase 2: skill única (Casa Inteligente)
- Retoma `feature/skill-unica-casa-inteligente`. **Depende da sua conta AWS.**
- O aparelho "Monstro" ganha: ligar (WoL), Playback, Seek, Range "Volume" e cenas para os scripts.
- O ack do agente volta para o event gateway quando a frase vem da Casa Inteligente.
- Testar cedo: WoL em pt-BR, volume por RangeController e "pular" por PlaybackController.

### Fase 3: "Alexa, pergunta para o Claude …"
- Lambda → API da Anthropic com **Sonnet 5.5** e busca na web ligada (é o mais perto do Cowork que dá para chamar da Alexa).
- Resposta curta para a Alexa ler (limite de cerca de 8 s; aviso "Só um instante" enquanto busca).
- Precisa de uma **chave da API**, guardada no cofre e nunca no Git.

### Fase 4: "Alexa, manda o Claude Code …"
- Aguarda as respostas sobre a trava (Voice ID + PIN + confirmação) e o nível de permissão.

## 4. Escopo negativo [#8]
- **Ler a "Visão geral por IA" do Google:** desaconselhado.
  - Ela aparece só no navegador, alguns segundos depois de a página abrir, e o Google não oferece acesso oficial a ela.
  - A Alexa precisaria esperar mais do que o limite dela, e a leitura quebraria a cada mudança do Google.
  - Recomendo **"Alexa, pergunta para o Claude"** (fase 3) para respostas faladas e o Google para abrir na tela.
- Cada pessoa da casa com uma palavra diferente: uma skill tem **um** nome de chamada. Dá para trocar a palavra (vale para todos), mas não para ter várias ao mesmo tempo.
- Aparelhos de Casa Inteligente por programa ("Alexa, liga o VS Code"): exigiria mandar a lista de programas para a Amazon. Fica fora; programas usam a frase com "monstro" ou rotinas.

## 5. Contratos (o que muda)
- **Protocolo v2** (já feito): parâmetros inteiros ou texto curto.
- **Ack v2**: além de ok/erro, o status `ambiguous` (com até 3 nomes de opção) e `not_found` (com até 3 parecidos). Os nomes têm no máximo 60 caracteres, passam pelo broker e pela Lambda **sem serem gravados em log** e são usados só para a Alexa falar.
- **Catálogo**:
  - `abrir_programa`, `fechar_programa` e `destravar_programa` recebem `programa` (texto falado), `verbo` (id do verbo) e `exato` (0/1, depois da escolha);
  - o slot `programa` vira tipo livre (AMAZON.SearchQuery não combina com outro slot, então é um tipo personalizado com exemplos genéricos, que aceita qualquer nome).
- **O trabalho já commitado nesta branch** (tipos `duration`/`text`, volume com default, pesquisa) **continua valendo**. O tipo `program` por hash será **trocado** pelo texto falado.

## 6. Passos atômicos (fase 1)

| # | Arquivo(s) | Mudança | Prática | Verificação |
|---|---|---|---|---|
| 1 | protocolo | ✅ v2 com texto | [#51][#28] | testes |
| 2 | catálogo, resolver, speech, modelo | ✅ mídia, volume, tempo, pesquisa | [#41] | 84 testes |
| 3 | protocolo e commandBus | ack v2 (`ambiguous` / `not_found` + opções) | [#28] | testes |
| 4 | catálogo, resolver, handler, modelo | programas: texto + verbo + diálogo de escolha (sessão) | [#9] | testes de escolha e de "o segundo" |
| 5 | `input-helper.ps1` + `inputHelper.js` | ajudante persistente (✍ em andamento) | [#51] | testes do lado Node + manual |
| 6 | `programs/` (lista, mesclagem, busca aproximada, verbos, processos) | lista privada e busca | [#6][#41] | testes da busca com os seus exemplos (Epic, PPSSPP, Cloudflare) |
| 7 | `scan-programs.ps1` | menu Iniciar + processos por pasta | — | manual |
| 8 | `internal/` | executores de mídia, programas e pesquisa | [#51] | testes com processos falsos |
| 9 | `localActions`, instalador | ações internas + mesclagem do `actions.json` | — | testes |
| 10 | bandeja | 5 itens novos | — | manual |
| 11 | `scripts/deploy.ps1` + `docs/DEPLOY.md` | deploy completo | [#77] | 1 deploy real |
| 12 | docs | CLAUDE.md (regras novas), README, ENTREGA | [#96] | leitura |
| 13 | E2E | voz real | [#43] | frases da seção 2 |

## 7. LGPD e segurança
- **Nada que vem da voz vira comando:**
  - o nome falado só é **comparado** com a lista local;
  - o que executa é sempre o atalho, o app ou o processo que **está na lista**, validado.
- **Encerrar processos:**
  - só pelos caminhos listados no arquivo privado;
  - o ajudante aceita apenas caminhos absolutos validados, nunca curingas.
- **Logs:**
  - não registram o texto da pesquisa, o nome falado nem os nomes de opção;
  - registram só o actionId e o resultado.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Slot livre reconhece mal nomes estrangeiros | apelidos em português + busca aproximada + diálogo de escolha |
| Frases de Casa Inteligente (volume/pular) não reconhecidas em pt-BR | testar logo no início da fase 2; plano B é a frase com "pede para o monstro" |
| Destravar o Claude encerra também esta sessão do Claude Code | é o que o dono pediu; o arquivo deixa remover o processo da lista |
| Deploy pela bandeja precisa da sua conta Amazon no ASK CLI | `ask configure` uma vez |
