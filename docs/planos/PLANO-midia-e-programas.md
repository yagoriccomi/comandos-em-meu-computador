# PLANO DE EXECUÇÃO — midia-e-programas

| Campo | Valor |
|---|---|
| **Tarefa** | `midia-e-programas` |
| **Origem** | descrição livre (conversa com o dono, 2026-10-04) |
| **Tipo** | História |
| **Modo de execução** | 💬 Interativo |
| **Data** | 2026-10-04 |
| **Branch** | `feature/midia-e-programas` (a partir da `main`; a skill única fica pausada em `feature/skill-unica-casa-inteligente`) |

---

## 1. Enunciado Canônico

- **Problema:** a skill só abre a Netflix e faz rotinas de energia. Não controla vídeo, volume, tela cheia, programas nem pesquisa.
- **Resultado esperado:** "Alexa, pede para o monstro …" controla:
  - vídeo: pausar e continuar, avançar e voltar N minutos/segundos, pular anúncio e abertura;
  - volume: aumentar e abaixar (20% ou o valor dito), mudo;
  - tela cheia: entrar e sair;
  - pesquisa no Google;
  - programas: abrir, fechar e destravar qualquer programa do menu Iniciar que esteja na lista do dono, com apelidos.
- **Como validar:** com um vídeo do YouTube tocando, cada frase faz o efeito na hora. "Abrir o Discord", "fechar o Discord" e "destravar o Discord" funcionam. "Abrir o server de Minecraft" executa o atalho.

## 2. Escopo

**Vou fazer:**
- **Mídia:**
  - pausar/continuar: uma única tecla Play/Pause;
  - volume: ±20% por padrão, ou o valor dito de 2 a 100;
  - mudo: liga e desliga;
  - tela cheia: **F** se a janela da frente for navegador, **F11** se for outro programa; para sair, **Esc** no navegador e **F11** fora dele;
  - avançar e voltar com tempo falado;
  - pular: clica no botão "Pular…"/"Skip…" visível.
- **Pesquisa:** "pesquisar no Google {o que for}", que abre `google.com/search?q=…` no navegador padrão.
- **Programas:**
  - lista detectada automaticamente do menu Iniciar (todos os programas, inclusive apps da Loja como WhatsApp e Claude);
  - a lista fica num arquivo **privado** em `%LOCALAPPDATA%\OMonstro\programas.json`, com nome, apelidos, ativo/inativo, como abrir e o nome do processo;
  - pelo **menu da bandeja**: "Atualizar lista de programas", "Editar lista de programas" e "Gerar modelo de voz para a Alexa";
  - abrir, fechar e destravar (encerrar à força e abrir de novo).
- **Tradução das falas ("explorador de tarefas"):** "gerenciador de tarefas" e "explorador de arquivos" ficam como dois programas separados. "Cloud" vira apelido de **Claude**.

