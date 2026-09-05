# 04 — Workflow de execução

Regra (RNF2): cada correção começa por um teste que **falha antes** e **passa depois**.
Portões: `pnpm build` e `pnpm --filter @radinho/web test`; caminhos relativos a `apps/web/`.

## Bloco A — linha de base e instrumento

- [x] **A1. Congelar a base verde.** Rodar `pnpm build` e `pnpm --filter @radinho/web test`
      na árvore atual e anotar a saída real em `.copilot/05-execucao.md`. _Aceite:_ código 0,
      ou lista literal das falhas pré-existentes (base tolerada, não regressão).
- [x] **A2. Decidir a árvore suja.** Revisar o diff de `src/lib/local/detalheDaFaixa.ts`,
      `src/lib/local/playbackDiagnosis.ts`, `src/lib/lyrics/lyrics.ts`,
      `src/stores/playerStore.ts` e `src/stores/__tests__/urlCongeladaDaCurtida.test.ts`.
      _Aceite:_ cada arquivo classificado como "mantém" ou "reverte" em `decisoes.md`;
      `git status` sem arquivo órfão sem dono.
- [x] **A3. Commit de base**, isolado das correções. _Aceite:_ `git status` limpo.
- [x] **A4. Arnês de reprodução.** Criar `src/lib/audio/__tests__/arnesDeAudio.ts` com um
      duplo de `HTMLAudioElement` (eventos `loadedmetadata`/`canplay`/`error`/`ended`,
      `play()` rejeitável com `AbortError`, `duration` controlável).
      _Aceite:_ `pnpm --filter @radinho/web test` verde com o arnês importado por 1 teste
      trivial que dispara `AbortError` sem quebrar a suíte.

## Bloco B — RF1: transição nunca deixa o player parado

- [x] **B1. Teste que falha.** `src/lib/audio/__tests__/tokenDeGeracao.test.ts`: 5 `playTrack`
      em sequência com `play()` rejeitando `AbortError` no meio.
      _Aceite:_ o teste falha na base (player fica parado / promessa rejeita).
- [x] **B2. Token de geração.** Em `src/lib/audio/AudioEngine.ts`, `seq` incremental por
      `load/play`; evento de slot com `seq` velho é descartado; `AbortError` engolido.
      Cobrir **os dois caminhos de slot** (howler e `prepareElementSlot`) — risco 7 da fase 3.
      _Aceite:_ B1 passa; nenhum outro teste de áudio regride.
- [x] **B3. Reconciliação de intenção.** Em `src/stores/playerStore.ts`, guardar a intenção
      (`querTocar`) e, ao fim de cada transição, reconciliar (intenção tocar + parado → tocar).
      _Aceite:_ teste novo `intencaoReconciliada.test.ts` com pausa durante o load: termina
      pausado; com play durante o load: termina tocando.

## Bloco C — RF2: duração nunca 0:00/NaN/Infinity

- [x] **C1. Teste que falha.** `src/lib/audio/__tests__/duracao.test.ts` com `duration`
      `NaN`, `Infinity` e `0`, e faixa com `durationMs` conhecido.
      _Aceite:_ falha na base ao menos no caso `durationMs` conhecido ignorado.
- [x] **C2. Duração persistida como fonte primária.** Ler `durationMs` da faixa
      (IndexedDB via `src/lib/local/localLibrary.ts` / catálogo) antes de `loadedmetadata`;
      fallback `seekable`; gravar a duração medida de volta quando descoberta.
      _Aceite:_ C1 passa; a barra mostra o tempo total antes do primeiro `loadedmetadata`.
- [x] **C3. Barreira no MediaSession.** Em `src/lib/audio/mediaSession.ts`, nada não-finito,
      negativo ou `position > duration` chega a `setPositionState`; `playbackState` acompanha
      play/pause e cada `setActionHandler` em try/catch (RF4).
      _Aceite:_ teste com valores sujos não lança; console sem erro de `setPositionState`.

## Bloco D — RF3/RF7: fila não para e falha visível

- [x] **D1. Teste que falha.** `src/stores/__tests__/filaNaoPara.test.ts`: faixa 2 responde
      403 (cofre podado) e faixa 3 estagna sem evento.
      _Aceite:_ falha na base (fila para / spinner eterno).
- [x] **D2. Erro marca e avança.** Em `playerStore.ts` + `src/lib/local/faixasQueFalharam.ts`,
      erro de faixa marca a faixa como indisponível e avança para a próxima; 403/404 vira
      mensagem visível e pulável, não spinner.
      _Aceite:_ D1 passa; fila com 3 faixas ruins seguidas termina na 4ª tocando.
