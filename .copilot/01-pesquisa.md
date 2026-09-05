# 01 — Pesquisa (web, 2025-2026)

## Entendimento do pedido

Trabalhar no `radinho`/aurial até a reprodução de música não ter bug: nada de spinner eterno,
duração 0:00, fila que trava, som que morre com a tela apagada ou faixa offline que não toca.
"Otimizado" aqui = memória/latência da aba e do APK Capacitor, com portão em build + testes.

## Achados

1. **`AbortError: play() request was interrupted`** é o bug clássico de player com fila: trocar
   `src`/chamar `load()`/`pause()` antes da promise de `play()` resolver rejeita todas as promises
   pendentes. — https://developer.chrome.com/blog/play-request-was-interrupted

2. **Só "await na promise" não resolve troca rápida de faixa.** A thread do Chromium mostra que
   guardar a promise anterior e reproduzir cada toggle causa flip play/pause/play em rede lenta; o
   padrão certo é um _token de geração/intenção_: cada transição invalida a anterior e no fim
   reconcilia com o estado desejado mais recente, engolindo `AbortError` (não é erro real).
   — https://groups.google.com/a/chromium.org/g/media-dev/c/3Apwh-wgZc8

3. **Service Worker + áudio = Range/206.** O Cache API não guarda respostas 206 e um SW que
   intercepta a requisição de mídia sem tratar `Range` deixa o `<audio>` em estado quebrado
   (pior no Safari/iOS, que exige byte-range). Solução: `workbox-range-requests`
   (`createPartialResponsePlugin`) ou fatiar o arrayBuffer no SW devolvendo 206 + `Content-Range`;
   e nunca `cache.put()` de 206. — https://web.dev/articles/sw-range-requests

4. **Duração `Infinity`/`NaN`** vem quase sempre de resposta sem `Content-Length`, com
   `Transfer-Encoding: chunked` ou sem `Accept-Ranges: bytes` (CDN/proxy costuma tirar). MP3 CBR não
   tem duração no container: o browser estima pelo tamanho em bytes. Diagnóstico: `curl -sI` na
   `streamUrl`. Correção boa = cabeçalhos no servidor + duração vinda do banco (ffprobe no import);
   o hack `currentTime = 1e101` é frágil e gasta banda.
   — https://community.cloudflare.com/t/audio-element-duration-returns-infinity-when-website-is-accessed-through-cloudflares-cdn/175770
   — https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration

5. **Blob URL é RAM presa** (bate com a memória do projeto): cada `createObjectURL` segura o Blob
   inteiro até `revokeObjectURL`; em SPA de vida longa isso vaza. Mas revogar cedo demais quebra
   re-buffer/seek — revogar só em troca de faixa/`ended`/unmount. Alternativa estruturalmente melhor
   para offline: **Cache Storage + SW servindo URL same-origin**, sem blob nenhum, com Range/seek
   funcionando e sem carregar o arquivo todo na memória (`revokeObjectURL` nem existe em SW).
   — https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static

6. **MediaSession é obrigação, não enfeite.** `playbackState` precisa acompanhar play/pause (senão o
   botão da tela de bloqueio faz o inverso), `setPositionState()` precisa ser chamado a cada avanço
   ou o scrubber congela — e lança se `position > duration`, `position < 0` ou `playbackRate === 0`
   (armadilha direta quando `duration` é `NaN`/`Infinity`, achado 4). `setActionHandler` pode lançar
   por ação não suportada: envolver cada registro em try/catch. Artwork: fornecer a escada
   96→512px. — https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState

7. **Android 17 endureceu áudio em segundo plano** (relevante para o APK Capacitor 8): app em
   background que toca áudio precisa de foreground service `mediaPlayback` (não `SHORT_SERVICE`);
   sem isso o áudio é **silenciado sem exceção nem log**, e `requestAudioFocus` devolve
   `AUDIOFOCUS_REQUEST_FAILED`. O FGS deve ser iniciado enquanto o app está em primeiro plano.
   Teste: `adb shell cmd audio set-enable-hardening enable|throw`.
   — https://developer.android.com/about/versions/17/changes/bg-audio

8. **WebView do Capacitor não mantém áudio sozinho.** Plugins que resolvem: `@jofr/capacitor-media-session`
   (sobe FGS para MediaSession ativa; última versão 4.0.0 mira Capacitor 6 — compatibilidade com 8
   não confirmada), `@mediagrid/capacitor-native-audio` (media3 `MediaSessionService`, alinhado ao
   achado 7) e `@capawesome-team/capacitor-audio-player`.
   — https://github.com/jofr/capacitor-media-session
   — https://github.com/mediagrid/capacitor-native-audio

9. **Bug de tela apagada existe no lado nativo também**: player que amarra a um surface de vídeo é
   pausado quando o surface é destruído (Android 17). Players só-áudio não sofrem. Lição para nós:
   nada de `<video>` escondido nem de nó de Web Audio como caminho principal com a tela apagada
   (já é a memória `audio-de-fundo-sem-web-audio`).
   — https://github.com/streamyfin/streamyfin/issues/1743

10. **iOS PWA é o pior caso** e não temos como testar aqui: relatos de que, em standalone, após ~30s
    pausado o áudio para de funcionar até voltar ao primeiro plano; e bug do WebKit com autoplay/
    controles de MediaSession quando a faixa termina.
    — https://developer.apple.com/forums/thread/762582
    — https://bugs.webkit.org/show_bug.cgi?id=261858

11. **howler 2.2.4 é a última versão e está parada.** Alternativas atuais para gapless real:
    Gapless-5 (HTML5 → troca para WebAudio quando carrega; crossfade 25-50ms) e Gapless.js v4
    (máquina de estados xstate, 2026). Nenhuma justifica troca de motor agora: o projeto já tem
    `AudioEngine.ts` próprio e a memória do projeto manda ficar no `<audio>` puro.
    — https://github.com/regosen/Gapless-5 — https://news.ycombinator.com/item?id=47222271

12. **Três libs de áudio no bundle** (howler + hls.js + wavesurfer) é peso de otimização óbvio:
    wavesurfer/hls só devem entrar por import dinâmico, e cada uma que criar seu próprio contexto de
    áudio compete pelo audio focus (achado 2 sobre múltiplas instâncias `Audio`).

## Dúvidas em aberto

- A `streamUrl` do cofre devolve `Content-Length` + `Accept-Ranges`? (achado 4 — medir com `curl -sI`).
- O SW gerado pelo vite-plugin-pwa intercepta as URLs de áudio? Tem `range-requests`? (achado 3).
- O offline hoje usa blob URL ou Cache Storage? (achado 5 — decide se há vazamento estrutural).
- O APK é alvo real deste ciclo ou só a web? Se for, achados 7-8 viram tarefa nativa, não JS.
- iOS/Safari: sem aparelho para reproduzir; achado 10 fica registrado, não prometido.
