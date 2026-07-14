/**
 * Local library — the user's OWN tracks (imported files + tracks received from
 * peers over P2P). Mirrors the offline-download pattern:
 *
 *   audio bytes → Cache Storage (`aurial-library-v1`)
 *   metadata    → localStorage index (`aurial:library`)
 *   playback    → in-memory `Map<id, objectUrl>` the AudioEngine resolver reads
 *
 * Local tracks carry `streamUrl = null`; they only play because the player's
 * local-source resolver returns their object URL (see stores/playerStore.ts).
 * Works fully offline and, on secure origins, survives reloads via Cache Storage.
 */
import type { SharedTrackMeta, TrackDto } from '@aurial/shared';
import { cacheStorageSupported } from '@/lib/offline/audioCache';
import { cloudCollection } from '@/lib/sync/cloudCollection';
import { publishSharedTrack } from '@/lib/sync/sharedLibrary';
import { prefetchLyrics } from '@/lib/lyrics/lyrics';
import { pushNotification } from '@/stores/notificationsStore';
import { safeCoverUrl, sanitizeText, validateAudioFile } from '@/lib/local/validateAudio';
import { creditIsAmbiguous, splitArtistNames } from '@/lib/local/artists';
import { aiSplitArtists, aiVerifyArtist } from '@/lib/ai/ai';
// O TIME DE METADADOS (5 agentes — ver metaTeam.ts). Aqui vive o AUDITOR;
// os demais agentes são consultados em cada decisão de crédito.
import {
  extrator,
  juizCreditoConflita,
  juizDecideCredito,
  verificadorAlbum,
  verificadorConfirma,
} from '@/lib/local/metaTeam';
import {
  deleteTrackBlob,
  fetchPlaylistEntries,
  fetchTrackMeta,
  helperSupportsMetaTeam,
  importerHostLabel,
  importViaHelper,
  uploadTrackBlob,
} from '@/lib/local/importerHelper';

const CACHE_NAME = 'aurial-library-v1';
const STORAGE_KEY = 'aurial:library';
const keyFor = (id: string): string => `/__library_audio__/${encodeURIComponent(id)}`;

export interface LibraryEntry {
  track: TrackDto;
  addedAt: string;
  sizeBytes: number;
  mimeType: string;
  /** Original media link (YouTube/direct file) — lets any device re-import it. */
  sourceUrl?: string;
  /** Importer capability URL for the uploaded audio — lets ANY device stream it. */
  remoteUrl?: string;
  /** SHA-256 of the audio bytes — catches identical files imported twice. */
  contentHash?: string;
}

// ── in-memory state ─────────────────────────────────────────────
const blobUrls = new Map<string, string>();
const listeners = new Set<() => void>();
let cache: LibraryEntry[] | null = null;
/** Derivados caros (álbuns/artistas/gêneros) memoizados até a próxima write() —
 *  Sidebar + Home consultam a cada render e recalcular O(n) toda vez derrubava
 *  celulares modestos. */
let groupsCache: { albums: LocalAlbum[]; artists: LocalArtist[]; genres: LocalGenre[] } | null =
  null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── registry (localStorage) ─────────────────────────────────────
function read(): LibraryEntry[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as LibraryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

// A cura/enriquecimento em segundo plano faz patch de UMA faixa por vez; com a
// persistência síncrona antiga cada patch custava JSON.stringify da biblioteca
// INTEIRA (megabytes) + localStorage.setItem + re-render do app todo — centenas
// em sequência CONGELAVAM a página (até "Página sem resposta"). O debounce
// coalesce rajadas em uma escrita/emissão a cada ~300ms; a memória (cache) é
// atualizada na hora, então toda leitura continua vendo o estado novo.
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function flushWrite(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
  } catch {
    // Quota / private mode — registry stays in memory for the session.
  }
  emit();
}

function write(entries: LibraryEntry[]): void {
  cache = entries;
  groupsCache = null; // seletores derivados (álbuns/artistas/gêneros) recalculam
  writeTimer ??= setTimeout(flushWrite, 300);
}

// Não perder a rajada final se a aba fechar dentro da janela do debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (writeTimer) flushWrite();
  });
}

// ── Cache Storage helpers ───────────────────────────────────────
async function putBlob(id: string, blob: Blob): Promise<void> {
  if (!cacheStorageSupported()) return;
  const store = await caches.open(CACHE_NAME);
  await store.put(
    keyFor(id),
    new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'audio/mpeg',
        'Content-Length': String(blob.size),
      },
    }),
  );
}

async function getBlob(id: string): Promise<Blob | null> {
  if (!cacheStorageSupported()) return null;
  const store = await caches.open(CACHE_NAME);
  const res = await store.match(keyFor(id));
  return res ? await res.blob() : null;
}

async function deleteBlob(id: string): Promise<void> {
  if (!cacheStorageSupported()) return;
  const store = await caches.open(CACHE_NAME);
  await store.delete(keyFor(id));
}

/** SHA-256 of the audio bytes (hex) — identifies identical files. */
async function hashBlob(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// ── filename / duration probing ─────────────────────────────────
/** "Artist - Title.mp3" → { artist, title }; falls back to "Desconhecido". */
function parseFileName(fileName: string): { title: string; artist: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const match = /^(.+?)\s*[-–—]\s*(.+)$/.exec(base);
  if (match?.[1] && match[2]) return { artist: match[1].trim(), title: match[2].trim() };
  return { artist: 'Desconhecido', title: base || fileName };
}

/** Read an audio blob's duration via a metadata-only decode probe (ms). */
function probeDurationMs(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'metadata';
    const finish = (ms: number): void => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(ms) && ms > 0 ? ms : 0);
    };
    el.addEventListener('loadedmetadata', () => finish(el.duration * 1000));
    el.addEventListener('error', () => finish(0));
    // Safety net: never hang on an undecodable file.
    setTimeout(() => finish(el.duration * 1000), 8000);
    el.src = url;
  });
}

