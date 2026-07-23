/**
 * playerStore — global playback state (ARCHITECTURE.md §10).
 *
 * The store is the only consumer of AudioEngine events; components never talk
 * to the engine directly (except read-only visualizer access to `analyser`).
 * Bootstrap once with `initPlayerEngine()` from App.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaySource, RecordPlayInput, RepeatMode, TrackDto } from '@aurial/shared';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { initMediaSession } from '@/lib/audio/mediaSession';
import { api } from '@/lib/api';
import { subscribeAuth } from '@/lib/firebase';
import * as localHistory from '@/lib/local/localHistory';
import { clamp } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { hydrateDownloads, localAudioUrl } from '@/features/downloads/downloadManager';
import {
  ensureLocalAudioUrl,
  hasLocalAudio,
  hydrate as hydrateLocalLibrary,
  localAudioUrl as localLibraryAudioUrl,
  remoteUrlFor,
  reportDeadRemote,
  sourceUrlFor,
} from '@/lib/local/localLibrary';
import { buildStreamUrl, importerHostLabel } from '@/lib/local/importerHelper';
import { nextAudiusHost } from '@/lib/catalog/audius';
import { streamUrlFor } from '@/lib/catalog/map';

/** Origem (scheme+host) de uma URL, para saber quais nós já falharam. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Ensure a track has a playable source. Local-library tracks store their audio
 * only on the device that imported them; on any OTHER device (metadata synced,
 * audio absent) we resolve a stream: the uploaded copy on the importer if it
 * exists, else a live stream from the original link (YouTube/SoundCloud/…) or
 * the direct file URL. Returns the track augmented with a `streamUrl`, or the
 * track unchanged when nothing can be resolved (genuinely unavailable).
 */
async function ensurePlayableSource(track: TrackDto): Promise<TrackDto> {
  // `hasLocalAudio` responde sem abrir o arquivo. Vale checar aqui também:
  // uma faixa com áudio no aparelho JAMAIS pode acabar buscando a rede só
  // porque o object URL ainda não tinha sido criado.
  if (hasLocalAudio(track.id)) {
    await ensureLocalAudioUrl(track.id);
    return track;
  }
  if (localLibraryAudioUrl(track.id) || localAudioUrl(track.id) || track.streamUrl) return track;
  if (!track.id.startsWith('local:')) return track;
  // OFFLINE: nunca sai atrás de rede — sem áudio local, a faixa é indisponível.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return track;
  const remote = remoteUrlFor(track.id);
  if (remote) return { ...track, streamUrl: remote };
  const sourceUrl = sourceUrlFor(track.id);
  if (!sourceUrl) return track;
  try {
    const host = new URL(sourceUrl).hostname;
    if (importerHostLabel(host)) {
      const streamUrl = await buildStreamUrl(sourceUrl);
      return streamUrl ? { ...track, streamUrl } : track;
    }
    return { ...track, streamUrl: sourceUrl }; // direct-file import
  } catch {
    return track;
  }
}

/**
 * Próxima fonte para uma faixa local cuja fonte ATUAL morreu — o cofre de blobs
 * pode ter evictado a cópia (LRU), estar fora do ar, ou a URL de /stream trazer
 * um token Firebase expirado (gravado na fila/retomada de uma sessão anterior).
 * Tenta, nesta ordem, o que ainda não foi tentado nesta carga: a cópia enviada
 * (remoteUrl) → stream ao vivo da fonte com token NOVO → o link direto.
 * Devolve a faixa com a nova fonte, ou null quando não há mais o que tentar.
 */
async function resolveNextSource(track: TrackDto, tried: Set<string>): Promise<TrackDto | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  // Faixa de catálogo: a streamUrl foi gravada com o nó de descoberta da vez.
  // Se ESSE nó caiu, todas as faixas parecem mortas — rotaciona para outro nó
  // e reescreve a URL em vez de declarar a faixa indisponível.
  if (track.id.startsWith('audius:')) {
    const audiusId = track.id.slice('audius:'.length);
    const triedHosts = [...tried].map(hostOf).filter((h): h is string => h !== null);
    for (let i = 0; i < 2; i++) {
      const host = await nextAudiusHost(triedHosts);
      if (!host) return null;
      const url = streamUrlFor(audiusId, host);
      if (!tried.has(url)) return { ...track, streamUrl: url, downloadUrl: url };
      triedHosts.push(host);
    }
    return null;
  }
  if (!track.id.startsWith('local:')) return null;
  const remote = remoteUrlFor(track.id);
  if (remote && !tried.has(remote)) return { ...track, streamUrl: remote };
  const sourceUrl = sourceUrlFor(track.id);
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname;
    if (importerHostLabel(host)) {
      const streamUrl = await buildStreamUrl(sourceUrl); // token sempre fresco
      return streamUrl && !tried.has(streamUrl) ? { ...track, streamUrl } : null;
    }
    return tried.has(sourceUrl) ? null : { ...track, streamUrl: sourceUrl };
  } catch {
    return null;
  }
}

