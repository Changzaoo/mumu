# Práticas globais de uso do Claude (Vinicius)

> **Arquivo gerado e sincronizado automaticamente.** Não edite esta cópia na raiz do projeto.
> Fonte única: `~/.claude/praticas/CLAUDE-PRATICAS.md`. O hook `SessionStart` (`~/.claude/hooks/sync-praticas.ps1`)
> copia a fonte para a raiz de todo projeto aberto no Claude Code. Para mudar algo, altere a fonte.
>
> Versão 1.4 · 2026-10-30 · Fontes: vídeo "A Anthropic conseguiu deixar a assinatura do Claude ainda melhor"
> (Rafael Quintanilha / QuantBrasil, youtube.com/watch?v=RANjqSxxm_0) e vídeo "Vazamento do novo Claude NEXT"
> (AI Revolution em Português, youtube.com/watch?v=b0hbTVU08Lo) e reel "5 GitHub essenciais para qualquer projeto Claude Code e Codex"
> (Bruno Trevisan, instagram.com/p/DecGBSqvFhf) e vídeo "Server-Sent Events" (Renato Augusto, youtube.com/watch?v=uiT4oK19hu4).

Estas práticas valem para **toda sessão do Claude Code**, em qualquer projeto, agora e no futuro, **com qualquer conta Anthropic** usada nesta máquina (o `CLAUDE.md` global é por usuário do Windows, não por conta) e para **qualquer agente de IA** que abra um repositório com este arquivo na raiz (Claude Code, Codex, Cursor etc.).
Elas complementam (não substituem) as regras específicas de cada projeto no `CLAUDE.md` local.

## 1. Escolha de modelo por tarefa (roteamento)

Use o modelo mais barato que resolve a tarefa com qualidade. Nunca o mais caro "por padrão".

| Modelo                   | Quando usar                                                                                                                                                                                            | Quando NÃO usar                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Haiku 5.5**            | Subagentes; tarefas de alto volume e escopo bem definido: resumos, compactação, classificação, queries em banco, extração, triagem, browser use, suporte, assistentes pessoais (velocidade ~150 tok/s) | Como modelo principal em programação longa ou complexa; tarefas que exigem proatividade ou raciocínio longo; contexto acima de 100k tokens (preço quintuplica) |
| **Sonnet 5.5**           | Padrão para programação agêntica de longa duração (cache de leitura barato); implementação do dia a dia; melhor custo‑benefício                                                                        | Decisões arquiteturais críticas onde errar custa caro                                                                                                          |
| **Opus 5.5 / Fable 5.1** | Tarefas de fronteira: arquitetura, revisão crítica, debugging difícil, raciocínio longo, orquestração                                                                                                  | Tarefas repetitivas e simples (desperdício)                                                                                                                    |

Preço de referência (US$ por milhão de tokens, entrada/saída): Fable 5.1 10/50 · Opus 5.5 4/20 (cache read 0,20) · Sonnet 5.5 2/10 · Haiku 5.5 0,10/0,50 (×5 acima de 100k de contexto).

**Na prática, dentro do Claude Code:**

- Ao delegar com a ferramenta `Agent`, informe `model`: `haiku` para buscas, resumos, classificação e verificações mecânicas; `sonnet` para implementar; `opus`/`fable` só para revisão crítica ou planejamento difícil.
- Mantenha o contexto de subagentes Haiku **abaixo de 100k tokens** (escopo pequeno, prompt objetivo).
- Em workflows multiagente, Haiku é o "operário" e Sonnet/Opus é o "orquestrador".
- Preserve o **prompt cache**: não reordene nem reescreva o início do contexto sem necessidade (CLAUDE.md estável, system prompt estável). Em tarefas longas o cache é a maior economia.

### 1.1 Escrita de texto: sempre Haiku 5.5 (ordem do Vinicius, 13/10/2026)

Toda tarefa cujo produto é **texto escrito** (roteiros de vídeo e documentário, narrações,
descrições, legendas, posts, e-mails, documentos, resumos, traduções, textos de tela,
pendências e relatórios) é feita pelo **Haiku 5.5**, sem exceção, porque é o modelo de
menor custo. Em subagentes: `model: "haiku"`. Sonnet entra só para estruturar a tarefa,
revisar o que o Haiku escreveu ou implementar código; Opus/Fable só para planejamento,
arquitetura, auditoria e orquestração. Quando o texto exige pesquisa, o Haiku pesquisa e
escreve em lotes pequenos (contexto abaixo de 100k tokens), e a revisão de fatos é uma
passada separada. Mensagem a repassar a toda sessão ativa quando esta regra mudar.

## 2. Verificar modelos antes de usar (nada de rumor)

