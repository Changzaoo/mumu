/**
 * Background import queue. Paste as many links as you want — they line up and
 * download a few at a time (yt-dlp on the importer), so you can keep adding more
 * while the earlier ones finish. Playlists expand into one queued item per
 * track. Progress is observable for a small status panel; failures are kept so
 * they can be retried, and duplicates are skipped by localLibrary itself.
 */
import * as localLibrary from '@/lib/local/localLibrary';
import { fetchPlaylistEntries, isPlaylistUrl } from '@/lib/local/importerHelper';

export type ImportStatus = 'pending' | 'downloading' | 'done' | 'error';

export interface ImportItem {
  id: string;
  url: string;
  status: ImportStatus;
  title?: string;
  error?: string;
}

/** How many links download at once. One at a time: each runs yt-dlp on the home
 *  server AND hits YouTube, and bursts trigger YouTube's "confirm you're not a
 *  bot" gate — serial + the importer's per-download sleeps stay under the radar. */
const CONCURRENCY = 1;

const STORAGE_KEY = 'aurial:import-queue';

let items: ImportItem[] = [];
let active = 0;
let seq = 0;
const listeners = new Set<() => void>();

/** Persist unfinished work so links survive a reload and keep downloading. */
function persist(): void {
  try {
    const keep = items.filter((i) => i.status !== 'done'); // done items don't need to linger
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch {
    /* quota / private mode */
  }
}

function restore(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return;
    items = parsed
      .filter((i): i is ImportItem => Boolean(i && typeof (i as ImportItem).url === 'string'))
      // Anything mid-download when we closed goes back to the queue.
      .map((i) => (i.status === 'downloading' ? { ...i, status: 'pending' } : i));
    for (const i of items) {
      const n = Number(String(i.id).replace(/^q/, ''));
      if (Number.isFinite(n) && n > seq) seq = n;
    }
  } catch {
    /* ignore */
  }
}

function emit(): void {
  persist();
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function list(): ImportItem[] {
  return items;
}

/** Counts for a compact indicator (e.g. "3 baixando · 5 na fila"). */
export function stats(): { pending: number; downloading: number; done: number; error: number } {
  const s = { pending: 0, downloading: 0, done: 0, error: 0 };
  for (const it of items) s[it.status] += 1;
  return s;
}

/** Forget finished/failed items (keeps anything still in flight). */
export function clearFinished(): void {
  items = items.filter((it) => it.status === 'pending' || it.status === 'downloading');
  emit();
}

function update(id: string, patch: Partial<ImportItem>): void {
  items = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  emit();
}

/** Add one or more links to the queue and start (or keep) processing. */
export function enqueue(urls: string | string[]): void {
  const incoming = (Array.isArray(urls) ? urls : [urls]).map((u) => u.trim()).filter(Boolean);
  if (incoming.length === 0) return;
  const busyUrls = new Set(
    items.filter((i) => i.status === 'pending' || i.status === 'downloading').map((i) => i.url),
  );
  for (const url of incoming) {
    if (busyUrls.has(url)) continue; // already queued / in progress
    busyUrls.add(url);
    items = [...items, { id: `q${++seq}`, url, status: 'pending' }];
  }
  emit();
  pump();
}

/** Retry a failed item. */
export function retry(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== 'error') return;
  update(id, { status: 'pending', error: undefined });
  pump();
}

function pump(): void {
  while (active < CONCURRENCY) {
    const next = items.find((i) => i.status === 'pending');
    if (!next) break;
    active += 1;
    update(next.id, { status: 'downloading' });
    void process(next).finally(() => {
      active -= 1;
      pump();
    });
  }
}

// Load any queue saved from a previous session as soon as this module is used.
restore();

/** Resume the persisted queue on app boot (call once). */
export function init(): void {
  if (items.some((i) => i.status === 'pending')) pump();
}

async function process(item: ImportItem): Promise<void> {
  try {
    if (isPlaylistUrl(item.url)) {
      // Expand the playlist into individual queued items so each downloads
      // independently (and a big list doesn't hold a slot the whole time).
      const { entries } = await fetchPlaylistEntries(item.url);
      enqueue(entries.map((e) => e.url));
      update(item.id, { status: 'done', title: `Playlist · ${entries.length} faixas` });
      return;
    }
    const track = await localLibrary.addByUrl(item.url, { silent: true });
    update(item.id, { status: 'done', title: track.title });
  } catch (err) {
    update(item.id, {
      status: 'error',
      error: err instanceof Error ? err.message : 'Falha ao baixar',
    });
  }
}