export interface PlayContext {
  source: PlaySource;
  sourceId?: string;
}

export interface PlayerState {
  currentTrack: TrackDto | null;
  queue: TrackDto[];
  queueIndex: number;
  /** Pre-shuffle order, restored when shuffle turns off. */
  originalQueue: TrackDto[];
  isPlaying: boolean;
  /** Seconds. */
  progress: number;
  /** Seconds. */
  duration: number;
  /** Seconds buffered past the playhead (seek-bar underlay). */
  buffered: number;
  /** 0..1 — persisted. */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  playbackRate: number;
  isBuffering: boolean;
  context: PlayContext | null;

  playTrack: (track: TrackDto, context?: PlayContext) => void;
  playQueue: (tracks: TrackDto[], startIndex?: number, context?: PlayContext) => void;
  /** Jump to a queue position (QueuePanel click). */
  playAt: (index: number) => void;
  next: () => void;
  prev: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (tracks: TrackDto | TrackDto[]) => void;
  playNext: (tracks: TrackDto | TrackDto[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  /** Replace everything after the current track (drag-reorder in QueuePanel). */
  setUpNext: (tracks: TrackDto[]) => void;
  clearQueue: () => void;
  setRate: (rate: number) => void;
}

/**
 * Seam for the features layer: called after a play is recorded
 * (analytics, history invalidation…). The API POST itself stays here.
 */
let onPlayRecorded: ((input: RecordPlayInput) => void) | null = null;
export function setOnPlayRecorded(callback: ((input: RecordPlayInput) => void) | null): void {
  onPlayRecorded = callback;
}

// Local caches (library Cache Storage + downloads IndexedDB) rebuilt — await
// before choosing a playback source so local audio always wins over network.
// Cada hydrate é blindado: se um deles rejeitar (Cache Storage indisponível,
// IndexedDB bloqueado), a promise memoizada NÃO pode ficar rejeitada para
// sempre — todo load aguarda por ela, e uma rejeição eterna mataria TODA a
// reprodução em silêncio.
let localAudioReadyPromise: Promise<unknown> | null = null;
function localAudioReady(): Promise<unknown> {
  return (localAudioReadyPromise ??= Promise.all([
    hydrateLocalLibrary().catch(() => undefined),
    hydrateDownloads().catch(() => undefined),
  ]));
}

// Per-loaded-track flags (reset on every load).
let playRecorded = false;
let preloadRequested = false;
let crossfadeTriggered = false;
let lastProgressCommit = 0;
let syntheticEndHandledTrackId: string | null = null;

// ── fonte morta não mata a faixa ─────────────────────────────────
// URLs já tentadas na carga ATUAL (a primeira falha entra aqui) + quantas
// alternativas já foram atrás. Zerado a cada troca de faixa (loadIndex).
let fallbackTried = new Set<string>();
let fallbackAttempts = 0;
const MAX_FALLBACK_ATTEMPTS = 3;

// Carregamento pendurado (ex.: /stream ao vivo que nunca emite bytes) não gera
// evento de erro nenhum — sem watchdog a faixa fica "carregando" para sempre.
const LOAD_WATCHDOG_MS = 30_000;
// Depois que a faixa JÁ tocou, checagens mais curtas detectam travamento no
// meio (o elemento emite 'waiting' e nunca mais volta) — antes disso o player
// ficava eternamente no spinner sem nenhum erro.
const STALL_CHECK_MS = 10_000;
let loadWatchdog: ReturnType<typeof setTimeout> | null = null;
let lastWatchdogPos = -1;
let stallStrikes = 0;

function clearLoadWatchdog(): void {
  if (loadWatchdog !== null) clearTimeout(loadWatchdog);
  loadWatchdog = null;
  lastWatchdogPos = -1;
  stallStrikes = 0;
}

// Uma faixa morta no meio da fila NÃO pode parar a música (Spotify pula e
// segue). Zerado quando uma faixa carrega; 3 mortes seguidas = para honesto
// (provável problema geral: sem rede, servidor fora…), não um loop de pulos.
let consecutiveDeadTracks = 0;
const MAX_DEAD_TRACK_SKIPS = 3;

/**
 * Fim da linha para a faixa ATUAL (todas as fontes falharam): se a fila tem
 * próxima e estávamos tocando, avisa e PULA para ela em vez de parar tudo.
 */
function failCurrentTrack(message: string): void {
  const s = usePlayerStore.getState();
  consecutiveDeadTracks++;
  const hasNext = s.queueIndex + 1 < s.queue.length || (s.repeat === 'all' && s.queue.length > 1);
  if (s.isPlaying && hasNext && consecutiveDeadTracks <= MAX_DEAD_TRACK_SKIPS) {
    const title = s.currentTrack?.title ?? 'faixa';
    void import('sonner').then(({ toast }) => toast(`"${title}" indisponível — pulando.`));
    s.next();
    return;
  }
  usePlayerStore.setState({ isPlaying: false, isBuffering: false });
  void import('sonner').then(({ toast }) => toast.error(message));
}

// ── retomar de onde parou (Spotify-like) ────────────────────────
// Ao reabrir o app, a ÚLTIMA faixa volta pausada na posição exata.
// Persistência leve: só {faixa, segundos} — nunca a fila inteira (stringify
// de fila grande já congelou o app uma vez).
const RESUME_KEY = 'aurial:resume';
let lastResumeSave = 0;
/** Posição a buscar assim que o engine carregar a faixa restaurada. */
let pendingResumeSeek: number | null = null;

function saveResume(force = false): void {
  const s = usePlayerStore.getState();
  if (!s.currentTrack || s.progress <= 0) return;
  const now = Date.now();
  if (!force && now - lastResumeSave < 5_000) return; // no máx. 1 escrita / 5s
  lastResumeSave = now;
  try {
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ track: s.currentTrack, progress: Math.floor(s.progress) }),
    );
  } catch {
    /* quota */
  }
}

