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
import { cleanQuery, enrichMeta, type EnrichedMeta } from '@/lib/local/enrich';
import { safeCoverUrl, sanitizeText, validateAudioFile } from '@/lib/local/validateAudio';
import { creditIsAmbiguous, splitArtistNames } from '@/lib/local/artists';
import { aiIdentifyTrack, aiSplitArtists } from '@/lib/ai/ai';
import {
  deleteTrackBlob,
  fetchPlaylistEntries,
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

function write(entries: LibraryEntry[]): void {
  cache = entries;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota / private mode — registry stays in memory for the session.
  }
  emit();
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

/** Apply an iTunes match to a local entry (cover, album, corrected name). */
function applyEnrichment(entry: LibraryEntry, meta: EnrichedMeta): LibraryEntry {
  const track = localTrackDto(
    entry.track.id,
    meta.title,
    meta.artists, // distinct artists (never merged into one)
    entry.track.durationMs,
    meta.album,
    // Keep the existing (thumbnail) cover if iTunes has none.
    meta.coverUrl ?? entry.track.coverUrl,
  );
  // Never let enrichment drop the cross-device stream URL set by uploadAndLink.
  return { ...entry, track: { ...track, streamUrl: entry.remoteUrl ?? entry.track.streamUrl } };
}

/**
 * Look up real cover/metadata for one local track and update its registry entry
 * (also the manual "buscar capa" retry). Degrades silently: returns false on no
 * match / failure, never throws, keeps the audio + id unchanged.
 */
export async function enrichLocalTrack(id: string): Promise<boolean> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return false;
  const currentArtist = entry.track.artists
    .map((a) => a.name)
    .filter((n) => n && n !== 'Desconhecido')
    .join(', ');

  // AI "identity agent": the authority on the real title + all creators + genre.
  const identity = await aiIdentifyTrack(entry.track.title, currentArtist || undefined);

  if (identity) {
    const title = identity.title || entry.track.title;
    const artists = identity.artists.length
      ? identity.artists
      : currentArtist
        ? [currentArtist]
        : ['Desconhecido'];
    // Confirm a hi-res cover from iTunes against the AI-resolved title + artist.
    const meta = await enrichMeta({ title, artist: artists[0] });
    const cover = meta?.coverUrl ?? entry.track.coverUrl;

    const current = read().find((e) => e.track.id === id);
    if (!current) return false;
    const base = localTrackDto(id, title, artists, current.track.durationMs, identity.album, cover);
    const track: TrackDto = {
      ...base,
      genre: identity.genre ?? current.track.genre ?? null,
      streamUrl: current.remoteUrl ?? current.track.streamUrl,
    };
    patchEntry(id, { ...current, track });
    prefetchLyrics(track); // fetch synced lyrics with the corrected name
    if (current.sourceUrl) void publishSharedTrack(track, current.sourceUrl);
    return true;
  }

  // Fallback (AI unavailable): iTunes-only match with strict verification.
  const raw = currentArtist ? `${currentArtist} - ${entry.track.title}` : entry.track.title;
  const meta = await enrichMeta(cleanQuery(raw));
  if (!meta) return false;
  const current = read().find((e) => e.track.id === id);
  if (!current) return false;
  const enriched = applyEnrichment(current, meta);
  patchEntry(id, enriched);
  prefetchLyrics(enriched.track);
  if (enriched.sourceUrl) void publishSharedTrack(enriched.track, enriched.sourceUrl);
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
  opts: { title: string; sourceUrl?: string; coverUrl?: string | null },
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
  const { title, artist } = parseFileName(opts.title);
  const durationMs = await probeDurationMs(blob);
  const mimeType = blob.type || 'audio/mpeg';
  // Seed with the source thumbnail (e.g. YouTube cover) so it's never blank;
  // iTunes enrichment may upgrade it to a clean album cover afterwards.
  const track = localTrackDto(id, title, artist, durationMs, null, opts.coverUrl ?? null);
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
    const { blob, title, coverUrl } = await importViaHelper(parsed.toString());
    const track = await saveBlobAsLocalTrack(blob, {
      title: `${title}.mp3`,
      sourceUrl: parsed.toString(),
      coverUrl,
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
export function albumGroups(): LocalAlbum[] {
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

let hydrated = false;

/**
 * Rebuild the object-URL map from Cache Storage on boot so local tracks are
 * immediately playable. Entries without local audio are kept (they may be
 * synced from another device) — they simply aren't playable here.
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!cacheStorageSupported()) return;
  for (const entry of read()) {
    if (blobUrls.has(entry.track.id)) continue;
    const blob = await getBlob(entry.track.id).catch(() => null);
    if (blob) blobUrls.set(entry.track.id, URL.createObjectURL(blob));
  }
  emit();
  // Background, sequential (gentle on the network): upload audio for other
  // devices, then fix covers/names/artist-splits on pre-existing tracks.
  void (async () => {
    await backfillRemote();
    await reprocessExisting();
    await dedupeLibrary().catch(() => 0); // collapse same-song duplicates
  })();
}

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
  }
}

// ── one-time reprocess of pre-existing tracks ───────────────────
// Tracks added before the accuracy/multi-artist work can have a wrong cover,
// a wrong name, or two collaborating artists merged into one (which also breaks
// lyrics lookup). Bump REPROCESS_VERSION to re-run this pass for everyone.
const REPROCESS_KEY = 'aurial:reprocessVersion';
const REPROCESS_VERSION = 1;

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
  for (const entry of read()) {
    if (!entry.track.id.startsWith('local:')) continue;
    const applied = await enrichLocalTrack(entry.track.id).catch(() => false);
    if (!applied) await resplitArtistsInPlace(entry.track.id).catch(() => undefined);
  }
  try {
    window.localStorage.setItem(REPROCESS_KEY, String(REPROCESS_VERSION));
  } catch {
    /* ignore */
  }
}
