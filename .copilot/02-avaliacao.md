# 02 — Avaliação da pesquisa

## Dúvidas da fase 1, resolvidas por leitura do código

- **SW não intercepta áudio**: `vite.config.ts` só tem `runtimeCaching` para `request.destination === 'image'` e `/api/v1/`. Não há plugin de range.
- **Offline é híbrido**: `caches.open` em `lib/local/localLibrary.ts` **e** `createObjectURL` em `localLibrary`/`downloadManager` — já existe `lib/perf/alcasDeBlob.ts` com teste.
- **howler está vivo**: `new Howl` em `AudioEngine.ts:648` (import estático), apesar da memória "áudio de fundo sem Web Audio".
- **wavesurfer.js não é importado em `src/`**: dependência morta no `package.json`. `hls.js` entra só como `import type`.
- **Duração já tem defesa parcial**: fallback por `seekable` em `AudioEngine.ts:455-463`; `mediaSession.ts:104` guarda `Number.isFinite`.
- **APK**: sem sinal de trabalho nativo em curso; ciclo tratado como **web**.

## Vereditos

| #   | Achado                                             | Veredito            | Motivo                                                                                              |
| --- | -------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | `AbortError: play() request was interrupted`       | ÚTIL                | É o modo mais provável de "trava ao pular faixa" na fila do `playerStore`.                          |
| 2   | Token de geração/intenção em vez de só `await`     | ÚTIL                | Vira o desenho da correção do #1; sem ele o bug volta em rede lenta.                                |
| 3   | SW + Range/206                                     | ÚTIL COMO RESTRIÇÃO | Hoje o SW não toca em áudio; serve para proibir cachear áudio sem range.                            |
| 4   | Duração `Infinity`/`NaN` sem `Content-Length`      | ÚTIL                | "0:00" está no pedido; defesa atual é heurística no cliente, falta duração do dado.                 |
| 5   | Blob URL segura RAM                                | ÚTIL                | Bate com a memória do projeto e com `alcasDeBlob.ts`; é o eixo de "otimizado".                      |
| 6   | MediaSession: `playbackState` + `setPositionState` | ÚTIL                | Botão de bloqueio invertido e scrubber congelado são bug de execução visível.                       |
| 7   | Android 17 exige FGS `mediaPlayback`               | DESCARTADO          | Ciclo é web; correção é nativa (Capacitor/Java), fora do que dá para verificar aqui.                |
| 8   | Plugins nativos de mídia do Capacitor              | DESCARTADO          | Decisão da fase 1: `@jofr` mira Capacitor 6, projeto está no 8.                                     |
| 9   | Surface de vídeo pausa o player                    | DESCARTADO          | Já é regra vigente (memória `audio-de-fundo-sem-web-audio`); nada novo a fazer.                     |
| 10  | iOS PWA para o áudio após ~30s                     | DESCARTADO          | Sem aparelho para reproduzir; regra do projeto proíbe prometer sem reproduzir.                      |
| 11  | howler parado; Gapless-5 / Gapless.js              | PARCIAL             | Não trocar de motor (fase 1), **mas** `new Howl` ativo contradiz o `<audio>` puro: virar auditoria. |
| 12  | Três libs de áudio no bundle                       | ÚTIL (reduzido)     | wavesurfer é dependência morta (remover); `hls.js` já é type-only — confirmar que não vira chunk.   |

## Requisitos finais

### Funcionais

- **RF1** Trocar de faixa/`play`/`pause` em qualquer ordem e velocidade nunca deixa o player parado: transição por token de geração, `AbortError` engolido, reconciliação com a última intenção.
- **RF2** Duração nunca fica em `0:00`/`NaN`/`Infinity`: prioridade para a duração já conhecida (IndexedDB/catálogo), fallback `seekable`, e nunca alimentar `setPositionState` com valor não finito.
- **RF3** A fila não para sozinha: erro de faixa marca a faixa e avança; watchdog cobre estagnação sem evento.
- **RF4** MediaSession fiel ao estado real: `playbackState` acompanha play/pause, posição atualizada, cada `setActionHandler` em try/catch.
- **RF5** Com a tela apagada o som sai do `<audio>` — nenhum caminho principal por Web Audio nem `<video>` oculto.
- **RF6** Faixa baixada toca sem rede, e continua tocando depois de recarregar a página.
- **RF7** Faixa cujo `streamUrl` responde 403/404 (cofre podado) falha de forma visível e pulável, sem spinner eterno.

### Não funcionais

- **RNF1** Portões: `pnpm build` (tsc -b + vite build) e `pnpm test`. `pnpm lint` não é portão (quebrado de base).
- **RNF2** Nenhum bug é declarado resolvido sem teste que falhe antes e passe depois (vitest ou e2e).
- **RNF3** Memória: alças de blob revogadas em troca de faixa/`ended`/unmount; `pnpm perf:memoria` sem crescimento entre faixas.
- **RNF4** Bundle: remover dependência de áudio não usada (wavesurfer); nada de lib pesada em import estático de caminho crítico.
- **RNF5** Um único elemento/instância de áudio manda no `audio focus`; nada de contexto de áudio concorrente.
- **RNF6** Escopo verificável = web (Chrome/Android WebView). iOS e Android 17/FGS ficam registrados como risco conhecido, não como entrega.
- **RNF7** Sem segredo em código; nada de mudança em api/importer salvo se o bug for de resolução de URL.

STATUS: OK