**NÃO vou fazer (escopo negativo)** [#8]:
- "próximo vídeo" (dispensado pelo dono);
- confirmação para fechar o Server Minecraft (é só um atalho do jogo, segundo o dono);
- nomes dos programas no GitHub (o repositório é **público**): o modelo de voz versionado leva só a Netflix, e os seus programas entram apenas no arquivo gerado localmente para colar no console da Alexa;
- perguntas ao Claude ou ordens ao Claude Code pela Alexa: tarefa separada, que precisa de decisões próprias (ver resposta na conversa).

### Ajustes do dono (2026-10-04, 2ª rodada)
- Mídia: se houver uma sessão no **menu de mídia do Windows** (SMTC), pausar, continuar, avançar e voltar agem nela, e avançar/voltar ficam exatos em segundos. Sem sessão, as teclas vão para a janela da frente, com a conta feita conforme o site.
- Scripts Python do menu Iniciar ("alterna para a TV", "troca para monitores", "ativa todos") entram como programas com apelidos.
- Frases sem "pede para o monstro": gerar a **lista de rotinas** para o dono criar no app. Os nomes nativos ("Alexa, liga o VS Code") ficam para a skill única (aparelhos e cenas de Casa Inteligente).
- **Deploy:** `scripts/deploy.ps1` (ASK CLI → repositório da Alexa-hosted, com o modelo de voz montado com a lista privada de programas; build do agente; abre o instalador) e o item "Publicar atualização" na bandeja.
- Claude (perguntas) e Claude Code (ordens com trava) entram como tarefas seguintes, depois das respostas do dono.

## 3. Premissas Assumidas

| # | Premissa | Por quê | Se estiver errada… |
|---|---|---|---|
| P1 | Volume de 20 em 20% significa 10 toques da tecla de volume (cada toque vale 2%) | É o comportamento padrão do Windows | Ajustar a constante |
| P2 | Avançar/voltar: no YouTube, **L/J** = 10 s e **setas** = 5 s; nos outros sites (Netflix, Prime), **seta** = 10 s; o tempo é arredondado ao passo do site | Atalhos oficiais de cada site | O valor real pode ficar alguns segundos diferente do pedido |
| P3 | Teclas (F, F11, setas, J/L, Esc) vão para a **janela da frente** | É como o Windows entrega teclas | Se outra janela estiver na frente, a tecla vai para ela |
| P4 | "Pular" é **experimental**: usa a acessibilidade do Windows para achar e clicar o botão | Não existe tecla de atalho para pular anúncio | Para de funcionar se o site mudar o botão |
| P5 | "Fechar" = pedido normal de fechar, como clicar no X. Se depois de 5 s o programa continuar rodando **sem janela visível** (escondido na bandeja, como o Discord), é encerrado à força. Se tiver janela (ex.: VS Code perguntando se quer salvar), fica aberto | Não perde trabalho não salvo e ainda fecha os que se escondem na bandeja | O dono usa "destravar" para forçar |
| P6 | Programas abrem por `explorer.exe shell:AppsFolder\<id do menu Iniciar>`, o mesmo caminho do clique no menu Iniciar | Funciona para atalhos e apps da Loja | — |
| P7 | O nome do processo é detectado (alvo do atalho, Squirrel `--processStart`, manifesto do app da Loja) e o dono pode corrigir no arquivo | Atalhos às vezes apontam para um lançador | "Fechar" falha até o dono corrigir o campo `processo` |
| P8 | Atualizar a lista de nomes na Alexa exige colar o modelo gerado no editor JSON do console e clicar em "Build Model" | Alexa-hosted não tem como atualizar o modelo pelo PC | Na skill única (ask-cli) isso vira um comando |

## 4. Decisão Visual

- **Superfície visual?** Mínima: 3 itens novos no menu da bandeja, no mesmo padrão dos atuais. O arquivo da lista abre no Bloco de Notas.
- **Mockup?** Não. É um ajuste pontual dentro de um padrão que já existe (menu do NotifyIcon), por isso `design-de-interface-projeto` não foi acionada.

## 5. Terreno

| Arquivo | O que muda |
|---|---|
| `lambda/protocol/message.js` e `agent/src/protocol` (cópia) | **v:2**: os parâmetros aceitam inteiro **ou** texto (até 200 caracteres, sem caracteres de controle). É mudança incompatível, então a versão sobe (regra do CLAUDE.md) |
| `lambda/catalog/skill-catalog.json` | 12 ações novas; tipos de parâmetro `integer` (agora com `default`), `duration`, `text` e `program` |
| `lambda/domain/actionResolver.js` | resolve os tipos novos: ISO 8601 → segundos; texto do SearchQuery; id `p` + 12 hex vindo do slot de aplicativo |
| `lambda/handlers/actionHandler.js` e `speech.js` | perguntas para parâmetro faltando ("Quanto tempo?", "O que você quer pesquisar?") |
| `interactionModels/custom/pt-BR.json` (+ `scripts/sync-catalog.js`) | intents novos: Volume ↑/↓, Avançar/Voltar, Pesquisar, Fechar/Destravar aplicativo; sinônimos em ROTINA |
| `agent/src/desktop/input-helper.ps1` (novo) | processo PowerShell **persistente** na sessão do usuário. Lê do stdin só verbos de uma lista fechada e números inteiros, e manda teclas e cliques |
| `agent/src/desktop/scan-programs.ps1` (novo) | lista os programas do menu Iniciar em JSON (só leitura) |
| `agent/src/programs/` (novo) | lista privada: gerar, mesclar mantendo apelidos e ativo/inativo, validar, gerar o modelo de voz |
| `agent/src/executor/` | executores internos (mídia, programas, pesquisa) além dos de `actions.json` |
| `agent/src/config/localActions.js` | entrada `{"id": …, "interno": true, "enabled": true}` para as ações internas |
| `agent/src/install/installer.js` | ao reinstalar, **acrescenta** ao `actions.json` as ações internas novas, sem mexer nas suas |
| `agent/src/desktop/tray.ps1` e `trayController.js` | 3 itens de menu novos |

**Reaproveitamento** [#6]: as ações novas passam pelo mesmo caminho das atuais (assinatura, anti-replay, ack e canal local com a sessão do desktop).

## 6. Passos Atômicos

| # | Arquivo alvo | O que muda | Prática | Como verificar |
|---|---|---|---|---|
| 1 | protocolo (2 cópias) | v:2 com parâmetros inteiro ou texto limitado | [#51][#28] | testes do protocolo; teste de igualdade das cópias |
| 2 | catálogo, resolver e handler da Lambda | tipos de parâmetro novos e ações novas | [#51][#41] | testes do resolver: duração inválida, texto longo, id de programa forjado |
| 3 | modelo de voz e sync | intents e sinônimos novos | — | `npm run catalog:check` |
| 4 | `input-helper.ps1` e `inputHelper.js` | helper persistente com verbos fechados | [#51][#2] | testes do lado Node (formatação e recusa de verbos); teste manual de cada tecla |
| 5 | `scan-programs.ps1` e `programs/` | detecção, mesclagem, validação e modelo de voz | [#6][#37] | testes de mesclagem (mantém apelidos), validação e geração do modelo |
| 6 | executores internos | mídia, programas (abrir, fechar, destravar) e pesquisa (URL codificada) | [#51][#9] | testes com `execFile` falso: argumentos exatos e sem shell |
| 7 | `localActions.js` e instalador | ações internas e mesclagem do `actions.json` | [#31] | testes |
| 8 | bandeja | 3 itens de menu | — | manual |
| 9 | docs (`CLAUDE.md`, `README`, `ENTREGA-midia-e-programas.md`) | regras novas: v:2, texto da pesquisa, lista privada | [#96] | leitura |
| 10 | E2E | build do pacote → você reinstala → cola o modelo → testes por voz | [#43] | cada frase da seção 1 |

## 7. Impacto em Dados e Contratos

- **Contrato skill ↔ agente:** v:1 → **v:2**. Lambda e agente precisam ser atualizados juntos: publicar a skill **e** reinstalar o agente.
- **LGPD:**
  - o texto da pesquisa passa pela Amazon, pela Lambda e pelo broker (TLS), **nunca é gravado em log** (nem na Lambda, nem no agente) e só vira o parâmetro `q` codificado;
  - os nomes dos programas ficam no seu PC e no modelo de voz da Amazon, nunca no GitHub;
  - o id que trafega é um hash (`p` + 12 hex), não o nome [#63].

## 8. Plano de Testes

| Nível | O que cobre | Falhas cobertas |
|---|---|---|
| Unidade [#41] | protocolo v:2, resolver, lista de programas, modelo de voz, executores | texto com controle/longo, duração 0 ou maior que 3 h, id inexistente, verbo fora da lista, `processo` com caminho |
| Integração [#42] | skill → broker em memória → agente falso | ação interna desativada no `actions.json` → "Não consegui…" |
| E2E [#43] | voz real no PC | navegador fora de foco, programa já fechado |

**Comando:** `npm test` em `lambda/` e `agent/`.

## 9. Riscos e Rollback

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| "Pular" não acha o botão | Média | Alexa diz "Não consegui…" | marcado como experimental |
| Busca do botão "Pular" demora mais que 3,5 s | Média | timeout | busca só na janela da frente, com limite de tempo |
| Agente antigo com skill nova (v:2) | Certa até reinstalar | nada funciona | publicar e reinstalar no mesmo momento |
| Nome de programa mal reconhecido | Média | ação errada ou desconhecida | apelidos no arquivo |

**Rollback** [#84]: publicar de novo a `main` antiga no console e reinstalar o pacote anterior (`dist/` da versão anterior).

## 10. Definição de Pronto
- [ ] Passos 1–10
- [ ] `npm test` verde nos dois pacotes [#49]
- [ ] Nenhum nome de programa e nenhum texto de pesquisa no Git ou nos logs [#37][#63]
- [ ] Commits atômicos [#31][#32]
- [ ] `ENTREGA-midia-e-programas.md`