- **Nunca configure um ID de modelo que não exista** na API de modelos da Anthropic (`GET /v1/models` ou `/model` no Claude Code). O Claude Code **não valida** o nome digitado em `--model`, `ANTHROPIC_MODEL` ou `settings.json`: ele envia e deixa falhar, e o erro parece um typo.
- Lançamento real deixa rastro: ID de modelo, linha na tabela de preços, model card, entrada no changelog do Claude Code. Sem isso ("Claude Next", "checkpoint secreto", etc.) é boato: não trate como fato nem propague em código, docs ou configuração.
- Modelos válidos hoje: `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (aliases `fable`, `opus`, `sonnet`, `haiku`).
- Em produção, use **roteamento com fallback**: modelo novo/não comprovado só em parte do tráfego, com fallback para Opus 5.5 ou Fable 5.1 (no Claude Code: `fallbackModel` em `settings.json`).

## 3. Créditos de API do plano Max / Team

- Assinantes Max e Team recebem **todo mês um crédito na API igual ao valor da assinatura** (US$100 → US$100, US$200 → US$200; Team até US$500).
- **Expira no fim do ciclo de cobrança, não acumula.** Conta nova só libera após 7 dias em plano elegível.
- Vale para: API direta, Managed Agents (agentes na nuvem), SDK, Playground. **Não cobre** uso extra do Claude Code.
- Prática: quando uma tarefa for automação recorrente (cron, job diário, assistente 24/7, agente de triagem), sugira rodá‑la na nuvem com os créditos em vez de ocupar o limite da assinatura do Claude Code. Não deixe crédito expirar sem uso.
- Assistente pessoal (ex.: Hermes em VPS): usar **API key + Haiku 5.5** (rápido e barato), não a assinatura.

## 4. Agentes na nuvem (Managed Agents) — padrão de construção

Estrutura dos recursos: **Agent** (descrição em markdown) → **Environment** (hosts, MCPs, pacotes permitidos) → **Vault** (credenciais) → **Deployment** (une agente + ambiente + credenciais; define budget, gatilho manual/cron/API) → **Session** (uma execução).

- Tudo **declarativo em arquivos** (`agent.md` + YAML), aplicado com a CLI `ant apply` (estilo Terraform, com lock file e versionamento do agente). Prefira editar os arquivos e aplicar, não clicar no painel.
- **Sempre defina budget máximo** por deployment. Custo típico de referência: ~US$0,20 por run.
- Credenciais **somente no Vault**. Nunca em prompt, markdown, YAML versionado ou variável solta.
- Modelo por frequência: runs raros que precisam de proatividade → Sonnet 5.5; alto volume e escopo fechado → Haiku 5.5.
- Ferramentas customizadas e MCPs próprios podem ser anexados ao agente (é assim que se constrói o "harness").

## 5. Harness engineering e segurança de agentes

- Dê ao agente **objetivos e critérios de pronto**, não lista de cliques. Deixe-o planejar.
- **Menor privilégio**: cada agente com identidade própria, acesso mínimo, ambiente isolado e log de auditoria.
- **Limite de gastos** rígido por projeto/agente; pausar ao atingir, retomar manualmente.
- Separe memória por tipo: tarefa atual, fatos, procedimentos (skills/como fazer), histórico. Salve procedimentos reutilizáveis como skill em vez de repetir no prompt.
- Visuais (animações, gráficos, ícones, 3D simples): prefira **código que desenha** (SVG, Canvas, JS) a gerar imagem/vídeo. É mais barato, editável e versionável.

## 6. Regras operacionais do Claude Code nesta máquina

- Ao iniciar uma sessão em um projeto, este arquivo já está carregado. Siga-o junto com o `CLAUDE.md` do projeto. Em conflito, a regra específica do projeto vence para o projeto; estas valem para o resto.
- **Nunca edite a cópia na raiz do projeto**; edite `~/.claude/praticas/CLAUDE-PRATICAS.md` e a cópia será atualizada no próximo início de sessão (ou rode o hook manualmente: `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/hooks/sync-praticas.ps1 -Project <pasta>`).
- **Para evoluir estas práticas** (o dono do projeto vai trazer novos vídeos, artigos e regras): extraia só o que é acionável, acrescente na seção certa ou crie uma nova, registre fonte e data no changelog abaixo, incremente a versão. Depois rode o hook nos projetos conhecidos e avise as sessões ativas.
- Este arquivo pode ser commitado no repositório. Ele é texto; não contém segredo.

## 7. Ferramentas, prova e método (reel do Bruno Trevisan)

Ideia central do reel: o modelo é o cérebro; o que diferencia uma operação de um chatbot é a **estrutura em volta** dele: quais ferramentas ele pode usar, quais skills tem, que dados acessa, como é testado e como recebe contexto. "Qual IA você usa" importa menos que "o que você ensinou e permitiu a IA fazer". Nenhuma ferramenta sozinha resolve; o poder está na combinação.

### 7.1 "Narração não é prova" (regra obrigatória)

- Dizer "funcionou", "pronto", "corrigido" **sem ter executado e observado o resultado é proibido**. Olhar o código e achar que está certo não é teste.
- Para qualquer coisa com interface web: **abra um navegador de verdade** (o navegador embutido do app, o `playwright-cli` da Microsoft ou Playwright), faça o fluxo real (abrir, clicar, preencher, logar, chegar ao fim), tire screenshot e só então reporte. Ex.: pediu checkout → adicionar produto, ir ao checkout, preencher, clicar e mostrar o que aconteceu.
- Para CLI, API e scripts: rodar o comando real e colar a saída. Se não deu para testar, escrever "não testei" e por quê.
- Em projetos grandes, delegar verificações a agentes separados (segurança, code review, banco, pagamento) em vez de confiar na própria narração.
- Ferramenta de referência: `github.com/microsoft/playwright-cli` (feita para agentes; gasta poucos tokens porque não despeja a página inteira no contexto). Instalar como skill: `npx skills add https://github.com/microsoft/playwright-cli --skill playwright-cli`.

