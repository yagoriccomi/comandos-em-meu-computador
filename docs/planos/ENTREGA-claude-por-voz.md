# ENTREGA — claude-por-voz (fases 3 e 4)

| Campo | Valor |
|---|---|
| **Branch** | `feature/claude-por-voz` |
| **Testes** | lambda **102/102**, agente **122/122** |
| **Modo** | 🔁 Loop |
| **Data** | 2026-10-04 |

## O que mudou
- **"Alexa, pede para o monstro perguntar ao Claude …"**:
  - o agente roda `claude -p` (assinatura do dono, Sonnet, só busca na web) em segundo plano;
  - a Alexa diz "Perguntei ao Claude";
  - quando termina, o PC **fala o resumo** (voz Maria, pt-BR) e mostra um balão;
  - **"… a resposta do Claude"** lê o resumo pela Alexa; enquanto ele pensa, a Alexa avisa.
- **"Alexa, pede para o monstro mandar o Claude Code …"**:
  - a ordem completa vai pelo stdin na pasta escolhida na bandeja;
  - por padrão continua o último chat da pasta (mantém o modelo dele);
  - **"novo chat, …"** abre conversa nova com **Opus mais atual**, esforço médio e modo automático.
- **Trava**:
  - Voice ID opcional (hash do `personId` nos segredos);
  - **PIN de 6 dígitos a cada 3 h**, ditado um a um;
  - "encerrar sessão do Claude Code" revoga;
  - 5 erros bloqueiam por 15 min;
  - o PIN nunca fica na sessão nem nos logs.
- **Bandeja → Claude Code**: abrir última resposta, escolher pasta das ordens, definir PIN, encerrar sessão.

## Para funcionar (passos do dono)
1. **Login do Claude Code fora do app** (uma vez): abrir um terminal, rodar `claude` e digitar `/login`. Hoje o CLI responde "Not logged in".
2. Instalar o agente novo (`agent\dist\O Monstro\Instalar O Monstro.cmd`, UAC, **S** para manter a configuração).
3. Bandeja → **Claude Code → Definir PIN…** (6 dígitos, sem zero no começo).
4. Bandeja → **Claude Code → Escolher pasta das ordens…** (ex.: `E:\Projetos\comandos-em-meu-computador`).
5. (Opcional) Voice ID:
   - no console da Alexa, ligar **Skill Personalization**;
   - falar uma ordem;
   - copiar o `personHash` do log `person_seen` (CloudWatch) para `allowedPersonIdHashes` no `secrets.json`.

## Limitações
- Ordens agem na **última conversa do Claude Code naquela pasta** (`--continue`). Não dá para injetar texto num chat aberto no app Claude, porque não há interface pública para isso.
- O Claude leva de segundos a minutos; a Alexa só confirma o envio.
- Voice ID pode não estar disponível no Brasil; sem ele, vale só o PIN (decisão do dono).
