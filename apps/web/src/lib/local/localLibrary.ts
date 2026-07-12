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
import { cacheSupported } from '@/lib/offline/audioCache';
import { cleanQuery, enrichMeta, type EnrichedMeta } from '@/lib/local/enrich';

const CACHE_NAME = 'aurial-library-v1';
const STORAGE_KEY = 'aurial:library';
const keyFor = (id: string): string => `/__library_audio__/${encodeURIComponent(id)}`;

export interface LibraryEntry {
  track: TrackDto;
  addedAt: string;
  sizeBytes: number;
  mimeType: string;
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
  if (!cacheSupported()) return;
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
  if (!cacheSupported()) return null;
  const store = await caches.open(CACHE_NAME);
  const res = await store.match(keyFor(id));
  return res ? await res.blob() : null;
}

async function deleteBlob(id: string): Promise<void> {
  if (!cacheSupported()) return;
  const store = await caches.open(CACHE_NAME);
  await store.delete(keyFor(id));
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
  artist: string,
  durationMs: number,
  album: string | null,
  coverUrl: string | null,
): TrackDto {
  return {
    id,
    title,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl,
    dominantColor: null,
    loudnessLufs: null,
    album: album ? { id: `local-album:${id}`, title: album, slug: '', coverUrl } : null,
    artists: [{ id: `local-artist:${id}`, name: artist, slug: '', imageUrl: null }],
    streamUrl: null,
    downloadUrl: null,
    uploadedByUserId: null,
  };
}

function addEntry(entry: LibraryEntry, blob: Blob): void {
  blobUrls.set(entry.track.id, URL.createObjectURL(blob));
  write([entry, ...read().filter((e) => e.track.id !== entry.track.id)]);
}

// ── public API ──────────────────────────────────────────────────

/** Import dropped/picked audio files into the local library. */
export async function importFiles(files: File[]): Promise<TrackDto[]> {
  const imported: TrackDto[] = [];
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|flac|wav|aac|m4a|ogg|opus)$/i.test(file.name)) {
      continue;
    }
    const id = `local:${crypto.randomUUID()}`;
    const { title, artist } = parseFileName(file.name);
    const durationMs = await probeDurationMs(file);
    const mimeType = file.type || 'audio/mpeg';
    const track = localTrackDto(id, title, artist, durationMs, null, null);

    await putBlob(id, file).catch(() => undefined);
    addEntry({ track, addedAt: new Date().toISOString(), sizeBytes: file.size, mimeType }, file);
    imported.push(track);
  }
  // Non-blocking: fetch real covers/metadata from iTunes for what we just added.
  void enrichSequentially(imported.map((t) => t.id));
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
  return track;
}

// ── enrichment (real covers + metadata from iTunes) ─────────────

/** Replace a registry entry in place, preserving its list position. */
function patchEntry(id: string, next: LibraryEntry): void {
  write(read().map((e) => (e.track.id === id ? next : e)));
}

/** Apply an iTunes match to a local entry (cover, album, corrected name). */
function applyEnrichment(entry: LibraryEntry, meta: EnrichedMeta): LibraryEntry {
  const track = localTrackDto(
    entry.track.id,
    meta.title,
    meta.artist,
    entry.track.durationMs,
    meta.album,
    meta.coverUrl,
  );
  return { ...entry, track };
}

/**
 * Look up real cover/metadata for one local track and update its registry entry
 * (also the manual "buscar capa" retry). Degrades silently: returns false on no
 * match / failure, never throws, keeps the audio + id unchanged.
 */
export async function enrichLocalTrack(id: string): Promise<boolean> {
  const entry = read().find((e) => e.track.id === id);
  if (!entry) return false;
  const artist = entry.track.artists[0]?.name;
  const raw =
    artist && artist !== 'Desconhecido' ? `${artist} - ${entry.track.title}` : entry.track.title;
  const meta = await enrichMeta(cleanQuery(raw));
  if (!meta) return false;
  // Re-read: the entry may have been removed while we awaited the network.
  const current = read().find((e) => e.track.id === id);
  if (!current) return false;
  patchEntry(id, applyEnrichment(current, meta));
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
  opts: { title: string; sourceUrl?: string },
): Promise<TrackDto> {
  const id = `local:${crypto.randomUUID()}`;
  const { title, artist } = parseFileName(opts.title);
  const durationMs = await probeDurationMs(blob);
  const mimeType = blob.type || 'audio/mpeg';
  const track = localTrackDto(id, title, artist, durationMs, null, null);
  await putBlob(id, blob).catch(() => undefined);
  addEntry({ track, addedAt: new Date().toISOString(), sizeBytes: blob.size, mimeType }, blob);
  return track;
}

/**
 * Add a track from a DIRECT audio-file URL. Refuses streaming-platform pages
 * (never scrapes them), downloads the file in-browser, validates it is audio,
 * stores it locally and enriches its cover/metadata. Throws friendly pt-BR
 * errors the caller shows as a toast.
 */
export async function addByUrl(url: string): Promise<TrackDto> {
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
  const streaming = STREAMING_HOSTS.find((s) => s.match.test(host));
  if (streaming) {
    throw new Error(
      `Isso é uma página do ${streaming.label}, não um arquivo. Cole o link direto de um arquivo de áudio ou importe o arquivo.`,
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
  return track;
}

export function list(): LibraryEntry[] {
  return read();
}

export function has(id: string): boolean {
  return read().some((e) => e.track.id === id);
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
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
  write(read().filter((e) => e.track.id !== id));
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
 * immediately playable. Drops registry entries whose audio was evicted / lost.
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!cacheSupported()) return;
  for (const entry of read()) {
    if (blobUrls.has(entry.track.id)) continue;
    const blob = await getBlob(entry.track.id).catch(() => null);
    if (blob) blobUrls.set(entry.track.id, URL.createObjectURL(blob));
    else write(read().filter((e) => e.track.id !== entry.track.id));
  }
  emit();
}
