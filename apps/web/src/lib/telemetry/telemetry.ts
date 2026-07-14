/**
 * Telemetria de uso — alimenta a página do admin (/telemetria). Cada usuário
 * logado mantém UM doc `telemetry/{uid}` no Firestore com:
 *   - tempo total com o app aberto (heartbeat só com a aba visível) e sessões;
 *   - velocidade REAL de rede (download/upload medidos contra o importer) e a
 *     estimativa do navegador (effectiveType/downlink/rtt);
 *   - o que mais ouve (top músicas/artistas do histórico local) e as últimas
 *     reproduções;
 *   - plataforma, GPU, memória JS, Web Vitals, configurações do app, tamanho
 *     da biblioteca, downloads offline e curtidas.
 * Tudo best-effort: sem Firestore/login, nada roda; falhas são silenciosas.
 * As regras do Firestore limitam a leitura aos admins (ver firestore.rules).
 */
import { doc, increment, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getDownloads } from '@/features/downloads/registry';
import { deviceLabel, getDeviceId } from '@/lib/devices/presence';
import { db, subscribeAuth } from '@/lib/firebase';
import { measureNetworkSpeed } from '@/lib/local/importerHelper';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import { useSettingsStore } from '@/stores/settingsStore';
import { getVitals, initVitals } from './vitals';

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
/** One of the first user actions after opening the app (session timeline). */
export interface SessionAction {
  /** Milliseconds after the session started. */
  atMs: number;
  type: 'nav' | 'click';
  label: string;
}

let currentUser: User | null = null;
let pendingSeconds = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let flusher: ReturnType<typeof setInterval> | null = null;
let speedTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

// ── page time / clicks / session-start timeline ─────────────────
let currentPage = 'inicio';
let sessionStartMs = 0;
const pendingPageSeconds = new Map<string, number>();
const pendingClicks = new Map<string, number>();
let sessionActions: SessionAction[] = [];
let pendingErrors = 0;
let lastError = '';

// Firestore field names can't carry dots, tildes, asterisks, slashes or
// brackets — strip them and keep keys short.
function sanitizeKey(raw: string): string {
  return raw
    .replace(/[.~*/[\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Coarse page bucket from a pathname ("/playlist/abc" → "playlist"). */
function pageKey(pathname: string): string {
  const seg = pathname.split('/')[1] ?? '';
  return sanitizeKey(seg || 'inicio') || 'inicio';
}

/** Chamado pelo AppShell a cada navegação — alimenta tempo-por-página e a
 *  linha do tempo do começo da sessão ("o que faz ao abrir o app"). */
export function recordNavigation(pathname: string): void {
  currentPage = pageKey(pathname);
  if (sessionActions.length < 14) {
    sessionActions.push({
      atMs: sessionStartMs ? Date.now() - sessionStartMs : 0,
      type: 'nav',
      label: currentPage,
    });
  }
}

function onDocumentClick(event: MouseEvent): void {
  const el = (event.target as HTMLElement | null)?.closest?.(
    'button, a, [role="button"], [role="tab"]',
  );
  if (!el) return;
  const label = sanitizeKey(
    el.getAttribute('aria-label') ||
      el.textContent?.trim().slice(0, 40) ||
      el.tagName.toLowerCase(),
  );
  if (!label) return;
  pendingClicks.set(label, (pendingClicks.get(label) ?? 0) + 1);
  if (sessionActions.length < 14) {
    sessionActions.push({
      atMs: sessionStartMs ? Date.now() - sessionStartMs : 0,
      type: 'click',
      label,
    });
  }
}

function onWindowError(event: ErrorEvent): void {
  pendingErrors += 1;
  lastError = sanitizeKey(String(event.message ?? 'erro')).slice(0, 120);
}

// ── uso por hora do dia / dia da semana + registro de sessões ───────────────
const pendingHourSeconds = new Map<number, number>();
const pendingWeekdaySeconds = new Map<number, number>();

export interface SessionLogEntry {
  startedAt: string;
  durationSec: number;
}

const SESSIONS_KEY = 'aurial:telemetrySessions';

function readSessionLog(): SessionLogEntry[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SessionLogEntry[]).slice(-15) : [];
  } catch {
    return [];
  }
}

function writeSessionLog(log: SessionLogEntry[]): void {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(log.slice(-15)));
  } catch {
    /* quota */
  }
}