function localTrackDto(
  id: string,
  title: string,
  artist: string | string[],
  durationMs: number,
  album: string | null,
  coverUrl: string | null,
): TrackDto {
  // Sanitize every externally-derived string/URL that lands in a track.
  const safeTitle = sanitizeText(title) || 'Faixa';
  // A credit can name several artists ("A feat. B", "A & B"). Split it so the
  // track is attributed to EACH artist — never merged into one.
  const rawNames = Array.isArray(artist) ? artist : splitArtistNames(artist);
  const names = rawNames.map((n) => sanitizeText(n, 120)).filter(Boolean);
  const safeNames = names.length > 0 ? names : ['Desconhecido'];
  const safeAlbum = album ? sanitizeText(album, 200) || null : null;
  const cover = safeCoverUrl(coverUrl);
  return {
    id,
    title: safeTitle,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: cover,
    dominantColor: null,
    loudnessLufs: null,
    album: safeAlbum
      ? { id: `local-album:${id}`, title: safeAlbum, slug: '', coverUrl: cover }
      : null,
    artists: safeNames.map((name, i) => ({
      id: `local-artist:${id}:${i}`,
      name,
      slug: '',
      imageUrl: null,
    })),
    streamUrl: null,
    downloadUrl: null,
    uploadedByUserId: null,
  };
}

function addEntry(entry: LibraryEntry, blob: Blob): void {
  blobUrls.set(entry.track.id, URL.createObjectURL(blob));
  write([entry, ...read().filter((e) => e.track.id !== entry.track.id)]);
  cloud.push(entry.track.id, entry);
}

/**
 * Upload a freshly-added track's audio to the importer and record the resulting
 * stream URL on its entry (as `remoteUrl` + `track.streamUrl`) so the user's
 * OTHER devices — which only sync metadata — can play it. Best-effort: silent on
 * failure / when signed out (the track just stays local-only, as before).
 */
async function uploadAndLink(id: string, blob: Blob): Promise<void> {
  const url = await uploadTrackBlob(id, blob);
  if (!url) return;
  const current = read().find((e) => e.track.id === id);
  if (!current) return; // removed while uploading
  patchEntry(id, {
    ...current,
    remoteUrl: url,
    track: { ...current.track, streamUrl: url },
  });
}

// ── cross-device sync (Firestore, metadata only) ────────────────
// Only the registry (track + metadata) syncs. The audio bytes stay on the
// device that has them; a synced-in entry simply isn't playable elsewhere until
// its file is re-imported/received (the user opted for library-only sync).
const cloud = cloudCollection<LibraryEntry>({
  name: 'library',
  localItems: () => read().map((e): [string, LibraryEntry] => [e.track.id, e]),
  onRemoteUpsert: (id, entry) => applyRemoteUpsert(id, entry),
  onRemoteDelete: (id) => applyRemoteDelete(id),
});

/** Start/stop cross-device sync (called on auth change). */
export const setUser = cloud.setUser;

function applyRemoteUpsert(id: string, entry: LibraryEntry): void {
  const existing = read();
  write(
    existing.some((e) => e.track.id === id)
      ? existing.map((e) => (e.track.id === id ? entry : e))
      : [entry, ...existing],
  );
}

function applyRemoteDelete(id: string): void {
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
  write(read().filter((e) => e.track.id !== id));
}

// ── public API ──────────────────────────────────────────────────

/** Import dropped/picked audio files into the local library. */
export async function importFiles(files: File[]): Promise<TrackDto[]> {
  const imported: TrackDto[] = [];
  for (const file of files) {
    // Reject anything that isn't genuinely audio (magic-byte sniff + size cap).
    const check = await validateAudioFile(file);
    if (!check.ok) continue;
    // Skip an identical file already in the library (same audio bytes).
    const hash = await hashBlob(file);
    const dup = hash ? findByHash(hash) : null;
    if (dup) {
      imported.push(dup);
      continue;
    }
    const id = `local:${crypto.randomUUID()}`;
    const { title, artist } = parseFileName(file.name);
    const durationMs = await probeDurationMs(file);
    const mimeType = file.type || 'audio/mpeg';
    const track = localTrackDto(id, title, artist, durationMs, null, null);

    await putBlob(id, file).catch(() => undefined);
    addEntry(
      {
        track,
        addedAt: new Date().toISOString(),
        sizeBytes: file.size,
        mimeType,
        ...(hash ? { contentHash: hash } : {}),
      },
      file,
    );
    void uploadAndLink(id, file); // make it playable on the user's other devices
    imported.push(track);
  }
  // Non-blocking: fetch real covers/metadata from iTunes for what we just added.
  void enrichSequentially(imported.map((t) => t.id));
  if (imported.length > 0) {
    pushNotification({
      type: 'import',
      title: imported.length === 1 ? 'Faixa importada' : `${imported.length} faixas importadas`,
      body: imported.length === 1 ? imported[0]?.title : undefined,
    });
  }
  return imported;
}

/** Persist a track received from a peer over the data channel. */
export async function saveReceivedTrack(meta: SharedTrackMeta, blob: Blob): Promise<TrackDto> {
  // Re-namespace under our own local id so it is owned and re-shareable.
  const id = meta.id.startsWith('local:') ? meta.id : `local:${crypto.randomUUID()}`;
  const track = localTrackDto(
    id,
    meta.title,
    meta.artist,
    meta.durationMs,
    meta.album,
    meta.coverDataUrl,
  );
  await putBlob(id, blob).catch(() => undefined);
  addEntry(
    { track, addedAt: new Date().toISOString(), sizeBytes: blob.size, mimeType: meta.mimeType },
    blob,
  );
  void uploadAndLink(id, blob);
  pushNotification({ type: 'shared', title: 'Faixa recebida de um amigo', body: track.title });
  return track;
}

