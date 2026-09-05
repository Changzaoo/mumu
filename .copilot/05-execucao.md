# 05 — Execução (fase 5)

## A1 — Linha de base (saída real)

`pnpm build` → **exit 0** (`apps/web build: ✓ built in 1m 14s`, PWA precache 83 entries).
`pnpm --filter @radinho/web test` → **exit 0**:

```
 Test Files  75 passed (75)
      Tests  648 passed (648)
   Duration  197.60s
```

Base **verde**: qualquer falha daqui em diante é regressão desta entrega.
(`pnpm lint` continua fora do portão — 7767 problemas de base, memória `lint-quebrado-de-base`.)

## A2 — Árvore suja: veredito

| Arquivo                                          | Veredito   | Por quê                                                                                  |
| ------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `lib/local/detalheDaFaixa.ts`                    | **mantém** | `sourceUrl` (página de origem) não é conteúdo tocável; contá-lo travava a re-hidratação. |
| `lib/local/playbackDiagnosis.ts`                 | **mantém** | Instrumento de contagem das curtidas com URL podre — é o "reproduzir antes de prometer". |
| `lib/lyrics/lyrics.ts`                           | **mantém** | Só formatação (prettier).                                                                |
| `stores/playerStore.ts`                          | **mantém** | Resolve o endereço vivo em vez da foto congelada da curtida — é RF7.                     |
| `stores/__tests__/urlCongeladaDaCurtida.test.ts` | **mantém** | Teste que prende a regra acima; passa na base verde.                                     |

Nenhum arquivo órfão. Tudo no tema do pedido, tudo coberto por teste.

## O que estava realmente quebrado (e o que já estava certo)

Vale separar, porque metade do plano supunha defeitos que não existiam mais.

### Consertado nesta entrega

| #   | Defeito                                                                                                                                                                                                                                                                                                                            | Onde                                              | Prova                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| 1   | **`AbortError` tratado como bloqueio de autoplay.** Cinco `próxima` seguidas geravam cinco `error{kind:'play'}` — a store parava o player e mostrava toast vermelho acusando o navegador de um erro causado pela própria troca de faixa.                                                                                           | `AudioEngine.startSlot`                           | `tokenDeGeracao.test.ts` (falhava na base com 5 erros espúrios) |
| 2   | **Intenção decidida no começo da transição.** `loadIndex` capturava `autoplay`; quem apertasse pause durante a carga terminava com a **música tocando e a tela dizendo pausado**, e o botão de pause aparentemente quebrado.                                                                                                       | `playerStore`                                     | `intencaoReconciliada.test.ts` (falhava na base)                |
| 3   | **Carga velha falando por cima da nova.** As guardas eram `queueIndex`/`currentTrack.id`, que não distinguem "ainda é esta carga" de "é a mesma faixa pedida de novo". Trocado por token de geração.                                                                                                                               | `playerStore`                                     | idem                                                            |
| 4   | **Duração não-finita escapando.** `Infinity \|\| x` é `Infinity`: o evento `loaded` entregava `Infinity` à barra em todo stream sem `Content-Length`. E `durationMs` ausente virava `NaN:aN`.                                                                                                                                      | `AudioEngine.getDuration`/`loaded`, `playerStore` | `duracao.test.ts` (3 casos falhavam na base)                    |
| 5   | **O service worker interceptava o áudio.** `/api/v1/stream/:id/...` (manifesto e segmentos HLS) casava com a regra `NetworkFirst` de `networkTimeoutSeconds: 4` — passados 4s o worker desistia da rede e respondia de um cache vazio, no exato caso em que o cofre leva 20–25s se refazendo. Além do 206, que `cache.put` recusa. | `vite.config.ts`                                  | regra confirmada em `dist/sw.js`                                |
| 6   | **`pnpm e2e` não podia ficar verde.** O config padrão coletava `desempenho`/`memoria`/`navegacao`, que medem sobre `vite preview` na 4173 e cortam a rede com `isolarDaRede` — contra o servidor de dev, os 15 morriam em `ERR_FAILED`.                                                                                            | `playwright.config.ts`                            | `pnpm e2e` → 1 passed                                           |
| 7   | **`wavesurfer.js`** removido: zero imports em `apps/web/src`.                                                                                                                                                                                                                                                                      | `apps/web/package.json`                           | `grep -r wavesurfer apps/web/src` vazio                         |

