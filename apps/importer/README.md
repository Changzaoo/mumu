# @aurial/importer — local importer helper

A tiny service you run on **your own machine** (only dependency: the gRPC
client used for word-level transcription). It does the
one thing a browser can't: fetch audio from a media link (via `yt-dlp`) and hand
the resulting **MP3** back to the Aurial web app, which stores it in your local
library like any imported file — with cover art and metadata.

Why a helper at all? A browser can't download from YouTube & friends: their CDNs
send no CORS headers and the streams require player-signature deciphering that
only a non-browser client (`yt-dlp`) can do. So the download must happen in a
real process on a device you control. This helper is that process.

## ⚠️ Personal use only

Import **only** content you are authorized to download — your own uploads,
Creative Commons, public domain. Downloading copyrighted material without
permission may violate the source platform's Terms of Service and copyright law.
That responsibility is yours. The helper binds to `127.0.0.1` only and is never
part of the hosted site.

## Requirements

- **Node 20+** (you already run this repo on it)
- **ffmpeg** on your `PATH` (or set `FFMPEG_PATH`)
- **yt-dlp** — auto-downloaded on first run if not found (or set `YTDLP_PATH`,
  or drop the binary in `apps/importer/.bin/`)

## Run

```bash
node apps/importer/server.mjs
# → listening on http://127.0.0.1:8787
```

Then open Aurial (local `pnpm dev:web`, or the hosted app) → **No dispositivo**
(`/dispositivo`) → _Adicionar por link_. When the helper is running the card
shows a green “Importador local” badge and accepts YouTube / SoundCloud / Vimeo
/ Bandcamp links in addition to direct audio-file URLs.

## Config (env vars)

| Var                  | Default                           | Purpose                                                            |
| -------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `PORT`               | `8787`                            | Listen port                                                        |
| `HOST`               | `127.0.0.1`                       | Bind address (`0.0.0.0`/tailnet IP to expose)                      |
| `IMPORT_TOKEN`       | _(none)_                          | Shared secret required on `/import` — set before exposing publicly |
| `YTDLP_PATH`         | auto                              | Path to the yt-dlp binary                                          |
| `FFMPEG_PATH`        | PATH                              | Path to ffmpeg                                                     |
| `ALLOW_ORIGIN`       | dev + `https://aurial.vercel.app` | CSV of browser origins allowed to call it                          |
| `AURIAL_MAX_MINUTES` | `90`                              | Reject sources longer than this                                    |

## Endpoints

- `GET /health` → `{ ok, service, hosts }` — the web app probes this.
- `POST /import` `{ "url": "…" }` → streams `audio/mpeg`; the track title is in
  the `X-Aurial-Title` response header (URL-encoded).

The web app never calls a remote server for this — only your local helper.

## Letra sincronizada (ASR com tempo por palavra)

`POST /ai/transcribe` recebe o áudio bruto e devolve `{ words: [{ text, startMs }] }`.
Serve para dar TEMPO a letras que só têm texto — o texto exibido continua vindo
do LRCLIB; daqui sai apenas o relógio.

Variáveis:

| Var                 | Padrão                     | Para quê                                     |
| ------------------- | -------------------------- | -------------------------------------------- |
| `NVIDIA_API_KEY`    | —                          | obrigatória; sem ela o endpoint responde 503 |
| `RIVA_TARGET`       | `grpc.nvcf.nvidia.com:443` | endpoint gRPC                                |
| `RIVA_FUNCTION_ID`  | `71203149-…`               | parakeet-1.1b-rnnt-multilingual (25 idiomas) |
| `RIVA_LANGUAGE`     | `multi`                    | `multi` = detecta sozinho; ou fixe `pt-BR`   |
| `MAX_TRANSCRIBE_MB` | `40`                       | teto do áudio aceito                         |

Notas de campo:

- O áudio é convertido para WAV 16 kHz **mono** (Riva só aceita canal único).
  Mandamos o WAV inteiro e o Riva lê o cabeçalho, então não informamos
  `encoding`/`sample_rate`.
- `timestampsAreDegenerate` é a rede de segurança: se algum dia o modelo parar
  de devolver offsets de verdade, o endpoint responde 422 e o app mantém a
  letra plana em vez de exibir um karaokê que não anda.

### Validado contra a API real

Medido com fala sintetizada em pt-BR (2:47, 5,3 MB), não inferido da doc:

| Pergunta                              | Resultado                                            |
| ------------------------------------- | ---------------------------------------------------- |
| Timestamps por palavra?               | **Sim** — 324/324 palavras com instantes distintos   |
| Cobre a faixa inteira?                | **Sim** — primeira em 0 ms, última em 166 s de 167 s |
| Português com `language_code: multi`? | **Sim**, transcrição correta                         |
| `Recognize` (offline) existe?         | **Sim** — ao contrário do que a doc sugeria          |
| `StreamingRecognize`?                 | **Sim**, e devolveu MAIS palavras (324 vs 293)       |

Por isso ficamos no **streaming**: cobre melhor o áudio longo e funciona
mesmo que a função hospedada um dia deixe de expor o modo offline.

Ponta a ponta, com a letra "Cada segundo dessa nossa **canção**" e um ASR que
ouviu "cancal", o LRC gerado saiu com a grafia da LETRA e o tempo do ÁUDIO —
que é exatamente o objetivo do desenho.
