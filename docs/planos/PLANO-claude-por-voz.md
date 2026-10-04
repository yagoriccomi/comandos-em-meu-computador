# PLANO DE EXECUÇÃO — claude-por-voz (fases 3 e 4)

| Campo | Valor |
|---|---|
| **Tarefa** | `claude-por-voz` |
| **Origem** | descrição livre (conversa com o dono, 2026-10-04) |
| **Tipo** | História |
| **Modo** | 🔁 Loop (dono: "pode fazer tudo que precisar") |
| **Branch** | `feature/claude-por-voz` |

## 1. Enunciado Canônico
- **Problema:** o dono quer perguntar ao Claude e dar ordens ao Claude Code pela Alexa, usando a **assinatura** (sem créditos da API).
- **Resultado esperado:**
  1. "Alexa, pede para o monstro **perguntar ao Claude** …": o Claude Code do PC (assinatura, Sonnet mais atual, só busca na web) responde; o **PC fala a resposta** e mostra um balão. Depois, "pede para o monstro **a resposta do Claude**" lê o resumo pela Alexa.
  2. "Alexa, pede para o monstro **mandar o Claude Code** …": a ordem completa vai para o Claude Code numa pasta de projeto. Por padrão continua a última conversa da pasta, mantendo o modelo dela; se a frase começar com "novo chat", abre conversa nova (modo automático, **Opus mais atual**, esforço médio). Trava: **Voice ID** (quando houver) + **PIN de 6 dígitos a cada 3 horas**, ditado dígito a dígito. "**encerrar sessão do Claude Code**" revoga na hora.
- **Como validar:** frases reais; testes de unidade e integração para trava, PIN, tentativas e resumo.

## 2. Escopo / escopo negativo
**Faz:** ações internas `perguntar_claude`, `resposta_claude`, `claude_code_ordem`, `claude_code_encerrar`; ack v2 com `text` (resumo para voz) e status `pending` / `pin_required` / `locked`; bandeja com "Definir PIN do Claude Code…", "Escolher pasta do Claude Code…" e "Abrir última resposta do Claude"; voz do Windows (pt-BR) lendo pelo stdin.
**Não faz [#8]:**
- entrar em chats abertos no app Claude, porque não há interface pública para isso. "Chat aberto" = a última conversa do Claude Code naquela pasta (`--continue`);
- API paga;
- ler a resposta inteira pela Alexa (só o resumo, até 600 caracteres).

## 3. Premissas Assumidas (Loop)
| # | Premissa | Por quê | Se errada |
|---|---|---|---|
| P1 | O dono faz `claude` → `/login` uma vez num terminal; o agente usa o `claude.exe` do npm global | Hoje o CLI responde "Not logged in" fora do app | Fase 3/4 respondem "Não consegui" até o login |
| P2 | Perguntas usam `--model sonnet --effort medium --tools WebSearch,WebFetch --permission-mode dontAsk` | Sem ferramentas de arquivo ou comando = sem risco no PC [#55] | Ajustar as constantes |
| P3 | Ordens usam `--permission-mode auto`; chat novo `--model opus --effort medium` (o alias `opus` acompanha o Opus mais atual) | Pedido do dono | — |
| P4 | Texto falado vai pelo **stdin**, nunca como argumento [regra do projeto] | Lista fechada | — |
| P5 | PIN guardado como hash scrypt com sal em `%LOCALAPPDATA%\OMonstro\claude-code.json`; 5 erros = bloqueio de 15 min | Força bruta por voz [#54][#58] | — |
| P6 | Voice ID: se `allowedPersonIdHashes` estiver nos segredos, a voz precisa bater; se estiver vazio, vale só o PIN a cada 3 h (decisão do dono). A Lambda loga o **hash** do personId ao ver uma voz nova, para o dono cadastrar | Recurso pode não existir no Brasil | — |
| P7 | Pasta padrão das ordens: escolhida pela bandeja; sem escolha → recusa com aviso | Não adivinhar onde o Claude Code age | — |
| P8 | Uma pergunta/ordem por vez; uma nova substitui a anterior ainda rodando | KISS [#7] | — |

## 4. Decisão visual
Balão e itens de menu no padrão existente; sem mockup.

## 5. Passos atômicos
| # | Arquivos | Mudança | Prática | Verificação |
|---|---|---|---|---|
| 1 | protocolo | ack com `text` ≤ 600 e status `pending`/`pin_required`/`locked` | [#28] | testes |
| 2 | catálogo, modelo, resolver, handler, speech | intents Perguntar/Resposta/Mandar/Encerrar/PIN; fala do resumo; diálogo do PIN | [#41] | testes da skill |
| 3 | Lambda | Voice ID opcional (hash de `person.personId`) | [#55][#63] | testes |
| 4 | agente `claude/` | localizar o `claude.exe`, rodar com stdin, ler JSON, extrair o resumo | [#2] | testes com processo falso |
| 5 | agente `claude/sessionLock` | PIN scrypt, janela de 3 h, revogar, limite de tentativas | [#54][#58] | testes |
| 6 | agente `speak.ps1` + notificação | voz do Windows lendo o stdin; balão; arquivo da última resposta | — | manual |
| 7 | bandeja | definir PIN, escolher pasta, abrir resposta | — | manual |
| 8 | docs, CLAUDE.md, ENTREGA | regras novas | [#96] | leitura |
| 9 | deploy + PR/merge | publicar skill + pacote | [#77] | `npm test` + deploy |

## 6. Riscos / rollback
- O Claude demora mais do que o esperado: é assíncrono, e a Alexa só confirma o envio.
- PIN ouvido errado: a pessoa repete; o bloqueio só entra depois de 5 erros.
- Rollback: `git revert` do merge e deploy da `main` anterior [#84].
