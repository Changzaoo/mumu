# 05 — Verificação com provas (fase 6)

Tudo abaixo foi executado nesta fase, em 2026-09-05, na árvore atual.

## Saídas reais dos comandos

`pnpm install --frozen-lockfile`

```
. prepare: Done
Done in 5s using pnpm v10.4.1
```

`pnpm build`

```
apps/web build: dist/assets/firebase-DynJWriz.js   700.02 kB │ gzip: 163.56 kB
apps/web build: ✓ built in 25.28s
apps/web build: PWA v0.21.2 · precache 83 entries (2746.74 KiB) · dist/sw.js
apps/web build: Done
```

`pnpm test`

```
apps/web test:  Test Files  82 passed (82)
apps/web test:       Tests  689 passed (689)
apps/web test:    Duration  80.59s
```

`pnpm typecheck` — **falhava** ao entrar na fase (falha de base, de 2026-08-16, commit `ff66f56`:
`generoCoerencia.test.ts(16,8): error TS2459: Module '../generoCoerencia.js' declares 'Genre'
locally, but it is not exported`). Corrigido aqui com um `export type { Genre }` — o vitest
apaga tipos e não via, o `tsc` via. Depois:

```
packages/shared typecheck: Done
apps/api typecheck: Done
apps/signaling typecheck: Done
apps/web typecheck: Done
```

`pnpm lint` → **7783 problemas (7760 erros, 23 avisos)**, exit 1. Continua fora do portão
(memória `lint-quebrado-de-base`); o número não mudou de ordem — é ruído de base, não regressão.

`E2E_PORT=5199 npx playwright test` → `1 passed (13.6s)` (a porta 5173 é de outro projeto).

`npx playwright test --config playwright.memoria.config.ts` → `3 passed (2.0m)`:

```
│ faixas │ alças (n) │ alças (MB) │ heap (MB) │ bitmap (MB) │ nós DOM │ TOTAL (MB) │
│ 1000   │ 292       │ 64         │ 13        │ 7           │ 2259    │ 84         │
│ 5000   │ 292       │ 64         │ 15        │ 0           │ 2082    │ 79         │
```

Cinco vezes mais faixas e o mesmo número de alças: as alças têm dono (RNF3).

Suíte específica dos critérios (8 arquivos, `vitest run`): `47 passed (47)`.

## Critérios de aceite

| #    | Critério                                        | Veredito | Evidência                                                                                                                                                                                    |
| ---- | ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF1  | Troca de faixa nunca deixa o player parado      | **OK**   | `tokenDeGeracao.test.ts` (5) + `intencaoReconciliada.test.ts` (3) verdes                                                                                                                     |
| RF2  | Duração nunca `0:00`/`NaN`/`Infinity`           | **OK**   | `duracao.test.ts` (9 casos, inclui `NaN`/`Infinity`/`0` e `durationMs` conhecido)                                                                                                            |
| RF3  | Fila não para sozinha                           | **OK**   | `filaNaoPara.test.ts` (6) — 403 do cofre podado e faixa estagnada; watchdog avança                                                                                                           |
| RF4  | MediaSession fiel ao estado real                | **OK**   | `mediaSessionSuja.test.ts` (9) — valor sujo não chega a `setPositionState`, nada lança                                                                                                       |
| RF5  | Som com a tela apagada sai do `<audio>`         | **OK**   | `webAudioOpcional.test.ts` (4) + `avancoComTelaApagada.test.ts` (7)                                                                                                                          |
| RF6  | Faixa baixada toca sem rede e após recarregar   | **OK**   | `tocaOffline.test.ts` (4), inclui o cenário da alça revogada pós-recarga                                                                                                                     |
| RF7  | 403/404 falha visível e pulável                 | **OK**   | `filaNaoPara.test.ts` + `urlCongeladaDaCurtida.test.ts` na suíte de 689                                                                                                                      |
| RNF1 | Portões `pnpm build` e `pnpm test`              | **OK**   | ambos exit 0 (saídas acima)                                                                                                                                                                  |
| RNF2 | Nada declarado sem teste que falhava antes      | **OK**   | cada linha da tabela aponta um teste; a falha na base está registrada em `05-execucao.md`                                                                                                    |
| RNF3 | Alças revogadas; `perf:memoria` sem crescimento | **OK**   | 292 alças em 1000 **e** em 5000 faixas; heap 13→15 MB                                                                                                                                        |
| RNF4 | Sem lib de áudio morta no bundle                | **OK**   | `grep wavesurfer` em `package.json` e `src`: zero. `hls` não aparece no `index.html` (0 hits)                                                                                                |
| RNF5 | Um dono do foco de áudio                        | **OK**   | `webAudioOpcional.test.ts`: nenhum `AudioContext` nasce no celular                                                                                                                           |
| RNF6 | Escopo verificável = web                        | **OK**   | iOS/Android 17 FGS seguem em Riscos, não em entrega                                                                                                                                          |
| RNF7 | Sem segredo em código                           | **OK**   | varredura no `git diff` por chave/token/Bearer: nenhum resultado                                                                                                                             |
| (F3) | SW não cacheia áudio                            | **OK**   | `vite.config.ts`: único `runtimeCaching` genérico é `destination === 'image'`; `/api/v1/stream/` explicitamente excluído da regra de API, com o motivo (206/Range e o corte de 4s) comentado |

