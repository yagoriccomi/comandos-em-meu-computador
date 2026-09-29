# ENTREGA — alexa-agente

| Campo | Valor |
|---|---|
| **Branch** | `feature/agente-e-comunicacao-websocket` (local; sem push) |
| **Data** | 2026-09-28 |
| **Plano** | [PLANO-alexa-agente.md](PLANO-alexa-agente.md) |
| **Auditoria** | [REVIEW.md](../../REVIEW.md) |

## O que foi entregue

| Parte | Arquivos principais |
|---|---|
| Protocolo assinado (fonte única, usado pelos dois lados) | `lambda/protocol/message.js` |
| Catálogo público + geração do modelo de voz | `lambda/catalog/skill-catalog.json`, `lambda/scripts/sync-catalog.js`, `interactionModels/custom/pt-BR.json` |
| Skill (handlers, confirmação por voz, segredos do S3, MQTT + ack) | `lambda/index.js`, `lambda/handlers/*`, `lambda/domain/*`, `lambda/config/*`, `lambda/messaging/*`, `lambda/speech.js` |
| Agente: catálogo local, executor sem shell, segurança, log | `agent/src/config/*`, `agent/src/executor/*`, `agent/src/security/*`, `agent/src/logger/*` |
| Agente: núcleo, canal local 127.0.0.1 com autenticação mútua, desktop, ícone | `agent/src/core/*`, `agent/src/desktop/*` |
| Instalador (pasta com Node oficial assinado) + build | `agent/src/install/*`, `agent/src/main.js`, `agent/build/build-package.js` |
| Simulador da Alexa, docs | `agent/scripts/simular-alexa.js`, `README.md`, `CLAUDE.md`, `REVIEW.md` |

## Verificação

- `lambda`: **64 testes** passando · `agent`: **61 testes** passando (inclui integração skill ↔ broker em memória ↔ núcleo e canal local real em 127.0.0.1).
- `npm audit`: 0 vulnerabilidades nos dois pacotes. Nenhum segredo no Git.
- Ícone da bandeja executado de verdade (script abre, mostra balão e fecha com o processo pai).
- `o-monstro.exe` **gerado com sucesso**, mas **removido pelo Kaspersky** logo em seguida. Por isso não foram executados:
  o instalador real, as tarefas agendadas e a simulação ponta a ponta com o HiveMQ.

## Premissas mantidas

P1–P8 do plano. Mudança em relação ao plano: o protocolo não é mais copiado para o agente. O agente importa de
`lambda/` e o esbuild embute no `.exe`, então há uma fonte única e nenhuma divergência possível.

## Pendências

1. **Antivírus × `.exe`** (decisão do dono): exceção no Kaspersky, falso positivo, assinatura de código ou empacotamento em pasta.
2. Instalação real + `npm run simular -- bloquear_tela` com as credenciais do HiveMQ.
3. Validar desligar/reiniciar **antes do logon** (tarefa S4U).
4. Publicação da skill (combinado para depois).
5. Próximo passo natural do pipeline: `configurar-ci-cd-projeto` (rodar os testes a cada push).

## Verificação real no PC (2026-09-29, instalador em pasta)

Com o HiveMQ real, pelo `npm run simular` (faz o papel da Lambda):

| Ação | Caminho | Resultado | Tempo |
|---|---|---|---|
| `cancelar_desligamento` sem nada agendado | núcleo | "Não consegui" (esperado, código 1116) | 3,8 s |
| `abrir_netflix` | núcleo → canal local → desktop | "Feito." | 2,2 s |
| `desligar_em_minutos` 240 | núcleo (S4U) | "Feito." — permissão de desligar confirmada | 3,2 s |
| `cancelar_desligamento` | núcleo | "Feito." (desligamento cancelado) | 2,0 s |

Pendências restantes: publicação da skill (enviar `secrets.json` ao S3), validar desligar com o PC na tela de
login (antes de qualquer logon) e texto do `stderr` com acentos corrompidos no log local (codificação do console).
