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
  /**
   * Defeito DA FAIXA (vídeo removido/privado/não suportado): re-tentar nunca
   * resolve. Marcado assim, o item fica fora da recuperação automática — sem
   * isso a fila tentaria para sempre um link que jamais vai funcionar.
   */
  permanent?: boolean;
  /** Rodadas de recuperação automática já gastas (teto: MAX_RECOVERIES). */
  recoveries?: number;
}

/** Downloads simultâneos. 3 por padrão (com o fluxo por job o cliente só
 *  acompanha — o peso fica no servidor, que baixa da rede em paralelo); se o
 *  YouTube pedir verificação ("not a bot"), recua sozinho para 1 por 10
 *  minutos e depois volta — velocidade sem tomar bloqueio. */
const FAST_CONCURRENCY = 3;
let concurrency = FAST_CONCURRENCY;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

/** YouTube reclamou de volume: modo devagar por 10 min, depois acelera de novo. */
function slowDown(): void {
  concurrency = 1;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    concurrency = FAST_CONCURRENCY;
    cooldownTimer = null;
    pump();
  }, 10 * 60_000);
}
/** Auto-retry a failed download this many times (with backoff) before giving up. */
const MAX_ATTEMPTS = 5;

/**
 * Esgotar as tentativas NÃO é o fim da linha. A causa quase sempre é
 * temporária (YouTube pedindo verificação, importer reiniciando, rede do
 * celular oscilando) e some sozinha em poucos minutos — deixar o item parado
 * em vermelho até alguém tocar nele é desistir cedo demais. Passado este
 * tempo, o item volta para a fila com tentativas zeradas.
 */
const ERROR_RECOVERY_MS = 3 * 60_000;
/**
 * Quantas RODADAS de recuperação um item ganha antes de virar erro definitivo.
 * Sem teto, um link que falha por um motivo que nunca vai mudar ficaria
 * eternamente entrando e saindo da fila, gastando rede e poluindo a lista.
 */
const MAX_RECOVERIES = 3;

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

/**
 * Tentar AGORA, manualmente. Vale tanto para o erro terminal quanto para o
 * item que está só esperando a janela de backoff: em ambos os casos o usuário
 * quer furar a espera, não descobrir que o botão não faz nada.
 */
export function retry(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.status === 'downloading' || item.status === 'done') return;
  update(id, {
    status: 'pending',
    attempts: 0,
    notBefore: undefined,
    error: undefined,
    // Pedido explícito zera o teto de recuperação: se a pessoa insiste, ela
    // sabe de algo que nós não sabemos (religou o Wi-Fi, subiu o importer).
    recoveries: 0,
    permanent: false,
  });
  // Uma tentativa manual também vale como "pode voltar a tentar tudo".
  if (pausedFor === 'backoff') resume();
  else pump();
}

/** Tentar de novo TODOS os que falharam (botão único no painel da fila). */
export function retryAllFailed(): void {
  const failed = items.filter((i) => i.status === 'error');
  if (failed.length === 0) return;
  items = items.map((it) =>
    it.status === 'error'
      ? {
          ...it,
          status: 'pending' as const,
          attempts: 0,
          notBefore: undefined,
          error: undefined,
          recoveries: 0,
          permanent: false,
        }
      : it,
  );
  emit();
  if (pausedFor === 'backoff') resume();
  else pump();
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
    // Inclui os 'error' à espera de recuperação — senão eles só voltariam
    // quando algo ALHEIO acordasse a fila, e numa fila parada isso é nunca.
    .filter(
      (i) =>
        (i.status === 'pending' || (i.status === 'error' && !i.permanent)) &&
        i.notBefore &&
        i.notBefore > now,
    )
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
  reviveErrors(); // erros com tempo cumprido voltam para a fila sozinhos
  while (active < concurrency) {
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
      update(item.id, {
        status: 'error',
        attempts: MAX_ATTEMPTS,
        permanent: true, // fora da recuperação automática: nunca vai funcionar
        error: message,
      });
      return;
    }
    // YouTube pediu verificação de volume → modo devagar (1 por vez) por 10min.
    if (message.includes('pediu verificação')) slowDown();
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
      // Tentativas esgotadas: vira erro VISÍVEL, mas com hora marcada para
      // voltar sozinho — a causa costuma evaporar em minutos.
      const recoveries = item.recoveries ?? 0;
      const willRecover = recoveries < MAX_RECOVERIES;
      update(item.id, {
        status: 'error',
        attempts,
        error: willRecover ? `${message} — nova tentativa em instantes` : message,
        notBefore: willRecover ? Date.now() + ERROR_RECOVERY_MS : undefined,
      });
    }
  }
}

/**
 * Ressuscita erros cujo tempo de espera passou. Chamado no pump(), então a
 * recuperação acontece junto do fluxo normal da fila — sem timer paralelo.
 */
function reviveErrors(): void {
  const now = Date.now();
  let changed = false;
  items = items.map((it) => {
    if (it.status !== 'error' || it.permanent) return it;
    if (!it.notBefore || it.notBefore > now) return it;
    changed = true;
    return {
      ...it,
      status: 'pending' as const,
      attempts: 0,
      notBefore: undefined,
      recoveries: (it.recoveries ?? 0) + 1,
      error: undefined,
    };
  });
  if (changed) emit();
}
