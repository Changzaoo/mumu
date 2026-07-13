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
import * as localHistory from '@/lib/local/localHistory';
import { clamp } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { hydrateDownloads, localAudioUrl } from '@/features/downloads/downloadManager';
import {
  hydrate as hydrateLocalLibrary,
  localAudioUrl as localLibraryAudioUrl,
  remoteUrlFor,
  sourceUrlFor,
} from '@/lib/local/localLibrary';
import { buildStreamUrl, importerHostLabel } from '@/lib/local/importerHelper';

/**
 * Ensure a track has a playable source. Local-library tracks store their audio
 * only on the device that imported them; on any OTHER device (metadata synced,
 * audio absent) we resolve a stream: the uploaded copy on the importer if it
 * exists, else a live stream from the original link (YouTube/SoundCloud/…) or
 * the direct file URL. Returns the track augmented with a `streamUrl`, or the
 * track unchanged when nothing can be resolved (genuinely unavailable).
 */
async function ensurePlayableSource(track: TrackDto): Promise<TrackDto> {
  if (localLibraryAudioUrl(track.id) || localAudioUrl(track.id) || track.streamUrl) return track;
  if (!track.id.startsWith('local:')) return track;
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

// Per-loaded-track flags (reset on every load).
let playRecorded = false;
let preloadRequested = false;
let crossfadeTriggered = false;
let lastProgressCommit = 0;

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
        lastProgressCommit = 0;
        set({
          currentTrack: track,
          queueIndex: index,
          isPlaying: autoplay,
          progress: 0,
          buffered: 0,
          duration: track.durationMs / 1000,
        });

        // A source we can play right now (local audio, an existing stream URL, or
        // a catalog track) → load instantly.
        const hasSource =
          Boolean(localLibraryAudioUrl(track.id)) ||
          Boolean(localAudioUrl(track.id)) ||
          Boolean(track.streamUrl) ||
          !track.id.startsWith('local:');
        if (hasSource) {
          audioEngine.load(track, { autoplay, crossfadeSeconds });
          applyEngineSettings();
          return;
        }

        // Imported track with no audio on THIS device — resolve a stream first
        // (uploaded copy or live from the source), then load. Guard against the
        // user skipping to another track while we resolve.
        set({ isBuffering: true });
        void ensurePlayableSource(track).then((resolved) => {
          if (get().queueIndex !== index || get().currentTrack?.id !== track.id) return;
          if (resolved !== track && resolved.streamUrl) {
            set((s) => ({
              queue: s.queue.map((t, i) => (i === index ? resolved : t)),
              currentTrack: resolved,
            }));
          }
          audioEngine.load(resolved, { autoplay, crossfadeSeconds });
          applyEngineSettings();
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
          } else {
            audioEngine.play();
            set({ isPlaying: true });
          }
        },

        play: () => {
          if (!get().currentTrack) return;
          audioEngine.play();
          set({ isPlaying: true });
        },

        pause: () => {
          audioEngine.pause();
          set({ isPlaying: false });
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
  void hydrateLocalLibrary();
  void hydrateDownloads();

  // OS lock-screen / notification controls + background-play signalling.
  initMediaSession();

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

    // Throttle store writes to ~5/s — components needing 60fps read the engine.
    const now = Date.now();
    if (now - lastProgressCommit >= 200) {
      lastProgressCommit = now;
      store.setState({
        progress: position,
        duration: duration || state.duration,
        buffered: audioEngine.getBufferedEnd(),
      });
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
    if (duration > 0 && Number.isFinite(duration)) store.setState({ duration });
  });

  audioEngine.on('buffering', ({ buffering }) => {
    store.setState({ isBuffering: buffering });
  });

  audioEngine.on('error', ({ message }) => {
    store.setState({ isPlaying: false, isBuffering: false });
    // Toast lazily to avoid a hard dependency for unit tests.
    void import('sonner').then(({ toast }) => toast.error(message));
  });

  audioEngine.on('ended', () => {
    const state = store.getState();
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
  });
}