### Já estava certo — os testes novos só prendem

- **D2/D3 (fila não para).** `attemptSourceFallback`, `sondarFonteEmParalelo`, o orçamento de
  tempo de `failCurrentTrack` e o watchdog de estagnação já existiam e funcionam.
  `filaNaoPara.test.ts` passou de primeira; virou rede de segurança, não conserto.
- **F2 (offline).** `ensureLocalAudioUrl` já recria a alça sob demanda a partir dos bytes;
  `hasLocalAudio` já pergunta ao registro, não ao mapa de alças. `tocaOffline.test.ts` idem.
- **G1 (alças de blob).** `alcasDeBlob.ts` já é dono único, com teto em bytes.
- **G3 (hls.js).** Já é `import type` + `import()` dinâmico: `grep -c hls dist/index.html` = **0**.
- **C3 (MediaSession).** Já era guardado; entraram o `try/catch` no `playbackState` e o
  saneamento de `position`/`playbackRate`.

## E1 — Auditoria do Web Audio (saída real)

`grep -rn "createMediaElementSource|new AudioContext" apps/web/src` — em código de produção,
**dois** pontos, os dois atrás de `SEM_GRAFO_WEB_AUDIO`:

- `AudioEngine.ts:622` — `new AudioContext()` em `ensureGraph`;
- `AudioEngine.ts:673` — `createMediaElementSource` em `connectSlotElement`.

`html5: true` confirmado em `AudioEngine.ts:705`. Único consumidor de `analyser`:
`SpectrumVisualizer.tsx`, que já trata `null`. **Nenhum caminho principal depende de Web Audio.**

### Por que E2 não virou "desconectar o grafo ao esconder a página"

O plano pedia conectar o grafo só com a página visível e desconectar ao esconder. **Não dá**:
depois que um elemento passa por `createMediaElementSource`, o som deixa de sair dele e passa a
sair do `AudioContext` — desconectar o nó não devolve o som ao elemento, deixa **mudo**. A escolha
é por elemento e para sempre.

O projeto já resolve por PLATAFORMA (`SEM_GRAFO_WEB_AUDIO = IS_MOBILE`), que é estritamente mais
forte: no celular o grafo nunca nasce, então não há o que desconectar. `webAudioOpcional.test.ts`
prende o efeito que RF5 pede — esconder a página não cala a música — nos dois aparelhos.

## H2 — Portões finais (saída real)

`pnpm build` → **exit 0** (`✓ built in 13.38s`).
`pnpm test` → **exit 0**:

```
 Test Files  82 passed (82)
      Tests  689 passed (689)
   Duration  68.45s
```

Contra a base: **+7 arquivos de teste, +41 testes**, zero regressão.

## G1 — Memória (saída real de `pnpm --filter @radinho/web perf:memoria`)

```
┌─────────┬────────┬──────────┬───────────┬────────────┬───────────┬──────────┬─────────────┬─────────┬────────────┐
│ (index) │ faixas │ assentou │ alças (n) │ alças (MB) │ heap (MB) │ TBT (ms) │ bitmap (MB) │ nós DOM │ TOTAL (MB) │
├─────────┼────────┼──────────┼───────────┼────────────┼───────────┼──────────┼─────────────┼─────────┼────────────┤
│ 0       │ 1000   │ true     │ 293       │ 64         │ 13        │ 923      │ 7           │ 2260    │ 84         │
│ 1       │ 5000   │ true     │ 292       │ 64         │ 15        │ 3796     │ 0           │ 2078    │ 79         │
└─────────┴────────┴──────────┴───────────┴────────────┴───────────┴──────────┴─────────────┴─────────┴────────────┘
  3 passed (1.9m)
```

**Cinco mil faixas não custam mais memória que mil** (79 MB contra 84 MB): o orçamento de
`alcasDeBlob` segura em 64 MB nos dois casos, que é o que o teto em bytes existe para fazer.
Ressalva honesta: esta medição é com a aba **parada**, sem tocar nada — as 292 alças são de
capa, não de áudio. Ela prova o teto, não o ciclo de troca de faixa; quem prova esse é o teste
unitário de dez trocas em `alcasDeBlob.test.ts`.

