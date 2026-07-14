/**
 * Telemetria de uso — alimenta a página do admin (/telemetria). Cada usuário
 * logado mantém UM doc `telemetry/{uid}` no Firestore com:
 *   - tempo total com o app aberto (heartbeat só com a aba visível) e sessões;
 *   - velocidade REAL de rede (download/upload medidos contra o importer) e a
 *     estimativa do navegador (effectiveType/downlink/rtt);
 *   - o que mais ouve (top músicas/artistas do histórico local) e as últimas
 *     reproduções;
 *   - plataforma, tamanho da biblioteca e curtidas.
 * Tudo best-effort: sem Firestore/login, nada roda; falhas são silenciosas.
 * As regras do Firestore limitam a leitura aos admins (ver firestore.rules).
 */
import { doc, increment, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, subscribeAuth } from '@/lib/firebase';
import { measureNetworkSpeed } from '@/lib/local/importerHelper';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';

const HEARTBEAT_MS = 30_000;
const FLUSH_MS = 120_000;
const SPEED_DELAY_MS = 20_000;

export interface TopEntry {
  name: string;
  plays: number;
}
export interface RecentPlay {
  title: string;
  artist: string;
  at: string;
}

let currentUser: User | null = null;
let pendingSeconds = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let flusher: ReturnType<typeof setInterval> | null = null;
let speedTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function connectionInfo(): Record<string, string | number> {
  const conn = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    }
  ).connection;
  if (!conn) return {};
  return {
    ...(conn.effectiveType ? { effectiveType: conn.effectiveType } : {}),
    ...(typeof conn.downlink === 'number' ? { downlinkMbps: conn.downlink } : {}),
    ...(typeof conn.rtt === 'number' ? { rttMs: conn.rtt } : {}),
  };
}

function platformInfo(): string {
  const ua = navigator.userAgent;
  if (/iP(hone|od)/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'iPad';
  }
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Outro';
}

/** Top músicas/artistas + últimas reproduções, tudo do histórico local. */
function listeningStats(): {
  topTracks: TopEntry[];
  topArtists: TopEntry[];
  recentPlays: RecentPlay[];
} {
  const history = localHistory.list();
  const byTrack = new Map<string, TopEntry>();
  const byArtist = new Map<string, TopEntry>();
  const recentPlays: RecentPlay[] = [];
  for (const h of history) {
    const artist = h.track.artists[0]?.name ?? 'Desconhecido';
    const trackKey = `${h.track.title} — ${artist}`;
    const t = byTrack.get(trackKey) ?? { name: trackKey, plays: 0 };
    t.plays += 1;
    byTrack.set(trackKey, t);
    for (const a of h.track.artists) {
      if (!a.name || a.name === 'Desconhecido') continue;
      const entry = byArtist.get(a.name) ?? { name: a.name, plays: 0 };
      entry.plays += 1;
      byArtist.set(a.name, entry);
    }
    if (recentPlays.length < 50) {
      recentPlays.push({ title: h.track.title, artist, at: h.playedAt });
    }
  }
  const top = (m: Map<string, TopEntry>): TopEntry[] =>
    [...m.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
  return { topTracks: top(byTrack), topArtists: top(byArtist), recentPlays };
}

/** Merge a partial update into the user's telemetry doc (best-effort). */
async function push(data: Record<string, unknown>): Promise<void> {
  if (!db || !currentUser) return;
  try {
    await setDoc(doc(db, 'telemetry', currentUser.uid), data, { merge: true });
  } catch {
    /* offline / rules not published yet — silent */
  }
}

function snapshot(): Record<string, unknown> {
  const stats = listeningStats();
  return {
    uid: currentUser?.uid ?? null,
    email: currentUser?.email ?? null,
    displayName: currentUser?.displayName ?? null,
    platform: platformInfo(),
    lastSeenAt: new Date().toISOString(),
    connection: connectionInfo(),
    libraryCount: localLibrary.list().length,
    likedCount: localLikes.count(),
    ...stats,
  };
}

function flush(): void {
  if (!currentUser) return;
  const seconds = pendingSeconds;
  pendingSeconds = 0;
  void push({
    ...snapshot(),
    ...(seconds > 0 ? { totalSeconds: increment(seconds) } : {}),
  });
}

function onVisibility(): void {
  if (document.hidden) flush(); // best-effort final write when leaving
}

function start(user: User): void {
  currentUser = user;
  pendingSeconds = 0;
  void push({ ...snapshot(), sessions: increment(1) });

  heartbeat ??= setInterval(() => {
    if (!document.hidden) pendingSeconds += HEARTBEAT_MS / 1000;
  }, HEARTBEAT_MS);
  flusher ??= setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', onVisibility);

  // Real speed probe, once per session, after boot settles (online only).
  speedTimer = setTimeout(() => {
    if (!navigator.onLine) return;
    void measureNetworkSpeed().then(({ downMbps, upMbps }) => {
      if (downMbps === null && upMbps === null) return;
      void push({
        netDownMbps: downMbps,
        netUpMbps: upMbps,
        netMeasuredAt: new Date().toISOString(),
      });
    });
  }, SPEED_DELAY_MS);
}

function stop(): void {
  flush();
  currentUser = null;
  if (heartbeat) clearInterval(heartbeat);
  if (flusher) clearInterval(flusher);
  if (speedTimer) clearTimeout(speedTimer);
  heartbeat = null;
  flusher = null;
  speedTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}

/** Boot telemetry once (App). Follows auth: starts on sign-in, stops on out. */
export function initTelemetry(): void {
  if (initialized || typeof window === 'undefined' || !db) return;
  initialized = true;
  subscribeAuth((user) => {
    stop();
    if (user) start(user);
  });
}
