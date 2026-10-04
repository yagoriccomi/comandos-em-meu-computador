# ENTREGA — midia-e-programas (fase 1)

| Campo | Valor |
|---|---|
| **Branch** | `feature/midia-e-programas` (8 commits, ainda sem push) |
| **Testes** | lambda **94/94**, agente **106/106** |
| **Pacote** | `agent/dist/O Monstro/` gerado (agente 2.0.0) |
| **Data** | 2026-10-04 |

## O que mudou
- **Protocolo v2** (incompatível com o v1): parâmetros de texto curto; ack com `ambiguous`/`not_found` + opções.
- **Mídia** ("pede para o monstro …"):
  - pausar/continuar, avançar/voltar com o tempo falado e pular genérico. Usam o menu de mídia do Windows; quando ele não está disponível, teclas com a conta feita conforme o site;
  - volume ±20% ou o valor dito;
  - mudo;
  - tela cheia: F no navegador, F11 fora dele.
- **Pesquisa no Google:** só a URL codificada.
- **Programas:**
  - lista privada detectada do menu Iniciar (306 programas no PC do dono);
  - apelidos, verbos desligáveis e processos por pasta + exe (Discord + Update; Claude app + Claude Code);
  - busca aproximada (Epic, PPSSPP, Cloudflare…);
  - pergunta "qual deles?" quando há mais de um candidato;
  - frases livres por apelido ("alterna para a TV").
- **Bandeja:**
  - Programas → atualizar, editar, rotinas sugeridas;
  - Trocar nome de chamada;
  - Publicar atualização.
- **Deploy:** `scripts/deploy.ps1` + `docs/DEPLOY.md`.

## Como validar
1. O dono roda `npx ask-cli@2 configure` (login, uma vez).
2. `powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1`. Na 1ª vez: Skill ID e pasta `skill`; depois, UAC do instalador.
3. Testar as frases de `docs/DEPLOY.md` §6, mais "pede para o monstro destravar o Discord" e "abrir a Epic".

## Pendências e limitações
- **Cowork** (Claude) é um **serviço do Windows** (`CoworkVMService`): destravá-lo exige administrador. Não está na lista.
- "Pular" é experimental, porque depende do botão aparecer na acessibilidade do navegador.
- "manda o monstro …" e "fecha no monstro …" não são formas oficiais da Alexa: testar.
- Fase 3 ("pergunta para o Claude") e fase 4 ("manda o Claude Code", com Voice ID + PIN) ainda não foram feitas.
- Branch `feature/skill-unica-casa-inteligente` arquivada (skill única cancelada).
