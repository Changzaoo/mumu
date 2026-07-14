/**
 * Local play history — kept entirely on-device in localStorage. Entries are
 * HistoryEntryDto-compatible so HistoryPage renders them unchanged.
 */
import type { HistoryEntryDto, PlaySource, TrackDto } from '@aurial/shared';
import { subscribeAuth } from '@/lib/firebase';

const HISTORY_KEY = 'aurial:local-history';
const MAX_ENTRIES = 200;

/**
 * O storage é DO APARELHO, mas o aparelho é compartilhado entre contas — sem
 * carimbar quem estava logado, uma conta "herdava" na telemetria os plays de
 * outra (vinicinhos ganhou 106 plays do histórico do device). `uid` identifica
 * o dono real de cada reprodução; entradas antigas (sem uid) contam só para o
 * aparelho, nunca para uma conta.
 */
export type LocalHistoryEntry = HistoryEntryDto & { uid?: string | null };

let currentUid: string | null = null;
subscribeAuth((user) => {
  currentUid = user?.uid ?? null;
});

let cache: LocalHistoryEntry[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): LocalHistoryEntry[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as LocalHistoryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: LocalHistoryEntry[]): void {
  cache = next;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — stays in memory */
  }
  emit();
}

/** All history entries, newest-first. */
export function list(): LocalHistoryEntry[] {
  return read();
}

/**
 * Record a play. Collapses consecutive repeats of the same track into a single
 * (timestamp-refreshed) entry, keeps newest-first, and caps the log length.
 */
export function record(track: TrackDto, meta?: { playedMs?: number; source?: PlaySource }): void {
  const current = read();
  const now = new Date().toISOString();
  if (current[0]?.track.id === track.id) {
    const [, ...rest] = current;
    write([{ ...current[0], playedAt: now }, ...rest]);
    return;
  }
  const entry: LocalHistoryEntry = {
    id: `local-play:${crypto.randomUUID()}`,
    playedAt: now,
    playedMs: meta?.playedMs ?? 0,
    source: meta?.source ?? 'queue',
    uid: currentUid,
    track,
  };
  write([entry, ...current].slice(0, MAX_ENTRIES));
}

export function clear(): void {
  write([]);
}

/** Drop history entries for 30s-preview (iTunes) tracks saved before. */
export function purgePreviews(): number {
  const current = read();
  const kept = current.filter((e) => !e.track.previewOnly);
  if (kept.length === current.length) return 0;
  write(kept);
  return current.length - kept.length;
}