### 7.2 Processo antes de código (Agent Skills)

- Não aceitar "cria meu aplicativo" como instrução única. Seguir o ciclo: **entender/especificar → quebrar em tarefas → executar uma por vez → verificar → revisar → entregar**.
- Quando a conversa cresce e o contexto fica gigante, o modelo "esquece metade do app". Remédio: tirar o processo da cabeça do modelo e colocar em **skills** (spec, planejamento, TDD, debug, review, segurança, context engineering), manter o contexto pequeno e salvar procedimentos reutilizáveis como skill em vez de repetir no prompt.
- Referência: `github.com/addyosmani/agent-skills` (dezenas de skills cobrindo Define → Plan → Build → Verify → Review → Ship). Antes de instalar, ler o README e escolher só as skills úteis ao projeto.

### 7.3 Dar ferramentas ao agente (braço, olho e acesso a sistemas)

Catálogo do reel, com a prática de uso de cada um:

| Ferramenta                       | Repositório                                | Para quê                                                                                                                                          | Prática                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HyperFrames** (HeyGen)         | `github.com/heygen-com/hyperframes`        | Edição de vídeo como programação: o Claude escreve HTML/CSS/animações e o HyperFrames renderiza um MP4 determinístico (precisa Node 22+ e FFmpeg) | Para formatos recorrentes (reels, aberturas, legendas, cards), criar **uma skill por formato** com fonte, identidade visual, posição de título e legenda, para o vídeo sair pronto do material bruto. Instalar: `npx skills add heygen-com/hyperframes`. Combina com a regra da seção 5 (visual por código). |
| **Google Workspace CLI** (`gws`) | `github.com/googleworkspace/cli`           | Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat, Tasks via terminal (saída JSON; também roda como MCP)                                         | Colocar a IA **dentro do processo que a empresa já usa** em vez de inventar um novo: triagem de e-mail, relatório a partir de planilha, documentos por reunião. Revisar escopos/permissões antes de autorizar; não é produto suportado oficialmente pelo Google.                                             |
| **Apify**                        | `github.com/apify/actors-mcp-server` (MCP) | Pesquisar o que o modelo não acessa bem: Instagram, TikTok, Amazon, Reddit, sites pesados em JavaScript, com milhares de scrapers prontos         | Limitar os actors carregados (`--actors` com 1 ou 2) para não inflar o contexto; resultados grandes vão para arquivo/planilha, não para o chat. O valor não é o scraping, é o que se faz depois: análise de concorrente, pesquisa de conteúdo, leads, padrões, preço, mercado. Runs são cobrados pela Apify. |
| **Agent Skills** (Addy Osmani)   | `github.com/addyosmani/agent-skills`       | Método (ver 7.2)                                                                                                                                  | —                                                                                                                                                                                                                                                                                                            |
| **Playwright CLI** (Microsoft)   | `github.com/microsoft/playwright-cli`      | Prova (ver 7.1)                                                                                                                                   | —                                                                                                                                                                                                                                                                                                            |

- Antes de conectar qualquer ferramenta a conta real (Google, Apify, redes), aplicar a seção 5: menor privilégio, credenciais fora do prompt, limite de gasto.
- Ao instalar skill/MCP de terceiro, ler o que ele faz antes; é código de fora rodando com as suas permissões.

## 8. Economia de tokens (ordem do Vinicius, 22/10/2026: a cota semanal chegou a 96%)

Regra de ouro: **LLM só para o que exige julgamento. Tudo que é repetição, espera ou checagem vira script.**

