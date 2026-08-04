# Cross-device sync + community trending — setup

The app now syncs each signed-in user's **likes, playlists, and on-device
library** across devices, and powers a global **"Em alta na comunidade"** feed
from everyone's likes — all on **Firebase Firestore** (project `mumu-2f54e`).
The client code is already wired; you just need to enable Firestore once.

## 1. Enable Firestore (2 min)

1. Firebase console → your project → **Build → Firestore Database → Create
   database**.
2. Pick **Production mode** and a region (e.g. `southamerica-east1` for Brazil).

## 2. Publish the security rules

Firestore Database → **Rules** tab → paste the contents of
[`firestore.rules`](../firestore.rules) → **Publish**.

These allow each user to read/write only their own `users/{uid}/…` space, make
the `trending` feed publicly readable, and let signed-in users contribute likes.

> **Republique as regras ao atualizar para a versão do ACERVO DO APP.** A
> coleção `catalogo` é nova; sem ela publicada, o admin não consegue escrever no
> acervo e os usuários comuns abrem o app sem música nenhuma — que era
> exatamente o sintoma relatado. A lista de admins nas regras
> (`ehAdmin()`) precisa bater com `AUTHORIZED_EMAILS` em
> [`apps/web/src/lib/auth/roles.ts`](../apps/web/src/lib/auth/roles.ts).
>
> Para conferir num aparelho qualquer: abra **/diagnostico**. A primeira linha
> diz quantas faixas o acervo tem naquele aparelho.

## 2.1 O acervo do app (o que o admin adiciona, todo mundo ouve)

A biblioteca de cada conta é **privada** (`users/{uid}/library`) — é assim que
deve ser para a biblioteca pessoal, e é por isso que ela **não** serve de
catálogo. O acervo curado vive em `catalogo/{trackId}`: só admin escreve,
qualquer um lê (inclusive visitante sem conta).

- O admin importa → a faixa é espelhada no acervo automaticamente.
- Toda correção de metadata feita pela curadoria também é espelhada.
- No aparelho do usuário, as faixas do acervo entram na biblioteca local
  marcadas com `origem: 'catalogo'`: aparecem na Home, na busca, em artistas,
  gêneros e álbuns, sem UI nova.
- Faixa emprestada **não** sobe para a nuvem privada do usuário, e apagá-la lá
  **não** remove a cópia que o importador serve para todo mundo.

Para tocar em outro aparelho, a faixa precisa de `remoteUrl` (cópia enviada ao
importador) ou `sourceUrl` (link original). Faixa importada de arquivo que nunca
subiu ao importador aparece no acervo mas não toca fora do aparelho do admin —
a varredura `backfillRemote` faz esse upload em segundo plano.

## 3. Create the trending index

The per-genre trending query needs one composite index. Either:

- Open the app, like a few songs, open Home — Firestore logs a console error
  with a **"create index"** link; click it. **Or**
- Firestore → **Indexes → Composite → Add index**:
  - Collection: `trending`
  - Fields: `genreKey` **Ascending**, then `likeCount` **Descending**
  - Query scope: Collection

(The overall "Em alta na comunidade" query needs no custom index.)

## 4. Authorized domains (if not already done)

Firebase → **Authentication → Settings → Authorized domains** → ensure
`aurial.vercel.app` (and `localhost`) are listed, so Google/GitHub login works.

## How it behaves

- **Sync:** signing in on a second device pulls your likes/playlists/library
  down and merges your local ones up (union). Changes propagate in real time.
- **Audio:** only metadata syncs. Catalog (Audius) tracks re-stream/re-download
  on any device; **imported files (YouTube/local) keep their audio on the device
  that imported them** — they appear in the list elsewhere but aren't playable
  there until re-imported. (This was the "library-only" option you chose.)
- **Trending:** liking a track increments a global, genre-bucketed counter
  (one vote per user). Home shows the top liked tracks overall and per genre.
- **Community library:** when you import a track by link it's published to a
  shared `sharedTracks` collection everyone can see ("Adicionadas pela
  comunidade" on Home / No dispositivo). Tapping one re-imports it (via the
  importer + the stored link) and plays it. Re-publish the rules after pulling
  this change so `sharedTracks` is allowed.
- **Offline / signed out:** everything keeps working locally; sync just pauses.