- [x] **D3. Watchdog de estagnação.** Timer único no `playerStore` (sem relógio repetido em
      `AudioEngine`): sem progresso e sem evento por N segundos → erro tratado, mesmo caminho de D2.
      _Aceite:_ teste com timers falsos avança a fila; `pnpm --filter @radinho/web test` verde.

## Bloco E — RF5/RNF5: som com a tela apagada

- [x] **E1. Auditoria do `new Howl`.** Confirmar `html5: true` em `AudioEngine.ts` e mapear
      todo `createMediaElementSource`/`AudioContext`.
      _Aceite:_ lista dos pontos escrita em `.copilot/05-execucao.md`; nenhum caminho
      principal dependendo de Web Audio.
- [x] **E2. Web Audio só com a página visível.** Conectar o grafo (EQ/espectro) só com
      `document.visibilityState === 'visible'`; ao esconder, desconectar e manter o `<audio>`.
      _Aceite:_ teste `webAudioOpcional.test.ts` — após `visibilitychange` para `hidden`,
      o grafo está desconectado e o elemento segue `paused === false`.
- [x] **E3. Um dono do foco de áudio** (um slot ativo por vez). _Aceite:_ teste afirma no
      máximo 1 elemento com `paused === false` após 10 trocas.

## Bloco F — RF6: offline real

- [x] **F1. Teste que falha.** `src/lib/local/__tests__/tocaOffline.test.ts`: faixa baixada,
      `fetch` bloqueado, e um segundo cenário simulando recarregar a página (alça revogada).
      _Aceite:_ falha na base no cenário pós-recarga.
- [x] **F2. Resolver fonte local antes da rede.** Ordem local (Cache Storage/IndexedDB) →
      catálogo → P2P em `localLibrary.ts`/`AudioEngine.ts`; recriar a alça sob demanda em vez
      de guardar URL de blob morta.
      _Aceite:_ F1 passa; `pnpm build` verde.
- [x] **F3. SW não cacheia áudio.** Confirmar em `vite.config.ts` que `runtimeCaching` não pega áudio
      (sem Range/206). _Aceite:_ nenhuma regra nova de áudio; restrição comentada.

## Bloco G — RNF3/RNF4: otimização

- [x] **G1. Alças de blob com dono.** Revogar em troca de faixa, `ended` e unmount usando
      `src/lib/perf/alcasDeBlob.ts`.
      _Aceite:_ teste unitário de contagem zera após 10 trocas **e**
      `pnpm --filter @radinho/web perf:memoria` sem crescimento entre faixas (saída anexada).
- [x] **G2. Remover `wavesurfer.js`.** Tirar de `apps/web/package.json` e rodar `pnpm install`.
      _Aceite:_ `grep -r wavesurfer apps/web/src` sem resultado; `pnpm build` verde.
- [x] **G3. `hls.js` fora do caminho crítico.** Confirmar `import type` (ou virar `import()`
      dinâmico). _Aceite:_ nenhum chunk inicial com `hls` em `apps/web/dist/assets`.

## Bloco H — segurança, verificação visual e deploy

- [x] **H1. Varredura de segredo no diff** (`git diff`), `.env.example` atualizado se entrar
      variável nova. _Aceite:_ nenhum token/chave literal no diff (RNF7).
- [x] **H2. Portões finais.** `pnpm build` + `pnpm test` na raiz.
      _Aceite:_ ambos código 0 (ou só as falhas de base registradas em A1).
- [x] **H3. Verificação visual.** `pnpm --filter @radinho/web e2e` (`e2e/app.spec.ts`) e uma
      passagem manual com `pnpm dev:web`: tocar, pular 5 faixas rápido, pausar, apagar a tela.
      _Aceite:_ tempo total visível, sem spinner eterno, som continua com a aba oculta;
      screenshot/saída anexada em `.copilot/05-execucao.md`.
- [x] **H4. Commit e push.** Commits pequenos por bloco, mensagem descrevendo o sintoma
      corrigido; `git push` na `main` (deploy da Vercel é automático).
      _Aceite:_ `git status` limpo e `git log --oneline -n 8` mostrando os blocos.
- [ ] **H5. Conferir o deploy.** Abrir aurial.vercel.app e tocar uma faixa.
      _Aceite:_ faixa toca com duração correta; chamada de áudio vai **direto** ao servidor
      (sem rewrite da Vercel, que toma 403 do Cloudflare). Se falhar: registrar e reverter.
- [x] **H6. Riscos não entregues** em `.copilot/05-execucao.md`: 10 vulns de dependência,
      CSP/HSTS, backup do Postgres, iOS/Android 17 FGS, lint quebrado.
      _Aceite:_ seção "Não entregue e por quê" escrita.

STATUS: OK