1. **Nunca vigiar por conversa.** Proibido laço de "boletim a cada hora", `sleep`/poll em turno de LLM, monitores que acordam o modelo à toa. Para esperar algo: script em tarefa agendada do Windows (`schtasks`) que grava o resultado em arquivo. Em produção de vídeo isso já existe: `D:\vnmax-videos\automacao\guardiao.py` (a cada 5 min: religa coordenador/túnel, publica o host, libera travas mortas, apaga web corrompido, escreve `STATUS.md`).
2. **Estado em UM arquivo.** Antes de rodar vários comandos para "ver como está", leia `D:\vnmax-videos\automacao\STATUS.md` e o painel local `http://127.0.0.1:4567` (também no celular, só pela rede Wi-Fi da casa; NUNCA publicar status ou qualquer painel na internet). Responder "como está?" = ler esse arquivo e resumir em 5 linhas.
3. **Responder curto.** Resumo final em até 8 linhas; sem recapitular o pedido, sem repetir tabelas já dadas. Não reler arquivo grande inteiro: `grep`/`sed -n` no trecho.
4. **Modelo certo**: texto escrito → Haiku; código de rotina → Sonnet; Opus/Fable só para auditoria, segurança e arquitetura difícil. Nunca Opus/Fable para polling, formatação, relatório ou revisão mecânica.
5. **Subagente só se paralelizar de verdade**, com prompt objetivo, contexto pequeno e relatório de até 10 linhas. Não criar agente para conferir o que um script confere (ffprobe, grep, contagem, teste).
6. **Fluxos longos viram script retomável** (marca `.ok`, trava com PID, log), não uma conversa longa. Se a sessão cair, o script continua.
7. **Mensagens entre sessões** só quando muda algo que a outra precisa saber; nada de "estou bem"/boletim. A outra sessão consulta o `status.txt`.
8. **Sem retrabalho caro**: antes de renderizar/montar em massa, validar uma amostra e só então soltar o lote (render de vídeo não se refaz de graça).
9. **Fim de cota**: quando a cota estiver acima de 90%, só ações que não repetem (corrigir bug, publicar o que está pronto); pausar frentes que gastam muito e dependem de LLM, e deixar os scripts agendados rodando.

## 9. Tempo real com SSE (vídeo do Renato Augusto)

- **Servidor só empurra para a tela?** Prefira SSE a sondagem e a WebSocket. WebSocket só com comunicação nos dois sentidos ou dados binários; sondagem curta só em tela simples de pouco uso.
- **Nunca encerre a resposta depois de escrever.** O `EventSource` reconecta, e isso vira sondagem disfarçada. Confira na aba Network: uma requisição só, com os eventos dentro dela.
- **Formato:** `Content-Type: text/event-stream`, campo `data:` e duas quebras de linha no fim de cada mensagem. Mande `id:` para o `Last-Event-ID` recuperar o que se perdeu na queda.
- **Conexão aberta é recurso preso:** libere ao fechar a aba, ponha teto por conta e no total, e prazo de escrita para cliente que parou de ler.
- **Uma conexão só** com Redis, banco ou servidor principal para todos os clientes, nunca uma por usuário. Guarde também a resposta "sem sessão" em cache, com teto de perguntas novas por IP.
- **Revalide a sessão fora do ramo da batida:** em canal movimentado a batida quase não acontece.
- ⚠️ **NÃO siga a dica do vídeo de mandar token na URL.** URL fica em log e em histórico. Use cookie HttpOnly com `withCredentials`, ou um token de uso único e vida curta.
- Exemplo nesta máquina: `eventos_srv.py` do Bitcoin VNMAX, com travas em `test_eventos.py`.

## Changelog

- **1.4 (2026-10-30)** — Seção 9: tempo real com SSE. Fonte: vídeo do Renato Augusto (youtube.com/watch?v=uiT4oK19hu4). A dica de token na URL foi registrada como o que NÃO fazer.

- **1.3 (2026-10-22)** — Seção 8: economia de tokens (cota semanal em 96%): script no lugar de polling/boletim, estado em `STATUS.md`, modelo certo, subagentes só quando paralelizam, respostas curtas. Fonte: ordem do Vinicius na sessão do Bitcoin VNMAX.

- **1.2 (2026-10-13)** — Seção 7: "narração não é prova", processo antes de código, catálogo de ferramentas (HyperFrames, gws, Apify, agent-skills, playwright-cli). Fonte: reel do Bruno Trevisan (instagram.com/p/DecGBSqvFhf). Cabeçalho: vale para qualquer conta Anthropic nesta máquina e para qualquer agente que abra o repo.

- **1.1 (2026-10-13)** — Seção 1.1: escrita de texto sempre com Haiku 5.5 (pedido do Vinicius na sessão do Bitcoin VNMAX, 13/10/2026).

- **1.0 (2026-10-13)** — Versão inicial a partir dos dois vídeos citados no cabeçalho.
