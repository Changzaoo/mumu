# @radinho/importer — local importer helper

A tiny service you run on **your own machine** (only dependency: the gRPC
client used for word-level transcription). It does the
one thing a browser can't: fetch audio from a media link (via `yt-dlp`) and hand
the resulting **MP3** back to the radinho.online web app, which stores it in your local
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

Then open radinho.online (local `pnpm dev:web`, or the hosted app) → **No dispositivo**
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

| Var                                              | Padrão                     | Para quê                                                             |
| ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------- |
| `NVIDIA_API_KEY`                                 | —                          | obrigatória; sem ela o endpoint responde 503                         |
| `RIVA_TARGET`                                    | `grpc.nvcf.nvidia.com:443` | endpoint gRPC                                                        |
| `RIVA_FUNCTION_ID`                               | `d3fe9151-…`               | parakeet-tdt-0.6b-v2 (inglês, tempo por palavra)                     |
| `WHISPER_FUNCTION_ID`                            | `b702f636-…`               | whisper-large-v3 hospedado (pt-BR e outros)                          |
| `RIVA_FUNCOES_PALAVRA` / `RIVA_FUNCOES_SEGMENTO` | reservas embutidas         | CSV `id:idioma` — ordem de tentativa quando uma função cai           |
| `WHISPER_MODELO_TRANSCRICAO`                     | `large-v3-turbo`           | whisper LOCAL da transcrição livre (o `small` errava canto em pt-BR) |
| `WHISPER_MODELO`                                 | `small`                    | whisper LOCAL do alinhamento (texto já conhecido)                    |
| `MAX_TRANSCRIBE_MB`                              | `40`                       | teto do áudio aceito                                                 |

Notas de campo:

- O áudio é convertido para WAV 16 kHz **mono** (Riva só aceita canal único).
  Mandamos o WAV inteiro e o Riva lê o cabeçalho, então não informamos
  `encoding`/`sample_rate`.
- `timestampsAreDegenerate` é a rede de segurança: se algum dia o modelo parar
  de devolver offsets de verdade, o endpoint responde 422 e o app mantém a
  letra plana em vez de exibir um karaokê que não anda.

### De onde vem o áudio para o relógio (27/10/2026)

`POST /blob/:id/alinhar` e `GET /blob/:id/tempo` precisam dos BYTES da faixa.
Desde que o cofre deste PC virou antessala do GitHub (a faixa sobe e sai
daqui), a meta sumia junto e os dois respondiam **403 para o acervo inteiro**:
nenhuma faixa nova ganhava relógio — a letra ficava plana para sempre. Agora
quem não está no cofre é buscado na borda (`AUDIO_BORDA`, padrão
`https://musicas.radinho.online`, o mesmo `/blob/<id>?k=` que o app toca), com
o token que o app mandou; quem confere o token é a borda. A cópia fica em
`TEMPO_DIR/audio` (teto `AUDIO_RELOGIO_GB`, padrão 3; as mais antigas saem) e
o log diz `áudio do relógio: <id> veio da borda (7.2MB, 1s)`.

Medido depois do reinício: faixa fora do cofre, alinhamento novo → 202
`na-fila`/`processando` e 200 com as linhas; o download da borda leva ~1 s.

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

## Embeddings (recomendação semântica)

`POST /ai/embed` `{ input: string[], input_type?: 'passage' | 'query' }` →
`{ embeddings: number[][] }`. Modelo padrão
`nvidia/llama-nemotron-embed-1b-v2` (`NVIDIA_EMBED_MODEL`), lote de 32
(`NVIDIA_EMBED_BATCH`).

`input_type` importa: indexar (`passage`) e consultar (`query`) geram vetores
diferentes, e misturar os dois degrada a semelhança em silêncio.

### Validado contra a API real

| Pergunta                          | Resultado                                    |
| --------------------------------- | -------------------------------------------- |
| Dimensões                         | 2048, como documentado                       |
| Separa estilos?                   | bossa×bossa **0,85** vs bossa×metal **0,51** |
| Corte Matryoshka em 512 preserva? | **Sim** — 0,84 vs 0,44 (contraste até maior) |

O cliente guarda só as 512 primeiras dimensões renormalizadas: um quarto do
espaço em disco sem perder qualidade — a medição acima é a razão de a
truncagem ser segura. Também calibra o corte de 0,55 usado em "Parecidas
com X": fica acima do par semelhante e abaixo do par distante.

### Sincronia medida contra a voz isolada