Nenhuma FALHA. A única correção desta fase foi a do `typecheck` acima.

## Avaliação visual — "Apple glass"

Capturas em `.copilot/screens/` (Edge headless + Playwright/CDP para o que a linha de
comando não emula). O preview roda sem API e sem sessão, então as telas estão em estado
vazio: dá para julgar as superfícies, não a densidade de conteúdo.

| Item do briefing                     | Veredito          | O que a imagem mostra                                                                                                                                                    |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backdrop-filter: blur() saturate()` | **OK**            | `.glass` = `blur(30px) saturate(180%)`, `.glass-strong` = `blur(34px) saturate(185%)`; 14 declarações padrão e 13 prefixadas no CSS do `dist`                            |
| Fundo translúcido claro/escuro       | **OK com desvio** | `hsl(var(--bg-elevated) / .72)` e `/.8` — mais opaco que os `.55` do briefing; decisão do projeto por legibilidade                                                       |
| Borda de 1px                         | **OK com desvio** | `1px solid hsl(var(--fg) / .08)` — bem mais discreta que `rgba(255,255,255,.35)`; consistente em todo o app                                                              |
| Raio 16–24px                         | **OK**            | tokens `--radius-xl: 16px` / `--radius-2xl: 20px` nas superfícies de vidro                                                                                               |
| Sombras em camadas                   | **OK**            | `inset 0 1px 0 0 hsl(0 0% 100% / .06)` (o brilho de topo) somado às sombras externas                                                                                     |
| Fundo com gradientes desfocados      | **OK**            | aurora visível nas quatro capturas: azul no topo esquerdo, roxo no rodapé, refratando sob o vidro em `home-claro.png`                                                    |
| Tipografia                           | **OK**            | `--font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI'`                                                                                     |
| Grade de 8px                         | **OK**            | escala do Tailwind v4 (múltiplos de 4/8); alinhamento uniforme na barra lateral e nos cartões                                                                            |
| Contraste AA                         | **OK**            | título e rótulos em branco quase puro sobre `#0A0A0C`; o texto secundário ("0 músicas", "Histórico") é o ponto mais fraco, ainda legível                                 |
| Foco visível                         | **OK**            | `foco.png`: 4 × Tab param em "Descobrir" com anel branco de 2px contornando o item inteiro                                                                               |
| `prefers-color-scheme`               | **OK com nota**   | `home-claro.png` prova o tema claro. O app **nasce no escuro** por decisão de produto: o SO só manda quando a preferência guardada é `system` (`home-sistema-claro.png`) |
| `prefers-reduced-transparency`       | **OK**            | `home-transparencia-reduzida.png`: barra lateral e topo chapados, sem a aurora vazando; regra presente no CSS do `dist`                                                  |

## Pendências (nada bloqueante)

1. Capturas em estado vazio — sem API local não há capa nem `PlayerBar` na tela; a prova de
   reprodução desta entrega é a suíte, não a imagem.
2. Desvio deliberado do briefing em opacidade (.72/.8 vs .55) e borda (.08 vs .35). Mudar isso
   é redesenho do app inteiro, fora do pedido ("otimizar e zerar bug de execução de música").
3. `pnpm lint` segue quebrado de base (7783); risco 5 da fase 3, intocado.
4. Riscos herdados sem mudança: 10 vulnerabilidades de dependência, sem CSP/HSTS, sem rotina de
   backup do Postgres, iOS/Android 17 FGS sem aparelho para reproduzir.

STATUS: OK
