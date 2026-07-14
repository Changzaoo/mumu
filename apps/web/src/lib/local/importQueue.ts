/**
 * Background import queue. Paste as many links as you want — they line up and
 * download a few at a time (yt-dlp on the importer), so you can keep adding more
 * while the earlier ones finish. Playlists expand into one queued item per
 * track. Progress is observable for a small status panel; failures are kept so
 * they can be retried, and duplicates are skipped by localLibrary itself.
 *
 * Circuit breaker: um erro de autenticação (401/403) ou 3 falhas seguidas
 * pausam a fila INTEIRA (ver PauseReason) — nunca mais aquele loop de centenas
 * de POSTs 403 no console quando a conta não tem acesso ao importer.
 */
import * as localLibrary from '@/lib/local/localLibrary';
import { fetchPlaylistEntries, isPlaylistUrl } from '@/lib/local/importerHelper';
import { subscribeAuth } from '@/lib/firebase';

export type ImportStatus = 'pending' | 'downloading' | 'done' | 'error';

/**
 * Por que a fila pausou (circuit breaker global):
 *   'auth'    → o importer respondeu 401/403 — retry NUNCA resolve sozinho
 *               (conta sem permissão / usuário deslogado). Sem pausa, uma fila
 *               persistida com centenas de itens vira uma metralhadora de POSTs
 *               403 no console do usuário. Retomamos quando ele loga.
 *   'backoff' → 3 falhas seguidas de qualquer tipo (importer fora do ar, rede…)
 *               — em vez de martelar item a item, a fila inteira descansa e
 *               tenta de novo sozinha em 5 minutos.
 */
export type PauseReason = 'auth' | 'backoff' | null;

export interface ImportItem {
  id: string;
  url: string;
  status: ImportStatus;
  title?: string;
  error?: string;
  /** Failed attempts so far (for automatic retry with backoff). */
  attempts?: number;
  /** Don't retry this pending item before this epoch-ms (backoff window). */
  notBefore?: number;
}

/** How many links download at once. One at a time: each runs yt-dlp on the home
 *  server AND hits YouTube, and bursts trigger YouTube's "confirm you're not a
 *  bot" gate — serial + the importer's per-download sleeps stay under the radar. */
const CONCURRENCY = 1;
/** Auto-retry a failed download this many times (with backoff) before giving up. */
const MAX_ATTEMPTS = 5;

const STORAGE_KEY = 'aurial:import-queue';

let items: ImportItem[] = [];
let active = 0;
let seq = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

// ── Circuit breaker global ──────────────────────────────────────────────────
// Estado de pausa da fila INTEIRA (não por item). Enquanto pausada, pump() não
// inicia nada — zero requisições ao importer, zero 403 em loop no console.
let pausedFor: PauseReason = null;
/** Falhas transitórias seguidas (qualquer item); zera a cada sucesso. */
let consecutiveFailures = 0;
/** Timer da retomada automática da pausa por 'backoff' (5 min). */
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

/** Falhas seguidas (de qualquer tipo) antes da pausa geral com auto-retomada. */
const PAUSE_AFTER_FAILURES = 3;
/** Quanto tempo a pausa por 'backoff' dura antes de tentar de novo sozinha. */
const BACKOFF_PAUSE_MS = 5 * 60_000;

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
export function stats(): {
  pending: number;
  downloading: number;
  done: number;
  error: number;
  /** Motivo da pausa global (null = fila rodando normalmente). */
  pauseReason: PauseReason;
} {
  const s = { pending: 0, downloading: 0, done: 0, error: 0 };
  for (const it of items) s[it.status] += 1;
  return { ...s, pauseReason: pausedFor };
}

/** Motivo da pausa global — snapshot primitivo para useSyncExternalStore. */
export function pauseReason(): PauseReason {
  return pausedFor;
}

/** Forget finished/failed items (keeps anything still in flight). */
export function clearFinished(): void {
  items = items.filter((it) => it.status === 'pending' || it.status === 'downloading');
  emit();
}

// Bumped by cancelAll(); in-flight work from an older generation discards its
// result instead of re-inserting items into a queue the user just emptied.
let generation = 0;

/**
 * Cancel EVERYTHING (restart-the-queue button): pending, backing-off, failed
 * and finished items all go away. A download already in flight can't be
 * aborted mid-transfer, but its result is discarded — the queue is empty
 * immediately and stays empty.
 */
export function cancelAll(): void {
  generation += 1;
  items = [];
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  // Fila vazia → a pausa perdeu o objeto; limpa para a próxima fila nascer limpa.
  clearPause();
  emit();
}