`apps/importer/diagnostico/medirSincronia.py manifesto.json [--segundos 150]
[--voz-em PASTA | --voz-de PASTA]` separa a voz com o HDemucs (torchaudio, CPU;
~1 min por 150 s de música), acha os ATAQUES de voz (subida ≥ 8 dB em 200 ms)
e compara com o início que o alinhamento deu a cada linha e palavra que começa
depois de um respiro. Desvio = alinhamento − voz: negativo acende ANTES da
voz. `--voz-em` guarda a voz isolada; `--voz-de` reaproveita (a medição então
leva segundos). O resultado vai para `diagnostico/resultado-sincronia.json`.
Rode com o `python` normal (o `-I` esconde o torchaudio).

Medido em 27/10/2026, 4 faixas reais, 150 s cada (`diagnostico/resultado-sincronia.json`).
`small-mix` é o que a produção faz (stable-ts `small` sobre a mixagem);
`small-voz` é o mesmo alinhador sobre a voz separada pelo HDemucs. Mediana e
quartis em ms (alinhamento − voz); "≤100 ms" = linhas dentro de 100 ms do
ataque; "antes" = linhas que acendem mais de 150 ms ANTES da voz.

| faixa                                   | alinhamento          | linhas | mediana | p25..p75  | ≤100 ms | antes | palavras | mediana | ≤100 ms |
| --------------------------------------- | -------------------- | ------ | ------- | --------- | ------- | ----- | -------- | ------- | ------- |
| Mundo Fashion (Tz da Coronel ft. Matuê) | small-mix            | 12     | +15     | −10..+80  | 83%     | 8%    | 13       | +20     | 77%     |
| Mundo Fashion                           | small-voz            | 14     | +40     | −30..+150 | 56%     | 0%    | 18       | +50     | 56%     |
| Reza do Milhão (Matuê)                  | small-mix (produção) | 18     | −25     | −90..+40  | 67%     | 11%   | 18       | −25     | 67%     |
| Reza do Milhão                          | small-voz            | 24     | 0       | −60..+40  | 71%     | 12%   | 27       | 0       | 67%     |
| Quebra-Mar (Charlie Brown Jr.)          | small-mix (produção) | 23     | −40     | −110..+70 | 56%     | 17%   | 24       | −40     | 57%     |
| Quebra-Mar                              | small-voz            | 22     | +40     | −10..+70  | 77%     | 9%    | 23       | +40     | 78%     |
| You (Snoop Dogg, inglês)                | small-mix (produção) | 5      | −50     | −90..−40  | 100%    | 0%    | 10       | −70     | 70%     |
| You                                     | small-voz            | 12     | −5      | −20..+120 | 57%     | 8%    | 19       | +30     | 53%     |

O que os números dizem:

- O alinhamento de produção começa a linha entre 15 ms depois e 50 ms antes
  da voz (mediana), coerente com a medição de 20/10 (−55 ms em 80 linhas). O
  `LEAD_MS = −50` da tela (`apps/web/src/components/media/LyricsView.tsx`)
  cancela esse viés: na tela a mediana fica em 0..+65 ms.
- A dispersão é o problema que sobra: 8–17% das linhas acendem mais de 150 ms
  antes da voz. Alinhar sobre a voz isolada melhora duas faixas (Reza do
  Milhão, Quebra-Mar: 71–78% dentro de 100 ms) e piora duas (Mundo Fashion,
  You: 56–57%), ao custo de ~1 min de separação por faixa — não compensa
  trocar o motor. Encostar o início da linha no ataque mais perto detectado
  na MIXAGEM (banda 250–3800 Hz, ±100..200 ms) não mudou nada (bateria tem
  ataque em todo lugar). Nenhuma das duas entrou.
- "Mundo Fashion" (letra do Genius, só texto): limpa dos cabeçalhos
  `[Intro: …]`/`[Refrão: …]`, alinha com 83% das linhas dentro de 100 ms.

### Quando "não transcreve"

1. Rode `apps/importer/diagnostico/sondar.cmd` (ou
   `node apps/importer/diagnostico/sondarTranscricao.mjs [musica.mp3]`) **na
   máquina do importador**. Ele testa cada função ASR da NVIDIA (código gRPC 0 =
   OK) e o whisper local, e grava `diagnostico/resultado-sonda.json`.
2. Com o importador no ar, `GET /ai/transcribe/estado` mostra qual função da
   NVIDIA respondeu por último e o histórico de falhas.
3. A NVIDIA nunca é ponto único de falha: esgotadas as reservas (ou sem
   `NVIDIA_API_KEY`), `/ai/transcribe` cai para o whisper local.
