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