function readResume(): { track: TrackDto; progress: number } | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? 'null');
    const saved = parsed as { track?: TrackDto; progress?: number } | null;
    return saved?.track ? { track: saved.track, progress: saved.progress ?? 0 } : null;
  } catch {
    return null;
  }
}

// ── prévia de 30s para visitantes ────────────────────────────────
// Sem login, cada faixa toca só PREVIEW_SECONDS; ao bater o limite o player
// pausa e convida a criar conta (uma vez por faixa carregada).
const PREVIEW_SECONDS = 30;
let signedIn = false;
let previewGateFired = false;
subscribeAuth((user) => {
  signedIn = user !== null;
});

function firePreviewGate(): void {
  if (previewGateFired) return;
  previewGateFired = true;
  audioEngine.pause();
  usePlayerStore.setState({ isPlaying: false });
  void import('sonner').then(({ toast }) =>
    toast('Crie sua conta para ouvir a música completa', {
      description: 'De graça — sua biblioteca sincroniza em todos os aparelhos.',
      action: {
        label: 'Criar conta',
        onClick: () => {
          window.location.href = '/login';
        },
      },
      duration: 10_000,
    }),
  );
}

/**
 * A fonte atual falhou (ou pendurou): tenta a PRÓXIMA fonte da faixa em vez de
 * desistir. Devolve false só quando não há mais alternativa — aí o chamador
 * para o player e avisa. true = já recarregou com outra fonte (ou a faixa
 * mudou no meio do caminho e não há nada a fazer).
 */
async function attemptSourceFallback(track: TrackDto): Promise<boolean> {
  if (track.streamUrl) {
    fallbackTried.add(track.streamUrl);
    // Se a URL morta era a cópia do cofre, limpa da biblioteca (todos os
    // aparelhos param de tentar o hop morto) e re-envia o áudio se ele
    // existir NESTE aparelho — o cofre se cura sozinho. No-op nos demais casos.
    reportDeadRemote(track.id, track.streamUrl);
  }
  if (fallbackAttempts >= MAX_FALLBACK_ATTEMPTS) return false;
  fallbackAttempts++;
  const resolved = await resolveNextSource(track, fallbackTried);
  const s = usePlayerStore.getState();
  if (s.currentTrack?.id !== track.id) return true; // trocou de faixa — encerra
  if (!resolved?.streamUrl) return false;
  fallbackTried.add(resolved.streamUrl);
  usePlayerStore.setState((st) => ({
    queue: st.queue.map((t, i) => (i === st.queueIndex && t.id === track.id ? resolved : t)),
    currentTrack: resolved,
    isBuffering: true,
  }));
  audioEngine.load(resolved, { autoplay: s.isPlaying });
  armLoadWatchdog(resolved.id);
  return true;
}