// ── enrichment (real covers + metadata from iTunes) ─────────────

/** Replace a registry entry in place, preserving its list position. */
function patchEntry(id: string, next: LibraryEntry): void {
  write(read().map((e) => (e.track.id === id ? next : e)));
  cloud.push(id, next);
}

/**
 * Look up + verify a track's real metadata and update its entry. ACCURACY FIRST:
 * the AI only proposes a cleaner title + an artist HINT — iTunes is the authority
 * that must CONFIRM the artist (and genre) before we attribute it. If iTunes
 * can't confirm (no title match, or the title is shared by several artists), we
 * leave the track exactly as-is rather than crediting the wrong artist/genre.
 * Returns true only when a verified match was applied. Also the manual
 * "buscar capa" retry. Never throws; keeps the audio + id unchanged.
 */
export async function enrichLocalTrack(id: string): Promise<boolean> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return false;
  // Hint = the artist we already have (from the filename / a prior confirmed
  // match) — NEVER an AI guess (that hallucinated, e.g. Charlie Brown → Geraldo
  // Azevedo). iTunes is the authority and must confirm the artist (strict title
  // match) before we attribute it. The AI's role is a separate periodic audit.
  const currentArtist = entry.track.artists
    .map((a) => a.name)
    .filter((n) => n && n !== 'Desconhecido')[0];

  // VERIFICADOR (metaTeam): confirma no iTunes só com um palpite sustentado por
  // evidência — sem artista conhecido ele se recusa a procurar (buscar por
  // título sozinho é o que fabricava créditos errados).
  const verified = await verificadorConfirma(entry.track.title, currentArtist);
  const current = read().find((e) => e.track.id === id);
  if (!current) return false;

  if (!verified) return false; // couldn't confirm → NEVER guess; leave as-is

  const base = localTrackDto(
    id,
    verified.title,
    verified.artists, // iTunes-authoritative, split into distinct artists
    current.track.durationMs,
    verified.album,
    verified.coverUrl ?? current.track.coverUrl,
  );
  const track: TrackDto = {
    ...base,
    genre: verified.genre ?? current.track.genre ?? null, // iTunes genre only
    streamUrl: current.remoteUrl ?? current.track.streamUrl,
  };
  patchEntry(id, { ...current, track });
  prefetchLyrics(track); // fetch synced lyrics with the corrected name
  if (current.sourceUrl) void publishSharedTrack(track, current.sourceUrl);
  return true;
}

/** Enrich a list of ids one at a time (gentle on the iTunes endpoint). */
async function enrichSequentially(ids: string[]): Promise<void> {
  for (const id of ids) {
    await enrichLocalTrack(id).catch(() => undefined);
  }
}

// ── add by direct URL ───────────────────────────────────────────

/** Streaming-platform PAGE hosts we must refuse (never scrape/resolve). */
const STREAMING_HOSTS: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /(^|\.)spotify\.com$/i, label: 'Spotify' },
  { match: /(^|\.)youtube\.com$/i, label: 'YouTube' },
  { match: /(^|\.)youtu\.be$/i, label: 'YouTube' },
  { match: /(^|\.)youtube-nocookie\.com$/i, label: 'YouTube' },
  { match: /(^|\.)soundcloud\.com$/i, label: 'SoundCloud' },
  { match: /(^|\.)deezer\.com$/i, label: 'Deezer' },
  { match: /(^|\.)tidal\.com$/i, label: 'Tidal' },
  { match: /(^|\.)music\.apple\.com$/i, label: 'Apple Music' },
];

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;

/** Store an audio blob as a local track (shared path for imports + URLs). */
async function saveBlobAsLocalTrack(
  blob: Blob,
  opts: {
    title: string;
    sourceUrl?: string;
    coverUrl?: string | null;
    /** Real metadata from yt-dlp (YouTube Music) — trusted over title parsing. */
    artist?: string | null;
    track?: string | null;
    album?: string | null;
    /** Channel/uploader — the artist identity for underground/self-published tracks. */
    uploader?: string | null;
  },
): Promise<TrackDto> {
  // Dedup: same source link, or byte-identical audio already in the library.
  if (opts.sourceUrl) {
    const bySource = findBySource(opts.sourceUrl);
    if (bySource) return bySource;
  }
  const hash = await hashBlob(blob);
  if (hash) {
    const byHash = findByHash(hash);
    if (byHash) return byHash;
  }
  const id = `local:${crypto.randomUUID()}`;
  // TIME DE METADADOS: o EXTRATOR consolida as evidências da fonte (yt-dlp +
  // canal do uploader, via CURADOR) e o JUIZ decide o crédito por precedência —
  // fonte > "Artista - Título" > canal. Faixa underground num canal de artista
  // ("MILAGRE" no canal Brandão85) sai creditada ao canal, nunca "Desconhecido".
  const ev = extrator({
    artist: opts.artist,
    track: opts.track,
    album: opts.album,
    uploader: opts.uploader,
    title: opts.title,
  });
  const credito = juizDecideCredito(ev);
  // VERIFICADOR — lente de álbum: quando a fonte cita um álbum, identifica o
  // álbum REAL no catálogo e adota artista/capa autoritativos (só com a faixa
  // comprovadamente na tracklist).
  const albumVer = await verificadorAlbum(ev).catch(() => null);
  const durationMs = await probeDurationMs(blob);
  const mimeType = blob.type || 'audio/mpeg';
  // Seed with the source thumbnail (e.g. YouTube cover) so it's never blank;
  // enrichment may upgrade it to a clean album cover afterwards.
  const track = localTrackDto(
    id,
    credito.title,
    albumVer?.artist ?? credito.artist,
    durationMs,
    albumVer?.album ?? credito.album,
    albumVer?.coverUrl ?? opts.coverUrl ?? null,
  );
  await putBlob(id, blob).catch(() => undefined);
  addEntry(
    {
      track,
      addedAt: new Date().toISOString(),
      sizeBytes: blob.size,
      mimeType,
      ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
      ...(hash ? { contentHash: hash } : {}),
    },
    blob,
  );
  void uploadAndLink(id, blob);
  return track;
}