/** Marca a duração atual na última sessão do registro e devolve o log. */
function updateSessionLog(): SessionLogEntry[] {
  const log = readSessionLog();
  const last = log[log.length - 1];
  if (last && sessionStartMs) {
    last.durationSec = Math.round((Date.now() - sessionStartMs) / 1000);
    writeSessionLog(log);
  }
  return log;
}

// ── fabricante/modelo do aparelho (async, cacheado) ─────────────────────────
// Android (Chrome): UA Client Hints entrega o modelo real ("moto g34 5G").
// Desktop: SO + versão real (Windows 11 via platformVersion) + arquitetura.
// iOS: a Apple NÃO expõe o modelo (todos os iPhones têm o mesmo UA) — melhor
// esforço honesto: o chip via string da GPU ("Apple A15 GPU") quando existe.
let deviceModelCache: string | null = null;

function probeDeviceModel(): void {
  void (async () => {
    try {
      const uaData = (
        navigator as Navigator & {
          userAgentData?: {
            getHighEntropyValues: (hints: string[]) => Promise<{
              model?: string;
              platform?: string;
              platformVersion?: string;
              architecture?: string;
            }>;
          };
        }
      ).userAgentData;
      if (uaData?.getHighEntropyValues) {
        const info = await uaData.getHighEntropyValues([
          'model',
          'platform',
          'platformVersion',
          'architecture',
        ]);
        if (info.model?.trim()) {
          deviceModelCache = info.model.trim(); // Android: modelo real
          return;
        }
        if (info.platform) {
          // Desktop: "Windows 11 · x64" (Windows 11 = platformVersion >= 13).
          const major = Number((info.platformVersion ?? '').split('.')[0]);
          const os =
            info.platform === 'Windows' && Number.isFinite(major)
              ? `Windows ${major >= 13 ? 11 : 10}`
              : info.platform;
          deviceModelCache = [os, info.architecture].filter(Boolean).join(' · ');
          return;
        }
      }
      // Fallback sem Client Hints: modelo Android direto do UA.
      const androidModel = /Android [\d.]+; ([^;)]+)[;)]/.exec(navigator.userAgent)?.[1]?.trim();
      if (androidModel && androidModel !== 'K') {
        deviceModelCache = androidModel;
        return;
      }
      // iOS: chip via GPU quando a string nomeia ("Apple A15 GPU").
      if (/iP(hone|od|ad)/.test(navigator.userAgent)) {
        deviceModelCache = 'Modelo não exposto pelo iOS';
      }
    } catch {
      /* fica null */
    }
  })();
}

// Battery info is async — probed once, cached for snapshots.
let batteryInfo: { level: number; charging: boolean } | null = null;
function probeBattery(): void {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  void nav
    .getBattery?.()
    .then((b) => {
      batteryInfo = { level: Math.round(b.level * 100), charging: b.charging };
    })
    .catch(() => undefined);
}

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

// GPU via WebGL — coletada uma vez por carga da página e cacheada no módulo.
// undefined = ainda não tentou; null = tentou e não conseguiu.
let gpuRenderer: string | null | undefined;
function gpuInfo(): string | null {
  if (gpuRenderer !== undefined) return gpuRenderer;
  gpuRenderer = null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) {
      const raw: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof raw === 'string' && raw) {
        // "ANGLE (vendor, renderer, backend)" → mantém só o miolo legível.
        const cleaned = raw.startsWith('ANGLE (') ? raw.slice(7).replace(/\)\s*$/, '') : raw;
        gpuRenderer = cleaned.trim().slice(0, 120) || null;
      }
    }
  } catch {
    gpuRenderer = null;
  }
  return gpuRenderer;
}

/** Heap JS usado em MB (só Chrome expõe performance.memory). */
function jsHeapMb(): number | null {
  try {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    if (typeof mem?.usedJSHeapSize === 'number') return Math.round(mem.usedJSHeapSize / 1e6);
  } catch {
    /* sem suporte */
  }
  return null;
}