/** Para de esperar um carregamento que nunca chega: sem 'loaded' nem posição
 *  em 30s, trata como fonte morta e cai para a próxima. Fonte VIVA porém
 *  lenta (bytes chegando — /stream ao vivo num servidor carregado) ganha mais
 *  tempo em vez de ser morta no meio. */
function armLoadWatchdog(trackId: string, delayMs = LOAD_WATCHDOG_MS): void {
  if (loadWatchdog !== null) clearTimeout(loadWatchdog);
  loadWatchdog = null;
  if (typeof window === 'undefined') return;
  loadWatchdog = setTimeout(() => {
    loadWatchdog = null;
    const state = usePlayerStore.getState();
    const current = state.currentTrack;
    if (!current || current.id !== trackId) return;

    const pos = audioEngine.getPosition();

    // ── já tocou: vigia TRAVAMENTO no meio da faixa ────────────────
    if (pos > 0) {
      if (!state.isPlaying) return; // pausado de propósito — nada a vigiar
      if (pos !== lastWatchdogPos) {
        lastWatchdogPos = pos; // playhead andando: saudável
        stallStrikes = 0;
        armLoadWatchdog(trackId, STALL_CHECK_MS);
        return;
      }
      // Playhead parado com o player "tocando" = travou.
      stallStrikes++;
      if (stallStrikes === 1) {
        // Primeiro strike: cutuca o elemento (costuma destravar buffer preso).
        audioEngine.seek(pos);
        audioEngine.play();
        armLoadWatchdog(trackId, STALL_CHECK_MS);
        return;
      }
      void (async () => {
        if (await attemptSourceFallback(current)) return;
        failCurrentTrack('A reprodução travou — tentando a próxima faixa.');
      })();
      return;
    }

    // ── ainda não tocou: vigia CARREGAMENTO pendurado ──────────────
    if (audioEngine.getBufferedEnd() > 0) {
      armLoadWatchdog(trackId); // dados chegando — só está lento, espera mais
      return;
    }
    void (async () => {
      if (await attemptSourceFallback(current)) return;
      failCurrentTrack('Não foi possível carregar esta faixa agora.');
    })();
  }, delayMs);
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

/** Shuffle keeping the item at `keepIndex` first. */
function shuffleKeepingFirst(tracks: TrackDto[], keepIndex: number): TrackDto[] {
  const current = tracks[keepIndex];
  const rest = tracks.filter((_, i) => i !== keepIndex);
  const shuffled = fisherYatesShuffle(rest);
  return current ? [current, ...shuffled] : shuffled;
}

function toArray(tracks: TrackDto | TrackDto[]): TrackDto[] {
  return Array.isArray(tracks) ? tracks : [tracks];
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      function applyEngineSettings(): void {
        audioEngine.setVolume(get().volume);
        audioEngine.setMuted(get().muted);
        audioEngine.setRate(get().playbackRate);
      }

      /** Load queue[index] into the engine and sync state. */
      function loadIndex(index: number, autoplay: boolean, crossfadeSeconds = 0): void {
        const track = get().queue[index];
        if (!track) return;
        playRecorded = false;
        preloadRequested = false;
        crossfadeTriggered = false;
        syntheticEndHandledTrackId = null;
        previewGateFired = false;
        pendingResumeSeek = null; // troca de faixa normal — sem seek de retomada
        lastProgressCommit = 0;
        fallbackTried = new Set();
        fallbackAttempts = 0;
        clearLoadWatchdog();
        set({
          currentTrack: track,
          queueIndex: index,
          isPlaying: autoplay,
          progress: 0,
          buffered: 0,
          duration: track.durationMs / 1000,
        });

        // Local audio already resolvable THIS instant → play with zero network.
        const localNow = localLibraryAudioUrl(track.id) ?? localAudioUrl(track.id);
        if (localNow) {
          audioEngine.load(track, { autoplay, crossfadeSeconds });
          applyEngineSettings();
          return;
        }

        // Wait for the local caches to hydrate before touching any network URL —
        // on a fresh boot (especially OFFLINE) the object-URL maps may still be
        // rebuilding, and a downloaded track must NEVER go to the server.
        set({ isBuffering: true });
        void (async () => {
          await localAudioReady();
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;

          // `ensureLocalAudioUrl` abre o arquivo AGORA se ele existir. O boot
          // deixou de abrir a biblioteca inteira (custava ~10ms por faixa e
          // travava segundos), então a primeira reprodução de cada faixa paga
          // esse custo — uma vez, só para a que foi pedida. Sem esta linha a
          // faixa baixada iria para a rede, que é o pior erro possível aqui.
          const local = (await ensureLocalAudioUrl(track.id)) ?? localAudioUrl(track.id);
          if (local) {
            audioEngine.load(track, { autoplay, crossfadeSeconds });
            applyEngineSettings();
            return;
          }

          // OFFLINE without a local copy: no network attempts — skip to the
          // next queue track (it may be downloaded) or stop honestly.
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            failCurrentTrack('Sem conexão — essa faixa não está baixada neste dispositivo.');
            return;
          }

          // Existing stream URL or catalog track → load directly.
          if (track.streamUrl || !track.id.startsWith('local:')) {
            audioEngine.load(track, { autoplay, crossfadeSeconds });
            applyEngineSettings();
            armLoadWatchdog(track.id);
            return;
          }

          // Imported track with no audio on THIS device — resolve a stream
          // (uploaded copy or live from the source), then load.
          const resolved = await ensurePlayableSource(track);
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;
          if (resolved !== track && resolved.streamUrl) {
            set((s) => ({
              queue: s.queue.map((t, i) => (i === index ? resolved : t)),
              currentTrack: resolved,
            }));
          }
          audioEngine.load(resolved, { autoplay, crossfadeSeconds });
          applyEngineSettings();
          armLoadWatchdog(track.id);
        })().catch(() => {
          // Nada aqui pode deixar a faixa "carregando" para sempre.
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;
          failCurrentTrack('Não foi possível carregar esta faixa agora.');
        });
      }

      return {
        currentTrack: null,
        queue: [],
        queueIndex: -1,
        originalQueue: [],
        isPlaying: false,
        progress: 0,
        duration: 0,
        buffered: 0,
        volume: 0.9,
        muted: false,
        repeat: 'off',
        shuffle: false,
        playbackRate: 1,
        isBuffering: false,
        context: null,

        playTrack: (track, context) => {
          set({ queue: [track], originalQueue: [track], context: context ?? { source: 'queue' } });
          loadIndex(0, true);
        },

        playQueue: (tracks, startIndex = 0, context) => {
          if (tracks.length === 0) return;
          const index = clamp(startIndex, 0, tracks.length - 1);
          const { shuffle } = get();
          const queue = shuffle ? shuffleKeepingFirst(tracks, index) : [...tracks];
          set({
            originalQueue: [...tracks],
            queue,
            context: context ?? { source: 'queue' },
          });
          loadIndex(shuffle ? 0 : index, true);
        },

        playAt: (index) => {
          if (index < 0 || index >= get().queue.length) return;
          loadIndex(index, true);
        },

        next: () => {
          const { queue, queueIndex, repeat } = get();
          const nextIndex = queueIndex + 1;
          if (nextIndex < queue.length) {
            loadIndex(nextIndex, true);
          } else if (repeat === 'all' && queue.length > 0) {
            loadIndex(0, true);
          } else {
            audioEngine.pause();
            set({ isPlaying: false });
          }
        },

        prev: () => {
          const { progress, queueIndex } = get();
          // Restart the track unless we are within its first 3 seconds.
          if (progress > 3 || queueIndex <= 0) {
            audioEngine.seek(0);
            set({ progress: 0 });
            return;
          }
          loadIndex(queueIndex - 1, true);
        },

        toggle: () => {
          const { isPlaying, currentTrack } = get();
          if (!currentTrack) return;
          if (isPlaying) {
            audioEngine.pause();
            set({ isPlaying: false });
            saveResume(true);
          } else {
            get().play();
          }
        },

        play: () => {
          const { currentTrack, queueIndex, progress } = get();
          if (!currentTrack) return;
          // Faixa restaurada de outra sessão (ou engine resetado): o engine
          // ainda não a carregou — carrega agora e retoma NA POSIÇÃO salva.
          if (audioEngine.currentTrack?.id !== currentTrack.id) {
            const resumeAt = progress > 1 ? progress : null;
            loadIndex(Math.max(0, queueIndex), true);
            pendingResumeSeek = resumeAt; // depois do loadIndex (que zera)
            return;
          }
          audioEngine.play();
          set({ isPlaying: true });
          // Voltou a tocar → volta a vigiar travamento (o watchdog se desarma
          // sozinho quando a faixa é pausada).
          armLoadWatchdog(currentTrack.id, STALL_CHECK_MS);
        },

        pause: () => {
          audioEngine.pause();
          set({ isPlaying: false });
          saveResume(true);
        },

        seek: (seconds) => {
          const target = clamp(seconds, 0, get().duration || 0);
          audioEngine.seek(target);
          set({ progress: target });
        },

        setVolume: (volume) => {
          const value = clamp(volume, 0, 1);
          audioEngine.setVolume(value);
          if (value > 0 && get().muted) {
            audioEngine.setMuted(false);
            set({ volume: value, muted: false });
          } else {
            set({ volume: value });
          }
        },

        toggleMute: () => {
          const muted = !get().muted;
          audioEngine.setMuted(muted);
          set({ muted });
        },

        toggleShuffle: () => {
          const { shuffle, queue, queueIndex, originalQueue, currentTrack } = get();
          if (queue.length === 0) {
            set({ shuffle: !shuffle });
            return;
          }
          if (!shuffle) {
            set({
              shuffle: true,
              originalQueue: [...queue],
              queue: shuffleKeepingFirst(queue, queueIndex),
              queueIndex: 0,
            });
          } else {
            const restored = [...originalQueue];
            // Prefer identity, fall back to id (queue may contain duplicates).
            const byRef = currentTrack ? restored.findIndex((t) => t === currentTrack) : -1;
            const index =
              byRef >= 0
                ? byRef
                : currentTrack
                  ? restored.findIndex((t) => t.id === currentTrack.id)
                  : -1;
            set({
              shuffle: false,
              queue: restored,
              queueIndex: index >= 0 ? index : 0,
            });
          }
          preloadRequested = false; // next track changed
        },

        cycleRepeat: () => {
          const order: RepeatMode[] = ['off', 'all', 'one'];
          const current = order.indexOf(get().repeat);
          const nextMode = order[(current + 1) % order.length] ?? 'off';
          set({ repeat: nextMode });
        },

        addToQueue: (tracks) => {
          const items = toArray(tracks);
          if (items.length === 0) return;
          set((state) => ({
            queue: [...state.queue, ...items],
            originalQueue: [...state.originalQueue, ...items],
          }));
          preloadRequested = false;
        },

        playNext: (tracks) => {
          const items = toArray(tracks);
          if (items.length === 0) return;
          set((state) => {
            const queue = [...state.queue];
            queue.splice(state.queueIndex + 1, 0, ...items);
            const originalQueue = [...state.originalQueue];
            const anchor = state.currentTrack
              ? originalQueue.findIndex((t) => t.id === state.currentTrack?.id)
              : -1;
            originalQueue.splice(anchor >= 0 ? anchor + 1 : originalQueue.length, 0, ...items);
            return { queue, originalQueue };
          });
          preloadRequested = false;
        },

        removeFromQueue: (index) => {
          const { queue, queueIndex } = get();
          const removed = queue[index];
          if (!removed) return;
          const nextQueue = queue.filter((_, i) => i !== index);
          const origIndex = get().originalQueue.indexOf(removed);
          const nextOriginal =
            origIndex >= 0
              ? get().originalQueue.filter((_, i) => i !== origIndex)
              : get().originalQueue;

          if (index === queueIndex) {
            set({ queue: nextQueue, originalQueue: nextOriginal });
            if (nextQueue.length === 0) {
              audioEngine.pause();
              set({
                currentTrack: null,
                queueIndex: -1,
                isPlaying: false,
                progress: 0,
                duration: 0,
              });
            } else {
              loadIndex(Math.min(index, nextQueue.length - 1), get().isPlaying);
            }
          } else {
            set({
              queue: nextQueue,
              originalQueue: nextOriginal,
              queueIndex: index < queueIndex ? queueIndex - 1 : queueIndex,
            });
          }
          preloadRequested = false;
        },

        reorderQueue: (from, to) => {
          const { queue, queueIndex } = get();
          if (from === to || from < 0 || from >= queue.length || to < 0 || to >= queue.length) {
            return;
          }
          const next = [...queue];
          const [moved] = next.splice(from, 1);
          if (!moved) return;
          next.splice(to, 0, moved);

          let index = queueIndex;
          if (from === queueIndex) index = to;
          else if (from < queueIndex && to >= queueIndex) index = queueIndex - 1;
          else if (from > queueIndex && to <= queueIndex) index = queueIndex + 1;

          set({ queue: next, queueIndex: index });
          preloadRequested = false;
        },

        setUpNext: (tracks) => {
          const { queue, queueIndex } = get();
          set({ queue: [...queue.slice(0, queueIndex + 1), ...tracks] });
          preloadRequested = false;
        },

        clearQueue: () => {
          const { currentTrack } = get();
          set({
            queue: currentTrack ? [currentTrack] : [],
            originalQueue: currentTrack ? [currentTrack] : [],
            queueIndex: currentTrack ? 0 : -1,
          });
          audioEngine.preloadNext(null);
          preloadRequested = false;
        },

        setRate: (rate) => {
          const value = clamp(rate, 0.5, 2);
          audioEngine.setRate(value);
          set({ playbackRate: value });
        },
      };
    },
    {
      name: 'aurial:player',
      partialize: (state) => ({ volume: state.volume }),
    },
  ),
);