/**
 * Add a track from a DIRECT audio-file URL. Refuses streaming-platform pages
 * (never scrapes them), downloads the file in-browser, validates it is audio,
 * stores it locally and enriches its cover/metadata. Throws friendly pt-BR
 * errors the caller shows as a toast.
 */
export async function addByUrl(url: string, opts: { silent?: boolean } = {}): Promise<TrackDto> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Cole um link válido (que comece com http:// ou https://).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Cole um link válido (que comece com http:// ou https://).');
  }

  const host = parsed.hostname.toLowerCase();

  // Media pages (YouTube, SoundCloud, Vimeo, Bandcamp…): a browser cannot fetch
  // their audio directly (CORS + player signature). If the user is running the
  // local importer helper (apps/importer), route the link through it — it fetches
  // + converts to MP3 on their own machine and we store it like any local track.
  if (importerHostLabel(host)) {
    const imported = await importViaHelper(parsed.toString());
    const track = await saveBlobAsLocalTrack(imported.blob, {
      title: `${imported.title}.mp3`,
      sourceUrl: parsed.toString(),
      coverUrl: imported.coverUrl,
      artist: imported.artist,
      track: imported.track,
      album: imported.album,
      uploader: imported.uploader,
    });
    void enrichLocalTrack(track.id).catch(() => undefined);
    void publishSharedTrack(track, parsed.toString()); // share with the community
    if (!opts.silent)
      pushNotification({ type: 'import', title: 'Música baixada', body: track.title });
    return track;
  }

  // Other streaming platforms we can't (and won't) resolve.
  const streaming = STREAMING_HOSTS.find((s) => s.match.test(host));
  if (streaming) {
    throw new Error(
      `Não dá para importar do ${streaming.label} por aqui. Cole o link direto de um arquivo de áudio ou importe o arquivo.`,
    );
  }

  const blockedMessage =
    'Não consegui baixar desse link pelo navegador (o servidor pode bloquear). Baixe o arquivo e importe em “Importar arquivos”.';
  let res: Response;
  try {
    res = await fetch(parsed.toString());
  } catch {
    throw new Error(blockedMessage);
  }
  if (!res.ok) throw new Error(blockedMessage);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const isAudio = contentType.startsWith('audio/') || AUDIO_EXT.test(parsed.pathname);
  if (!isAudio) {
    throw new Error('Esse link não parece ser um arquivo de áudio.');
  }

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error('Esse link não parece ser um arquivo de áudio.');
  }

  const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'faixa');
  const track = await saveBlobAsLocalTrack(blob, { title: fileName, sourceUrl: parsed.toString() });
  void enrichLocalTrack(track.id).catch(() => undefined);
  void publishSharedTrack(track, parsed.toString()); // share with the community
  if (!opts.silent)
    pushNotification({ type: 'import', title: 'Música baixada', body: track.title });
  return track;
}

/**
 * Import a whole playlist by link: enumerate its entries via the importer, then
 * import each track through the normal path (covers, lyrics, community share).
 * Reports progress; a single summary notification is pushed at the end.
 */
export async function addPlaylistByUrl(
  url: string,
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<{ imported: number; total: number }> {
  const { entries } = await fetchPlaylistEntries(url);
  if (entries.length === 0) throw new Error('Não encontramos faixas nessa playlist.');

  let imported = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    onProgress?.(i, entries.length, entry.title);
    try {
      await addByUrl(entry.url, { silent: true });
      imported += 1;
    } catch {
      /* skip a failed entry, keep going */
    }
  }
  pushNotification({
    type: 'import',
    title: 'Playlist importada',
    body: `${imported} de ${entries.length} faixas adicionadas`,
  });
  return { imported, total: entries.length };
}

export function list(): LibraryEntry[] {
  return read();
}

export function has(id: string): boolean {
  return read().some((e) => e.track.id === id);
}

/** A locally-stored track imported from the same source URL, if any. */
export function findBySource(sourceUrl: string): TrackDto | null {
  return read().find((e) => e.sourceUrl === sourceUrl)?.track ?? null;
}

/** A locally-stored track with byte-identical audio, if any. */
export function findByHash(hash: string): TrackDto | null {
  return read().find((e) => e.contentHash === hash)?.track ?? null;
}

/** A library track matching this title (+ artist), if you own it — for showing
 *  which album tracks are already in your library. */
export function findOwnedTrack(title: string, artist?: string): TrackDto | null {
  const t = normName(title);
  if (!t) return null;
  const a = artist ? normName(artist) : '';
  for (const e of read()) {
    if (normName(e.track.title) !== t) continue;
    if (a && !e.track.artists.some((x) => normName(x.name) === a)) continue;
    return e.track;
  }
  return null;
}

/** The original import link for a local track (for streaming on a device without the audio). */
export function sourceUrlFor(id: string): string | null {
  return read().find((e) => e.track.id === id)?.sourceUrl ?? null;
}