/** Recorte das configurações do app que interessam ao painel. */
function settingsSnapshot(): Record<string, unknown> | null {
  try {
    const s = useSettingsStore.getState();
    return {
      audioQuality: s.audioQuality,
      crossfadeSeconds: s.crossfadeSeconds,
      eqEnabled: s.eq.enabled,
      normalizeVolume: s.normalizeVolume,
      theme: s.theme,
    };
  } catch {
    return null;
  }
}

/** Data de criação da conta Firebase em ISO, ou null se indisponível. */
function accountCreatedAt(): string | null {
  try {
    const raw = currentUser?.metadata?.creationTime;
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

/** Quantidade de downloads offline registrados neste aparelho. */
function downloadsCount(): number | null {
  try {
    return getDownloads().length;
  } catch {
    return null;
  }
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

function browserInfo(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Outro';
}

function timezoneInfo(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** Top músicas/artistas + últimas reproduções, tudo do histórico local. */
function listeningStats(): {
  topTracks: TopEntry[];
  topArtists: TopEntry[];
  recentPlays: RecentPlay[];
} {
  // SÓ as reproduções carimbadas com o uid DESTA conta — o histórico local é
  // do aparelho (compartilhado entre contas); entradas antigas sem uid contam
  // apenas nos números por-aparelho, nunca no perfil da conta.
  const history = localHistory.list().filter((h) => h.uid === currentUser?.uid);
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
  // Coletas best-effort: indisponível = campo ausente (nunca inventado).
  const gpu = gpuInfo();
  const heapMb = jsHeapMb();
  const vitals = getVitals();
  const settings = settingsSnapshot();
  const createdAt = accountCreatedAt();
  const downloads = downloadsCount();
  return {
    uid: currentUser?.uid ?? null,
    email: currentUser?.email ?? null,
    displayName: currentUser?.displayName ?? null,
    isAnonymous: currentUser?.isAnonymous ?? false,
    platform: platformInfo(),
    browser: browserInfo(),
    ...(deviceModelCache ? { deviceModel: deviceModelCache } : {}),
    language: navigator.language ?? null,
    timezone: timezoneInfo() || null,
    screen: `${window.screen.width}×${window.screen.height}`,
    pwaInstalled: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    cpuCores: navigator.hardwareConcurrency ?? null,
    touchDevice: (navigator.maxTouchPoints ?? 0) > 0,
    prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? null,
    battery: batteryInfo,
    lastSeenAt: new Date().toISOString(),
    connection: connectionInfo(),
    online: navigator.onLine,
    libraryCount: localLibrary.list().length,
    libraryBytes: localLibrary.totalBytes(),
    likedCount: localLikes.count(),
    // Plays DA CONTA (carimbados com o uid dela) — o total bruto do aparelho
    // fica em devices.{deviceId}.plays.
    totalPlays: localHistory.list().filter((h) => h.uid === currentUser?.uid).length,
    ...(gpu ? { gpu } : {}),
    ...(heapMb !== null ? { jsHeapMb: heapMb } : {}),
    ...(Object.keys(vitals).length > 0 ? { vitals } : {}),
    ...(settings ? { settingsSnapshot: settings } : {}),
    ...(createdAt ? { accountCreatedAt: createdAt } : {}),
    ...(downloads !== null ? { downloadsCount: downloads } : {}),
    ...stats,
  };
}

function flush(): void {
  if (!currentUser) return;
  const seconds = pendingSeconds;
  pendingSeconds = 0;

  // Tempo por página (acumulado no heartbeat com a aba visível).
  const pageSeconds: Record<string, unknown> = {};
  for (const [page, s] of pendingPageSeconds) pageSeconds[page] = increment(s);
  pendingPageSeconds.clear();

  // Onde clica: os 20 rótulos mais clicados desde o último flush.
  const clicks = [...pendingClicks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const clickCounts: Record<string, unknown> = {};
  let clickTotal = 0;
  for (const [label, n] of clicks) {
    clickCounts[label] = increment(n);
    clickTotal += n;
  }
  pendingClicks.clear();

  const errors = pendingErrors;
  pendingErrors = 0;

  // Histogramas de uso (hora do dia / dia da semana), em segundos.
  const hourHistogram: Record<string, unknown> = {};
  for (const [h, s] of pendingHourSeconds) hourHistogram[`h${h}`] = increment(s);
  pendingHourSeconds.clear();
  const weekdayHistogram: Record<string, unknown> = {};
  for (const [d, s] of pendingWeekdaySeconds) weekdayHistogram[`d${d}`] = increment(s);
  pendingWeekdaySeconds.clear();

  // IMPORTANTE: plays/biblioteca/histórico vêm do armazenamento LOCAL do
  // aparelho — que é compartilhado entre contas no mesmo navegador. Sem esta
  // divisão por aparelho, uma conta que logasse num navegador "usado" herdava
  // no doc os números acumulados por outra conta (foi o que confundiu o
  // painel). Cada aparelho reporta seus números sob devices.{deviceId}.
  const deviceStats = {
    [getDeviceId()]: {
      name: deviceLabel(),
      lastSeenAt: new Date().toISOString(),
      ...(seconds > 0 ? { seconds: increment(seconds) } : {}),
      plays: localHistory.list().length,
      libraryCount: localLibrary.list().length,
    },
  };

  void push({
    ...snapshot(),
    devices: deviceStats,
    ...(seconds > 0 ? { totalSeconds: increment(seconds) } : {}),
    ...(Object.keys(pageSeconds).length > 0 ? { pageSeconds } : {}),
    ...(Object.keys(clickCounts).length > 0
      ? { clickCounts, totalClicks: increment(clickTotal) }
      : {}),
    ...(Object.keys(hourHistogram).length > 0 ? { hourHistogram } : {}),
    ...(Object.keys(weekdayHistogram).length > 0 ? { weekdayHistogram } : {}),
    ...(errors > 0 ? { jsErrors: increment(errors), lastError } : {}),
    // Linha do tempo do começo da sessão (sobrescrita a cada sessão).
    ...(sessionActions.length > 0 ? { lastSessionActions: sessionActions.slice(0, 14) } : {}),
    // Últimas entradas no app (deste aparelho), com duração de cada uma.
    recentSessions: updateSessionLog(),
  });
}

function onVisibility(): void {
  if (document.hidden) flush(); // best-effort final write when leaving
}

function start(user: User): void {
  currentUser = user;
  pendingSeconds = 0;
  sessionStartMs = Date.now();
  sessionActions = [];
  probeBattery();
  probeDeviceModel();
  initVitals(); // idempotente — liga os observadores de Web Vitals uma vez
  // Registra ESTA entrada no app no log local (vira `recentSessions` no doc).
  writeSessionLog([...readSessionLog(), { startedAt: new Date().toISOString(), durationSec: 0 }]);
  void push({ ...snapshot(), sessions: increment(1), recentSessions: readSessionLog() });

  heartbeat ??= setInterval(() => {
    if (document.hidden) return;
    const s = HEARTBEAT_MS / 1000;
    pendingSeconds += s;
    pendingPageSeconds.set(currentPage, (pendingPageSeconds.get(currentPage) ?? 0) + s);
    // Uso por hora do dia / dia da semana — "que horas mais usa o app".
    const now = new Date();
    pendingHourSeconds.set(now.getHours(), (pendingHourSeconds.get(now.getHours()) ?? 0) + s);
    pendingWeekdaySeconds.set(now.getDay(), (pendingWeekdaySeconds.get(now.getDay()) ?? 0) + s);
  }, HEARTBEAT_MS);
  flusher ??= setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('click', onDocumentClick, { capture: true, passive: true });
  window.addEventListener('error', onWindowError);

  // Real speed probe, once per session, after boot settles (online only).
  // Carries the full snapshot too — every write self-heals missing fields.
  speedTimer = setTimeout(() => {
    if (!navigator.onLine) return;
    void measureNetworkSpeed().then(({ downMbps, upMbps }) => {
      if (downMbps === null && upMbps === null) return;
      void push({
        ...snapshot(),
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
  document.removeEventListener('click', onDocumentClick, { capture: true });
  window.removeEventListener('error', onWindowError);
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