// ────────────────────────────────────────────────────────────────
// Engine bootstrap — call exactly once from App.
// ────────────────────────────────────────────────────────────────

let engineInitialized = false;

export function initPlayerEngine(): void {
  if (engineInitialized) return;
  engineInitialized = true;

  const store = usePlayerStore;

  // Prefer local copies: the engine asks this resolver before the network.
  // Consults both the on-device local library and the offline-download cache.
  audioEngine.setLocalSourceResolver(
    (track) => localLibraryAudioUrl(track.id) ?? localAudioUrl(track.id),
  );
  void localAudioReady();

  // Retomar de onde parou: a última faixa volta PAUSADA na posição exata —
  // o primeiro play carrega o áudio e busca a posição (ver play()).
  const resume = readResume();
  if (resume && !store.getState().currentTrack) {
    store.setState({
      currentTrack: resume.track,
      queue: [resume.track],
      originalQueue: [resume.track],
      queueIndex: 0,
      progress: resume.progress,
      duration: resume.track.durationMs / 1000,
      isPlaying: false,
      context: { source: 'queue' },
    });
  }
  // Última chance de gravar a posição ao sair/minimizar o app.
  window.addEventListener('pagehide', () => saveResume(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveResume(true);
  });

  // OS lock-screen / notification controls + background-play signalling.
  initMediaSession();

  const advanceFromTrackEnd = (): void => {
    const state = store.getState();
    syntheticEndHandledTrackId = null;
    if (state.repeat === 'one') {
      audioEngine.seek(0);
      audioEngine.play();
      playRecorded = false;
      store.setState({ progress: 0, isPlaying: true });
      return;
    }
    const nextIndex = state.queueIndex + 1;
    if (nextIndex < state.queue.length) {
      state.playAt(nextIndex);
    } else if (state.repeat === 'all' && state.queue.length > 0) {
      state.playAt(0);
    } else {
      store.setState({ isPlaying: false, progress: state.duration });
    }
  };

  // Restore persisted volume / apply audio settings.
  audioEngine.setVolume(store.getState().volume);
  const settings = useSettingsStore.getState();
  audioEngine.setEq(settings.eq);
  audioEngine.setNormalizeVolume(settings.normalizeVolume);

  // Keep engine in sync with settings changes.
  useSettingsStore.subscribe((state, prev) => {
    if (state.eq !== prev.eq) audioEngine.setEq(state.eq);
    if (state.normalizeVolume !== prev.normalizeVolume) {
      audioEngine.setNormalizeVolume(state.normalizeVolume);
    }
  });

  audioEngine.on('timeupdate', ({ position, duration }) => {
    const state = store.getState();

    // Som saindo = fila saudável. Zerar aqui (e não só no 'loaded') cobre a
    // faixa PRÉ-CARREGADA promovida, que não redispara 'loaded'.
    if (position > 0) consecutiveDeadTracks = 0;

    // Visitantes ouvem 30s por faixa — depois disso, convite para registrar.
    if (!signedIn && position >= PREVIEW_SECONDS) firePreviewGate();

    // Throttle store writes to ~5/s — components needing 60fps read the engine.
    const now = Date.now();
    if (now - lastProgressCommit >= 200) {
      lastProgressCommit = now;
      store.setState({
        progress: position,
        duration: duration || state.duration,
        buffered: audioEngine.getBufferedEnd(),
      });
      saveResume(); // "de onde parou" (1 escrita leve a cada 5s, no máximo)
    }

    // Record the play once at 30s or 50% listened (fire-and-forget).
    if (
      !playRecorded &&
      state.currentTrack &&
      (position >= 30 || (duration > 0 && position / duration >= 0.5))
    ) {
      playRecorded = true;
      const input: RecordPlayInput = {
        trackId: state.currentTrack.id,
        playedMs: Math.round(position * 1000),
        source: state.context?.source ?? 'queue',
        sourceId: state.context?.sourceId,
        completed: false,
      };
      // Record to on-device history unless a private session is active.
      if (!useSettingsStore.getState().privateSession) {
        localHistory.record(state.currentTrack, {
          playedMs: input.playedMs,
          source: input.source,
        });
      }
      void api.post('/me/history', input).catch(() => undefined);
      onPlayRecorded?.(input);
    }

    const { gapless, crossfadeSeconds } = useSettingsStore.getState();
    const remaining = duration - position;

    if (
      state.isPlaying &&
      state.currentTrack &&
      duration > 0 &&
      remaining <= 0.35 &&
      audioEngine.isTrackEnded() &&
      syntheticEndHandledTrackId !== state.currentTrack.id
    ) {
      syntheticEndHandledTrackId = state.currentTrack.id;
      advanceFromTrackEnd();
      return;
    }

    // Gapless: preload the upcoming track near the end.
    if (gapless && !preloadRequested && duration > 0 && remaining <= 12) {
      preloadRequested = true;
      const upcoming =
        state.queue[state.queueIndex + 1] ?? (state.repeat === 'all' ? state.queue[0] : undefined);
      audioEngine.preloadNext(upcoming ?? null);
    }

    // Crossfade: start the next track early and blend.
    if (
      crossfadeSeconds > 0 &&
      !crossfadeTriggered &&
      state.repeat !== 'one' &&
      duration > crossfadeSeconds * 2 &&
      remaining <= crossfadeSeconds
    ) {
      const nextIndex =
        state.queueIndex + 1 < state.queue.length
          ? state.queueIndex + 1
          : state.repeat === 'all' && state.queue.length > 0
            ? 0
            : -1;
      if (nextIndex >= 0) {
        crossfadeTriggered = true;
        const track = state.queue[nextIndex];
        if (track) {
          playRecorded = false;
          preloadRequested = false;
          lastProgressCommit = 0;
          audioEngine.load(track, { autoplay: true, crossfadeSeconds });
          store.setState({
            currentTrack: track,
            queueIndex: nextIndex,
            isPlaying: true,
            progress: 0,
            buffered: 0,
            duration: track.durationMs / 1000,
          });
          crossfadeTriggered = false;
        }
      }
    }
  });

  audioEngine.on('loaded', ({ duration }) => {
    clearLoadWatchdog();
    consecutiveDeadTracks = 0; // uma faixa carregou — a fila está saudável
    if (duration > 0 && Number.isFinite(duration)) store.setState({ duration });
    // Carregou, mas ainda pode travar no meio — segue vigiando o playhead.
    const loadedId = store.getState().currentTrack?.id;
    if (loadedId) armLoadWatchdog(loadedId, STALL_CHECK_MS);
    // Retomada: a faixa restaurada terminou de carregar → busca a posição salva.
    if (pendingResumeSeek !== null) {
      const at = Math.min(pendingResumeSeek, Math.max(0, (duration || Infinity) - 1));
      pendingResumeSeek = null;
      audioEngine.seek(at);
      store.setState({ progress: at });
    }
  });

  audioEngine.on('buffering', ({ buffering }) => {
    store.setState({ isBuffering: buffering });
  });

  audioEngine.on('error', ({ message, track, kind }) => {
    clearLoadWatchdog();
    const current = store.getState().currentTrack;
    // Fonte morta ≠ faixa morta: blob evictado do cofre (LRU), cofre fora do
    // ar ou token expirado na URL gravada — tenta a próxima fonte antes de
    // desistir. Só bloqueio de autoplay ('play') não é problema de fonte.
    if (kind !== 'play' && current && track && current.id === track.id) {
      void attemptSourceFallback(current).then((handled) => {
        if (handled) return;
        failCurrentTrack(message);
      });
      return;
    }
    store.setState({ isPlaying: false, isBuffering: false });
    // Toast lazily to avoid a hard dependency for unit tests.
    void import('sonner').then(({ toast }) => toast.error(message));
  });

  audioEngine.on('ended', advanceFromTrackEnd);
}