/** Limpa o estado de pausa (sem emitir nem bombear — os chamadores decidem). */
function clearPause(): void {
  pausedFor = null;
  consecutiveFailures = 0;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

/**
 * Pausa a fila INTEIRA. Para 'auth' não há timer — só login (auto) ou o botão
 * "Retomar agora" religam; para 'backoff' um timer retoma sozinho em 5 min,
 * então a falha geral se resolve sem hammering nem ação do usuário.
 */
function pause(reason: Exclude<PauseReason, null>): void {
  if (pausedFor === reason) return;
  pausedFor = reason;
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = reason === 'backoff' ? setTimeout(resume, BACKOFF_PAUSE_MS) : null;
  emit();
}

/** Retoma a fila pausada (botão "Retomar agora", login, ou timer do backoff). */
export function resume(): void {
  if (!pausedFor) return;
  clearPause();
  emit();
  pump();
}

// Auto-retomada: pausa por 'auth' significa "espere o usuário entrar na conta".
// Assim que o Firebase reporta um usuário logado, a fila volta sozinha — sem
// isso o usuário teria de achar o botão manualmente depois de logar.
subscribeAuth((user) => {
  if (user && pausedFor === 'auth') resume();
});

/** Remove a single queued/failed item (not one actively downloading). */
export function remove(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.status === 'downloading') return;
  items = items.filter((i) => i.id !== id);
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

/** Manually retry a failed item now (fresh set of attempts). */
export function retry(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.status !== 'error') return;
  update(id, { status: 'pending', attempts: 0, notBefore: undefined, error: undefined });
  pump();
}

/** The next item ready to download (pending and past any backoff window). */
function nextReady(): ImportItem | undefined {
  const now = Date.now();
  return items.find((i) => i.status === 'pending' && (!i.notBefore || i.notBefore <= now));
}

/** Wake up pump() when the soonest backing-off item becomes eligible. */
function scheduleWake(): void {
  const now = Date.now();
  const waiting = items
    .filter((i) => i.status === 'pending' && i.notBefore && i.notBefore > now)
    .map((i) => i.notBefore as number);
  if (waiting.length === 0) return;
  const soonest = Math.min(...waiting);
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(pump, Math.max(0, soonest - now) + 50);
}

function pump(): void {
  // Circuit breaker: fila pausada não inicia NADA (nem agenda wake). Quem
  // religa é resume() — via botão, login ou o timer do backoff.
  if (pausedFor) return;
  while (active < CONCURRENCY) {
    const next = nextReady();
    if (!next) break;
    active += 1;
    update(next.id, { status: 'downloading' });
    void process(next).finally(() => {
      active -= 1;
      pump();
    });
  }
  scheduleWake(); // in case everything left is still backing off
}

// Load any queue saved from a previous session as soon as this module is used.
restore();

/** Resume the persisted queue on app boot (call once). */
export function init(): void {
  if (items.some((i) => i.status === 'pending')) pump();
}

async function process(item: ImportItem): Promise<void> {
  const gen = generation;
  try {
    // Already in the library (e.g. auto-download of a list) → nothing to fetch.
    const existing = localLibrary.findBySource(item.url);
    if (existing) {
      update(item.id, { status: 'done', title: existing.title });
      return;
    }
    if (isPlaylistUrl(item.url)) {
      // Expand the playlist into individual queued items so each downloads
      // independently (and a big list doesn't hold a slot the whole time).
      const { entries } = await fetchPlaylistEntries(item.url);
      if (gen !== generation) return; // fila cancelada no meio — descarta
      consecutiveFailures = 0; // sucesso fecha o circuito
      enqueue(entries.map((e) => e.url));
      update(item.id, { status: 'done', title: `Playlist · ${entries.length} faixas` });
      return;
    }
    const track = await localLibrary.addByUrl(item.url, { silent: true });
    if (gen !== generation) return; // fila cancelada — não re-insere estado
    consecutiveFailures = 0; // sucesso fecha o circuito
    update(item.id, { status: 'done', title: track.title });
  } catch (err) {
    if (gen !== generation) return; // fila cancelada — sem retry fantasma
    const message = err instanceof Error ? err.message : 'Falha ao baixar';
    // 401/403 do importer = problema de CONTA, não da faixa: retry por item
    // jamais resolve e só inunda o console de POSTs recusados. O item volta a
    // 'pending' SEM consumir attempts e a fila inteira pausa até o login.
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) {
      update(item.id, { status: 'pending', notBefore: undefined, error: message });
      pause('auth');
      return;
    }
    // 422/404 = defeito permanente DA FAIXA (vídeo removido/privado/não
    // suportado): re-tentar nunca resolve, e a falha não é do sistema — marca
    // erro definitivo, NÃO conta no breaker e a fila segue para a próxima.
    // (Sem isto, 3 vídeos mortos seguidos numa playlist grande pausavam tudo.)
    if (status === 422 || status === 404) {
      update(item.id, { status: 'error', attempts: MAX_ATTEMPTS, error: message });
      return;
    }
    consecutiveFailures += 1;
    const attempts = (item.attempts ?? 0) + 1;
    if (consecutiveFailures >= PAUSE_AFTER_FAILURES) {
      // Falha geral (importer fora do ar, rede caída…): pausa TUDO com
      // retomada automática em 5 min, em vez de queimar attempts item a item.
      update(item.id, {
        status: 'pending',
        attempts,
        notBefore: undefined,
        error: message,
      });
      pause('backoff');
      return;
    }
    if (attempts < MAX_ATTEMPTS) {
      // Auto-retry with backoff (10s, 20s, … capped) so a transient failure
      // (YouTube 403/throttle) fixes itself without the user tapping retry.
      update(item.id, {
        status: 'pending',
        attempts,
        notBefore: Date.now() + Math.min(120_000, 10_000 * attempts),
        error: `${message} — tentando de novo (${attempts}/${MAX_ATTEMPTS})`,
      });
    } else {
      update(item.id, { status: 'error', attempts, error: message });
    }
  }
}