/** The uploaded-audio stream URL for a local track, if it was uploaded. */
export function remoteUrlFor(id: string): string | null {
  return read().find((e) => e.track.id === id)?.remoteUrl ?? null;
}

// ── album / artist organization (Spotify-style, all from local metadata) ──
function normName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface LocalAlbum {
  key: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  tracks: TrackDto[];
}

const albumKey = (title: string, artist: string): string =>
  `${normName(title)}|${normName(artist)}`;

/**
 * Group library tracks into real albums. A track counts as an album only when
 * its album has 2+ tracks OR the album name differs from the track name (a
 * genuine release, not an auto "Title - Single"). Everything else is a single.
 */
function computeAlbumGroups(): LocalAlbum[] {
  const byKey = new Map<string, LocalAlbum>();
  for (const entry of read()) {
    const t = entry.track;
    const title = t.album?.title?.trim();
    if (!title) continue;
    const artist = t.artists[0]?.name?.trim() || 'Desconhecido';
    const key = albumKey(title, artist);
    let album = byKey.get(key);
    if (!album) {
      album = { key, title, artist, coverUrl: t.coverUrl ?? null, tracks: [] };
      byKey.set(key, album);
    }
    album.tracks.push(t);
    if (!album.coverUrl && t.coverUrl) album.coverUrl = t.coverUrl;
  }
  return [...byKey.values()].filter(
    (a) => a.tracks.length >= 2 || normName(a.title) !== normName(a.tracks[0]?.title ?? ''),
  );
}

/** Memo dos derivados — recalcula UMA vez por mudança da biblioteca. */
function ensureGroups(): NonNullable<typeof groupsCache> {
  return (groupsCache ??= {
    albums: computeAlbumGroups(),
    artists: computeArtists(),
    genres: computeGenreGroups(),
  });
}

export function albumGroups(): LocalAlbum[] {
  return ensureGroups().albums;
}

export function albumByKey(key: string): LocalAlbum | null {
  return albumGroups().find((a) => a.key === key) ?? null;
}

/** Tracks that aren't part of a real album (singles + album-less). */
export function singles(): TrackDto[] {
  const inAlbum = new Set<string>();
  for (const album of albumGroups()) for (const t of album.tracks) inAlbum.add(t.id);
  return read()
    .map((e) => e.track)
    .filter((t) => !inAlbum.has(t.id));
}

export interface LocalArtist {
  name: string;
  coverUrl: string | null;
  trackCount: number;
}

/** Every distinct artist across the library, most tracks first. */
export function artists(): LocalArtist[] {
  return ensureGroups().artists;
}

function computeArtists(): LocalArtist[] {
  const byName = new Map<string, LocalArtist>();
  for (const entry of read()) {
    for (const artist of entry.track.artists) {
      const name = artist.name?.trim();
      if (!name || name === 'Desconhecido') continue;
      const key = normName(name);
      let a = byName.get(key);
      if (!a) {
        a = { name, coverUrl: entry.track.coverUrl ?? null, trackCount: 0 };
        byName.set(key, a);
      }
      a.trackCount += 1;
      if (!a.coverUrl && entry.track.coverUrl) a.coverUrl = entry.track.coverUrl;
    }
  }
  return [...byName.values()].sort((x, y) => y.trackCount - x.trackCount);
}

/** All tracks credited to an artist (by name). */
export function artistTracks(name: string): TrackDto[] {
  const key = normName(name);
  return read()
    .map((e) => e.track)
    .filter((t) => t.artists.some((a) => normName(a.name) === key));
}

/** Real albums by a given artist. */
export function artistAlbums(name: string): LocalAlbum[] {
  const key = normName(name);
  return albumGroups().filter((a) => normName(a.artist) === key);
}

export interface LocalGenre {
  genre: string;
  coverUrl: string | null;
  tracks: TrackDto[];
}

/** Library tracks grouped by their (AI-assigned) genre, biggest first. */
export function genreGroups(): LocalGenre[] {
  return ensureGroups().genres;
}

function computeGenreGroups(): LocalGenre[] {
  const byKey = new Map<string, LocalGenre>();
  for (const entry of read()) {
    const g = entry.track.genre?.trim();
    if (!g) continue;
    const key = g.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { genre: g, coverUrl: entry.track.coverUrl ?? null, tracks: [] };
      byKey.set(key, group);
    }
    group.tracks.push(entry.track);
    if (!group.coverUrl && entry.track.coverUrl) group.coverUrl = entry.track.coverUrl;
  }
  return [...byKey.values()].sort((a, b) => b.tracks.length - a.tracks.length);
}

/** All library tracks of a given genre (by name, case-insensitive). */
export function genreTracks(genre: string): TrackDto[] {
  const key = genre.trim().toLowerCase();
  return read()
    .map((e) => e.track)
    .filter((t) => (t.genre ?? '').trim().toLowerCase() === key);
}

/** Object URL for a local track, or null when its audio is not available. */
export function localAudioUrl(id: string): string | null {
  return blobUrls.get(id) ?? null;
}

/** Raw bytes for a local track (for sending over P2P). */
export async function blobFor(id: string): Promise<Blob | null> {
  const url = blobUrls.get(id);
  if (url) {
    try {
      return await (await fetch(url)).blob();
    } catch {
      /* object URL revoked — fall back to cache */
    }
  }
  return getBlob(id);
}

export async function remove(id: string): Promise<void> {
  await deleteBlob(id).catch(() => undefined);
  void deleteTrackBlob(id); // best-effort remove the uploaded cross-device copy
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
  write(read().filter((e) => e.track.id !== id));
  cloud.remove(id);
}

/** Remove several tracks at once (multi-select delete). */
export async function removeMany(ids: Iterable<string>): Promise<void> {
  for (const id of ids) await remove(id);
}

