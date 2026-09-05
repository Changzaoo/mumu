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

Nenhum arquivo órfão. Tudo no tema do pedido (execução de música), tudo coberto por teste.

## Blocos B–H

Preenchido conforme cada bloco fecha.
