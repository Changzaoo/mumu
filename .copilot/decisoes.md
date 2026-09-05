# Decisões

## Fase 0 — contexto

- **Não usar `pnpm lint` como portão.** Falha com ~7767 problemas sem nenhuma mudança
  (memória do projeto). Portões serão `pnpm build` (tsc -b + vite build) e `pnpm test`.
- **Escopo do trabalho concentrado em `apps/web`.** O pedido é sobre execução de música;
  api/importer só entram se o bug for de resolução de URL/servidor.
- **Árvore suja mantida.** Mudanças não commitadas em playerStore/playbackDiagnosis/lyrics
  parecem parte do mesmo esforço; serão avaliadas na fase de diagnóstico, não descartadas.

## Fase 1 — pesquisa

- **Não trocar o motor de áudio.** Gapless-5/Gapless.js v4 resolvem gapless, mas o projeto já tem
  `AudioEngine.ts` e a memória manda ficar no `<audio>` puro; trocar é risco maior que o ganho.
- **Não adotar plugin nativo de áudio agora.** `@jofr/capacitor-media-session` mira Capacitor 6 e o
  projeto está no 8. Foco em web; Android 17/FGS fica registrado como risco, não como tarefa.
- **iOS fora do escopo verificável.** Sem aparelho para reproduzir, nada de iOS será prometido.

## Fase 2 — avaliação

- **Achados 7, 8, 9 e 10 descartados** (nativo Android/iOS): não há como reproduzir nem verificar
  aqui; ficam como risco registrado, não como tarefa.
- **Achado 3 (Range/206 no SW) vira restrição, não tarefa.** O `runtimeCaching` atual só pega
  imagens e `/api/v1/`; áudio não passa pelo SW. Regra: não cachear áudio sem plugin de range.
- **`new Howl` em `AudioEngine.ts:648` entra como auditoria**, não como troca de motor — precisa
  bater com a memória `audio-de-fundo-sem-web-audio` antes de qualquer conclusão.
- **wavesurfer.js será removido do `package.json`**: nenhum import em `apps/web/src`.

## Fase 3 — engenharia

- **Stack mantida** (projeto brownfield em produção). Nenhuma troca de framework, motor de
  áudio ou banco: o pedido é bug de execução, trocar stack é risco sem ganho.
- **howler fica, com `html5: true`** — é um `<audio>` real por baixo, compatível com a regra
  de áudio de fundo. O grafo Web Audio (EQ/espectro) vira **opcional e só com página visível**.
- **Web Audio desconectado quando a página esconde**; som segue no `<audio>`.
- **10 vulnerabilidades do `pnpm audit --prod` (6 high, 4 moderate) NÃO serão corrigidas nesta
  entrega**: nenhuma está no caminho de reprodução; bump de dependência contaminaria o diff
  do player. Registradas em Riscos.
- **CSP/HSTS na Vercel não entram agora**: CSP em app com blob/áudio de terceiros quebra
  reprodução; se entrar, primeiro em `Report-Only`. Risco registrado.
- **`durationMs` persistido** (IndexedDB/catálogo) é a fonte primária da duração; `seekable`
  e `loadedmetadata` são fallback.

## Fase 4 — workflow

- **Ordem dos blocos por dependência, não por severidade**: token de geração (B) antes de fila
  (D), porque watchdog e avanço automático dependem de a transição já ser determinística.
- **Cada bloco começa por um teste que falha na base** (RNF2) — sem isso não há prova de
  correção, só afirmação (memória `nao-prometer-sem-reproduzir`).
- **Arnês de áudio próprio** (`arnesDeAudio.ts`) em vez de biblioteca de mock: `HTMLAudioElement`
  precisa de `AbortError` e `duration` controláveis, que nenhum mock pronto do projeto dá.
- **Commits por bloco, não um commit único**: se o deploy quebrar, reverter só o bloco culpado.
- **Verificação visual é obrigatória antes do push** (H3): Playwright + passagem manual com a
  aba oculta; a regra de áudio de fundo não é observável em teste unitário.

## Fase 5 — construção

- **A2: a árvore suja fica inteira** (`detalheDaFaixa`, `playbackDiagnosis`, `lyrics`,
  `playerStore`, `urlCongeladaDaCurtida.test.ts`). Todos no tema do pedido, com teste, e a
  base com eles é verde (648/648). Reverter seria jogar fora conserto de RF7 já provado.
- **E2 não será "conectar/desconectar o grafo por visibilidade"**: `AudioEngine.ts` documenta,
  e `audioDeCelular.test.ts` prende, que depois de `createMediaElementSource` desconectar o nó
  deixa o elemento MUDO — a decisão tem que ser por elemento e para sempre. O projeto já resolve
  por PLATAFORMA (`SEM_GRAFO_WEB_AUDIO = IS_MOBILE`), que é estritamente mais forte para RF5.
  E2 vira: provar que no celular nenhum `AudioContext` nasce e que o elemento segue tocando
  depois de `visibilitychange → hidden`.
- **A porta do e2e virou configurável (`E2E_PORT`)**: nesta máquina a 5173 serve outro projeto, e
  `reuseExistingServer` reusava aquele servidor — a suíte inteira media outro site.
- **`desempenho`/`memoria`/`navegacao` saem do `playwright.config.ts` padrão**: elas medem sobre
  `vite preview` (4173) e cortam a rede com `isolarDaRede`; no config de dev os 15 morriam em
  `ERR_FAILED`. Um portão que não pode ficar verde não é portão.
- **`/api/v1/stream/` excluído do `runtimeCaching`**: era áudio HLS caindo num `NetworkFirst` com
  `networkTimeoutSeconds: 4`, justamente onde o cofre leva 20-25s se refazendo.
- **D2/D3, F2, G1 e G3 não precisaram de código**: já estavam implementados. Os testes novos
  entram como rede de segurança, e isso está dito em `05-execucao.md` — não como conserto.

## Fase 6 — verificação

- **`export type { Genre }` em `generoCoerencia.ts`** em vez de mudar o import do teste:
  o módulo já devolve `Genre` em quase toda função pública, então repassar o tipo é o
  caminho mais curto e serve a qualquer chamador. Falha de base (2026-08-16), não regressão.
- **Capturas por Playwright/CDP** e não só por Edge headless: `prefers-reduced-transparency`
  não tem flag de linha de comando, e era justamente a regra que a fase precisava ver.
- **Tema claro semeado por `localStorage`**: o app nasce escuro por decisão de produto;
  sem semear a preferência a captura "clara" sairia escura e provaria nada.
- **Script de captura descartado** após uso (`apps/web/tirar-capturas.mjs`): instrumento de
  uma fase, não código de produto. A cópia fica em `.copilot/screens/tirar.mjs`.
- **Desvios do briefing de vidro mantidos** (opacidade .72/.8, borda .08): trocar é
  redesenho do app, fora do pedido. Registrado como desvio consciente, não como falha.