// ── de-duplication ──────────────────────────────────────────────
/** Normalized identity: the same song collapses to one key even under a
 *  slightly different title (title + primary artist + 3s duration bucket). */
function dedupeKey(track: TrackDto): string | null {
  const title = normName(track.title);
  if (!title || title === 'faixa') return null; // too generic to dedup safely
  const artist = normName(track.artists[0]?.name ?? '');
  const durBucket = Math.round((track.durationMs || 0) / 3000);
  return `${title}|${artist}|${durBucket}`;
}

/** Which duplicate to keep: local audio > uploaded copy > has cover > older. */
function preferredEntry(a: LibraryEntry, b: LibraryEntry): LibraryEntry {
  const score = (e: LibraryEntry): number =>
    (blobUrls.has(e.track.id) ? 4 : 0) + (e.remoteUrl ? 2 : 0) + (e.track.coverUrl ? 1 : 0);
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return (a.addedAt || '') <= (b.addedAt || '') ? a : b; // older wins ties
}

/**
 * Collapse duplicate tracks (same song even under different titles) down to a
 * single copy — keeping the most complete one and deleting the rest (audio +
 * uploaded copy + synced entry). Returns how many were removed.
 */
export async function dedupeLibrary(): Promise<number> {
  const winners = new Map<string, LibraryEntry>();
  const losers: string[] = [];
  for (const e of read()) {
    const key = dedupeKey(e.track);
    if (!key) continue;
    const prev = winners.get(key);
    if (!prev) {
      winners.set(key, e);
      continue;
    }
    const keep = preferredEntry(prev, e);
    winners.set(key, keep);
    losers.push((keep === prev ? e : prev).track.id);
  }
  if (losers.length === 0) return 0;
  const drop = new Set(losers);
  write(read().filter((e) => !drop.has(e.track.id)));
  for (const id of losers) {
    const url = blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      blobUrls.delete(id);
    }
    void deleteBlob(id).catch(() => undefined);
    void deleteTrackBlob(id);
    cloud.remove(id);
  }
  return losers.length;
}

export function totalBytes(): number {
  return read().reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
}

/** Advertise-able metadata for a local track (for P2P manifests). */
export function sharedMeta(id: string): SharedTrackMeta | null {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return null;
  const { track } = entry;
  return {
    id: track.id,
    title: track.title,
    artist: track.artists[0]?.name ?? 'Desconhecido',
    album: track.album?.title ?? null,
    durationMs: track.durationMs,
    sizeBytes: entry.sizeBytes,
    mimeType: entry.mimeType,
    coverDataUrl: track.coverUrl && track.coverUrl.startsWith('data:') ? track.coverUrl : null,
  };
}

let hydratePromise: Promise<void> | null = null;

/**
 * Rebuild the object-URL map from Cache Storage on boot so local tracks are
 * immediately playable. Entries without local audio are kept (they may be
 * synced from another device) — they simply aren't playable here.
 */
export function hydrate(): Promise<void> {
  return (hydratePromise ??= (async () => {
    if (!cacheStorageSupported()) return;
    for (const entry of read()) {
      if (blobUrls.has(entry.track.id)) continue;
      const blob = await getBlob(entry.track.id).catch(() => null);
      if (blob) blobUrls.set(entry.track.id, URL.createObjectURL(blob));
    }
    emit();
    scheduleBackgroundCuration();
  })());
}

/**
 * Background, sequential curation (uploads + metadata healing). ALL of it hits
 * the network — offline it must not run at all (playback stays 100% local);
 * it waits for the connection to come back instead.
 */
function scheduleBackgroundCuration(): void {
  const run = (): void =>
    void (async () => {
      await backfillRemote();
      await reprocessExisting();
      await dedupeLibrary().catch(() => 0); // collapse same-song duplicates
      await redriveFromSource().catch(() => false); // real metadata from the source
      await auditAttributions().catch(() => undefined); // AI spot-checks a few
    })();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    window.addEventListener('online', run, { once: true });
    return;
  }
  run();
}

/** Respiro entre itens dos passes de fundo — sem isso, centenas de iterações
 *  seguidas (stringify + renders) travavam a página em aparelhos modestos. */
const descanso = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One-time-ish backfill: upload any track that has local audio here but no
 * `remoteUrl` yet, so tracks added before cross-device sync existed become
 * playable on the user's other devices too. Sequential + best-effort; a track
 * that already has a remoteUrl (or no local audio) is skipped, so after the
 * first successful pass this does nothing.
 */
async function backfillRemote(): Promise<void> {
  for (const entry of read()) {
    if (entry.remoteUrl) continue;
    const blob = await blobFor(entry.track.id).catch(() => null);
    if (!blob) continue; // synced-in from another device — nothing to upload here
    await uploadAndLink(entry.track.id, blob);
    await descanso();
  }
}

// ── one-time reprocess of pre-existing tracks ───────────────────
// Tracks added before the accuracy/multi-artist work can have a wrong cover,
// a wrong name, or two collaborating artists merged into one (which also breaks
// lyrics lookup). Bump REPROCESS_VERSION to re-run this pass for everyone.
const REPROCESS_KEY = 'aurial:reprocessVersion';
// v6: TIME DE METADADOS completo — a FONTE é a autoridade. Re-deriva TODAS as
// faixas da fonte (cura créditos alucinados, ex. "Warzone" do Brandão85 →
// The Wanted) com a lente de álbum (Deezer) e re-audita tudo. v6 re-arma a
// cura da v5, que podia rodar contra um importer ANTIGO sem uploader/álbum e
// "concluir" sem curar nada — agora o passe exige as capacidades novas.
const REPROCESS_VERSION = 6;