O TBT de 3.796 ms com 5.000 faixas é alto e **não** é objeto deste pedido (é custo de abertura,
não de reprodução). Fica anotado como próximo alvo.

## H3 — Verificação visual (saída real)

`pnpm --filter @radinho/web e2e` → **1 passed** (`app.spec.ts` — carrega a home, mostra o menu,
navega para `/search`).

⚠️ **A porta 5173 desta máquina está servindo outro projeto** (`cortes.digital`). Com
`reuseExistingServer`, o Playwright reusava aquele servidor e os testes rodavam contra outro site.
Daí `E2E_PORT` no config: `E2E_PORT=5199 pnpm --filter @radinho/web e2e`.

**Não entregue:** a passagem manual (tocar, pular 5 faixas, pausar, apagar a tela) não foi feita —
não há humano na sessão nem aparelho para apagar a tela. O comportamento com a tela apagada está
coberto por `webAudioOpcional.test.ts` e `avancoComTelaApagada.test.ts`, que é o que dá para provar
daqui; **não é a mesma coisa que um celular na mão**, e fica registrado como tal.

## H5 — Deploy conferido no ar (saída real, 2026-09-05)

```
home:                200   https://aurial.vercel.app/
sw.js contém a regra nova de /api/v1/stream/:   1 ocorrência
catálogo DIRETO:     200   https://aurial-api.nexusholding.xyz/api/v1/catalogo
```

Cadeia completa de uma faixa de verdade ("TUDO BEM", Brandão85), do acervo até os bytes:

```
GET /catalogo/local:2c8c83a3-…  → 200, streamUrl = https://importer.nexusholding.xyz/blob/…?k=98561505…
GET esse blob, Range: bytes=0-0 → HTTP/1.1 206 Partial Content
                                  Content-Type: audio/mpeg
                                  content-range: bytes 0-0/6286607
                                  Accept-Ranges: bytes
                                  access-control-allow-origin: *
```

- **Toca:** o cofre entrega áudio (206, 6,3 MB, `audio/mpeg`).
- **Duração correta:** o catálogo traz `durationMs: 143264.938` (2:23) — a fonte primária de RF2
  tem dado de verdade para essa faixa.
- **Direto ao servidor, sem o rewrite da Vercel:** `apiBase.ts` resolve a base absoluta
  `aurial-api.nexusholding.xyz` em produção, e o áudio sai de `importer.nexusholding.xyz`.
  Nenhum dos dois passa pelo salto que toma 403 do Cloudflare (memória `rewrite-vercel-toma-403`).

**Não verificado daqui:** o som saindo do alto-falante. Isto é uma conferência de rede e de
artefato publicado, feita por `curl` — prova que os bytes existem e chegam, não que a pessoa ouviu.

## Interface

Esta entrega **não tocou em nenhum componente, página ou CSS** — o diff é motor de áudio, store,
service worker e testes. Nada renderizado mudou, então a diretriz de "Apple glass / liquid glass"
não teve onde ser aplicada; o vidro existente do app segue como estava. Dizer que foi aplicada
seria inventar trabalho que não houve.

## Não entregue e por quê

1. **10 vulnerabilidades de dependência** (6 high, 4 moderate — `music-metadata`, `sharp`,
   `socket.io`, `react-router`, `fast-xml-parser`, `DeepmergeTS`, `file-type`, `uuid`, `qs`×2).
   Nenhuma está no caminho de reprodução; bump de dependência no meio de um diff de player
   esconde a causa de qualquer regressão. Entrega própria.
2. **CSP/HSTS na Vercel.** CSP em app com `blob:` e áudio de terceiros quebra reprodução com
   facilidade. Se entrar, primeiro como `Content-Security-Policy-Report-Only`.
3. **Rotina de backup do Postgres.** Só existe o `genero_backup_manual`, pontual.
4. **iOS / Android 17 FGS.** Sem aparelho para reproduzir. Registrado, não prometido (RNF6).
5. **`pnpm lint` quebrado de base** (~7767 problemas sem mudança nenhuma). Não serve de portão,
   e por isso bug de qualidade real passa despercebido.
6. **Passagem manual do H3** — ver acima.
