# @aurial/importer — local importer helper

A tiny, **zero-dependency** service you run on **your own machine**. It does the
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