// ── periodic AI audit of attributions ───────────────────────────
// iTunes has the final word on who a song is by; the AI just periodically
// checks a few tracks and, if it flags a likely mismatch, we re-run the iTunes
// verification (which decides). Audited ids live in a local set (not synced).
const AUDITED_KEY = 'aurial:auditedArtists';

function readAudited(): Set<string> {
  try {
    const raw = window.localStorage.getItem(AUDITED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function markAudited(ids: string[]): void {
  try {
    const s = readAudited();
    for (const id of ids) s.add(id);
    window.localStorage.setItem(AUDITED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Strip a credit we KNOW is wrong: better "Desconhecido" than the wrong name
 *  (the wrong artist photo disappears with it — photos are looked up by name). */
function clearWrongCredit(id: string): void {
  const cur = read().find((e) => e.track.id === id);
  if (!cur) return;
  const track: TrackDto = {
    ...cur.track,
    artists: [{ id: `local-artist:${id}:0`, name: 'Desconhecido', slug: '', imageUrl: null }],
    genre: null, // the genre came from the same wrong match
  };
  patchEntry(id, { ...cur, track });
}

/** AUDITOR: audit up to `limit` not-yet-checked attributed tracks per run
 *  (spreads the cost over sessions). A IA só LEVANTA a suspeita (nunca decide):
 *  num "NÃO" claro, tenta (1) confirmar no catálogo, (2) re-derivar da FONTE
 *  (uploader/metadados reais) e, só se nada provar um crédito, apaga o errado —
 *  melhor "Desconhecido" que um artista alucinado. */
async function auditAttributions(limit = 12): Promise<void> {
  const audited = readAudited();
  const todo = read()
    .filter((e) => {
      const a = e.track.artists[0]?.name;
      return a && a !== 'Desconhecido' && !audited.has(e.track.id);
    })
    .slice(0, limit);
  if (todo.length === 0) return;
  // Sem o importer novo a cura pela fonte não existe — não apaga crédito nenhum
  // ainda (senão viraria "Desconhecido" o que a fonte poderia provar depois).
  if (!(await helperSupportsMetaTeam())) return;
  const done: string[] = [];
  for (const e of todo) {
    const verdict = await aiVerifyArtist(
      e.track.title,
      e.track.artists.map((a) => a.name).join(', '),
    ).catch(() => null);
    if (verdict === false) {
      const confirmed = await enrichLocalTrack(e.track.id).catch(() => false);
      if (!confirmed) {
        const result = await rederiveTrackFromSource(e.track.id).catch(() => 'failed' as const);
        // Importador fora do ar → NÃO apaga o crédito (a fonte poderia prová-lo
        // depois) e não marca como auditada — re-tenta noutra sessão.
        if (result === 'failed') continue;
        if (result === 'unchanged') clearWrongCredit(e.track.id);
      }
    }
    done.push(e.track.id);
    await descanso();
  }
  if (done.length > 0) markAudited(done);
}

// ── re-identify existing tracks from their SOURCE metadata (yt-dlp) ──────────
const REDERIVE_KEY = 'aurial:rederivedSet';

function readRederived(): Set<string> {
  try {
    const raw = window.localStorage.getItem(REDERIVE_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function markRederived(ids: string[]): void {
  try {
    const s = readRederived();
    for (const id of ids) s.add(id);
    window.localStorage.setItem(REDERIVE_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * AUDITOR (metaTeam): re-deriva UMA faixa da sua fonte. Busca os metadados
 * reais (yt-dlp, incluindo o canal do uploader), o JUIZ decide o crédito por
 * precedência de evidência e, quando o crédito antigo CONFLITA com a fonte
 * (crédito alucinado por catálogo/IA — ex. "Warzone" → The Wanted), descarta
 * também a capa/álbum/gênero herdados do match errado, voltando à capa da
 * fonte. Resultado distingue FALHA (importador indisponível — tentar depois)
 * de "nada novo" (a fonte concorda com o que já temos) e de "atualizado".
 */
type RederiveResult = 'failed' | 'unchanged' | 'updated';

async function rederiveTrackFromSource(id: string): Promise<RederiveResult> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry?.sourceUrl || importerHostLabel(hostOf(entry.sourceUrl)) === null) return 'unchanged';
  const meta = await fetchTrackMeta(entry.sourceUrl).catch(() => null);
  if (!meta) return 'failed';
  const cur = read().find((x) => x.track.id === id);
  if (!cur) return 'unchanged';

  const ev = extrator({
    artist: meta.artist,
    track: meta.track,
    album: meta.album,
    uploader: meta.uploader,
    title: meta.title,
  });
  const atual = cur.track.artists[0]?.name ?? null;
  const conflito = juizCreditoConflita(ev, atual);
  const credito = juizDecideCredito(ev, { artist: conflito ? null : atual });
  // VERIFICADOR — lente de álbum: se a fonte cita um álbum real, o artista e a
  // capa autoritativos vêm dele (prova dupla: título do álbum + faixa na
  // tracklist). É o que devolve o "Nadando Cem Os Tubarões" ao Charlie Brown Jr.
  const albumVer = await verificadorAlbum(ev).catch(() => null);

  const artistFinal = albumVer?.artist ?? credito.artist;
  const sameArtist = artistFinal === (atual ?? 'Desconhecido');
  const sameTitle = credito.title === cur.track.title;
  if (!conflito && !albumVer && sameArtist && sameTitle && !credito.album) return 'unchanged';

  const base = localTrackDto(
    id,
    credito.title || cur.track.title,
    artistFinal,
    cur.track.durationMs,
    albumVer?.album ?? credito.album ?? (conflito ? null : (cur.track.album?.title ?? null)),
    // Capa herdada de um match alucinado sai junto com o crédito errado; a capa
    // real do álbum (lente) tem prioridade sobre o thumbnail da fonte.
    albumVer?.coverUrl ?? (conflito ? (safeCoverUrl(meta.thumbnail) ?? null) : cur.track.coverUrl),
  );
  const track: TrackDto = {
    ...base,
    genre: conflito ? null : (cur.track.genre ?? null),
    streamUrl: cur.remoteUrl ?? cur.track.streamUrl,
  };
  patchEntry(id, { ...cur, track });
  // VERIFICADOR: com o crédito agora provado, o iTunes pode refinar capa/gênero
  // (só aplica quando título E artista batem — underground fica como está).
  await enrichLocalTrack(id).catch(() => undefined);
  if (cur.sourceUrl) {
    const healed = read().find((x) => x.track.id === id);
    if (healed) void publishSharedTrack(healed.track, cur.sourceUrl);
  }
  return 'updated';
}

/**
 * AUDITOR: varre faixas ainda não re-derivadas da fonte, algumas por sessão
 * (gentil com o YouTube). Cada faixa passa pelo pipeline completo do time —
 * EXTRATOR → CURADOR → JUIZ → VERIFICADOR. Falhas não são marcadas (a faixa
 * tenta de novo na próxima sessão) e 3 falhas SEGUIDAS abortam a varredura —
 * um importador com problema não vira uma enxurrada de erros no console.
 * Retorna true quando o lote terminou sem abortar.
 */
async function redriveFromSource(limit = 6): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const done = readRederived();
  const todo = read()
    .filter(
      (e) =>
        e.sourceUrl && !done.has(e.track.id) && importerHostLabel(hostOf(e.sourceUrl)) !== null,
    )
    .slice(0, limit);
  if (todo.length === 0) return true;
  // Um importer ANTIGO (sem uploader/álbum) responderia sem as evidências e a
  // faixa seria marcada como "re-derivada" sem cura — só roda com o novo.
  if (!(await helperSupportsMetaTeam())) return false;
  const marked: string[] = [];
  let consecutiveFailures = 0;
  let aborted = false;
  for (const e of todo) {
    const result = await rederiveTrackFromSource(e.track.id).catch(() => 'failed' as const);
    if (result === 'failed') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        aborted = true;
        break;
      }
      continue; // não marca — tenta de novo quando o importador estiver saudável
    }
    consecutiveFailures = 0;
    marked.push(e.track.id);
    await descanso();
  }
  if (marked.length > 0) markRederived(marked);
  return !aborted;
}

/** Split a single merged artist credit on an existing track (when enrichment couldn't). */
async function resplitArtistsInPlace(id: string): Promise<void> {
  const cur = read().find((e) => e.track.id === id);
  if (!cur || cur.track.artists.length > 1) return; // already split
  const combined = cur.track.artists[0]?.name?.trim();
  if (!combined || combined === 'Desconhecido') return;
  let names = splitArtistNames(combined);
  if (names.length <= 1 && creditIsAmbiguous(combined)) {
    const ai = await aiSplitArtists(combined, cur.track.title);
    if (ai && ai.length > 1) names = ai;
  }
  if (names.length <= 1) return; // genuinely a single artist
  const track = localTrackDto(
    id,
    cur.track.title,
    names,
    cur.track.durationMs,
    cur.track.album?.title ?? null,
    cur.track.coverUrl,
  );
  patchEntry(id, { ...cur, track: { ...track, streamUrl: cur.remoteUrl ?? cur.track.streamUrl } });
}

/**
 * Re-run enrichment (correct cover/name + split artists) once over every local
 * track. Enrichment only applies a confident match, so it never worsens good
 * data; when it can't confirm, we still split a merged artist credit in place.
 */
async function reprocessExisting(): Promise<void> {
  try {
    if (Number(window.localStorage.getItem(REPROCESS_KEY) || '0') >= REPROCESS_VERSION) return;
  } catch {
    return;
  }
  // A cura depende do importer NOVO (uploader + lente de álbum). Sem ele no ar,
  // NÃO marca a versão — tenta de novo no próximo boot, em vez de "concluir"
  // uma cura que não aconteceu (foi o que a v5 fazia contra o importer antigo).
  if (!(await helperSupportsMetaTeam())) return;

  // 1. AUDITOR: a fonte primeiro — re-deriva TODAS as faixas (zera o controle
  //    para incluir as que a v<6 marcou como feitas com o crédito errado).
  try {
    window.localStorage.removeItem(REDERIVE_KEY);
    window.localStorage.removeItem(AUDITED_KEY);
  } catch {
    /* ignore */
  }
  const completed = await redriveFromSource(Number.POSITIVE_INFINITY).catch(() => false);
  // Importador instável no meio do passe → NÃO grava a versão; o que faltou
  // re-tenta na próxima sessão (as re-derivadas com sucesso ficam marcadas).
  if (!completed) return;

  // 2. VERIFICADOR: refina capa/nome no catálogo (só matches estritos) e
  //    separa créditos de colaboração ainda fundidos num nome só.
  for (const entry of read()) {
    if (!entry.track.id.startsWith('local:')) continue;
    const applied = await enrichLocalTrack(entry.track.id).catch(() => false);
    if (!applied) await resplitArtistsInPlace(entry.track.id).catch(() => undefined);
    await descanso();
  }

  // 3. AUDITOR (IA): re-audita todos os créditos com o pipeline de cura novo.
  await auditAttributions(Number.POSITIVE_INFINITY).catch(() => undefined);
  try {
    window.localStorage.setItem(REPROCESS_KEY, String(REPROCESS_VERSION));
  } catch {
    /* ignore */
  }
}
