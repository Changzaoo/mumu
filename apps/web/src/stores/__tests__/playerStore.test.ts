import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audio/AudioEngine', () => {
  const engine = {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    on: vi.fn(() => () => undefined),
    off: vi.fn(),
    destroy: vi.fn(),
    analyser: null,
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(() => Promise.resolve({ data: undefined })),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));

import { usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const initialState = usePlayerStore.getState();

const tracks = [makeTrack('a'), makeTrack('b'), makeTrack('c'), makeTrack('d')];

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
});

describe('playQueue', () => {
  it('loads the start index and stores queue + context', async () => {
    usePlayerStore.getState().playQueue(tracks, 1, { source: 'album', sourceId: 'al1' });
    const state = usePlayerStore.getState();
    expect(state.queue).toHaveLength(4);
    expect(state.queueIndex).toBe(1);
    expect(state.currentTrack?.id).toBe('b');
    expect(state.isPlaying).toBe(true);
    expect(state.context).toEqual({ source: 'album', sourceId: 'al1' });
    // The engine load waits for the local audio caches to hydrate first (so a
    // downloaded copy always beats a network URL) — flush that microtask.
    await vi.waitFor(() => {
      expect(audioEngine.load).toHaveBeenCalledWith(
        tracks[1],
        expect.objectContaining({ autoplay: true }),
      );
    });
  });

  it('shuffles keeping the chosen track first when shuffle is on', () => {
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().playQueue(tracks, 2);
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(0);
    expect(state.currentTrack?.id).toBe('c');
    expect(state.queue.map((t) => t.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(state.originalQueue.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('next / prev', () => {
  it('advances and wraps with repeat all', () => {
    usePlayerStore.getState().playQueue(tracks, 3);
    usePlayerStore.setState({ repeat: 'all' });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
  });

  it('stops at the end with repeat off', () => {
    usePlayerStore.getState().playQueue(tracks, 3);
    usePlayerStore.getState().next();
    const state = usePlayerStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.currentTrack?.id).toBe('d');
    expect(audioEngine.pause).toHaveBeenCalled();
  });

  it('prev restarts the track when past 3 seconds', () => {
    usePlayerStore.getState().playQueue(tracks, 2);
    usePlayerStore.setState({ progress: 42 });
    usePlayerStore.getState().prev();
    expect(audioEngine.seek).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('prev goes to the previous track within the first 3 seconds', () => {
    usePlayerStore.getState().playQueue(tracks, 2);
    usePlayerStore.setState({ progress: 1.5 });
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });
});

describe('shuffle', () => {
  it('keeps the current track first and restores original order on disable', () => {
    usePlayerStore.getState().playQueue(tracks, 1); // current = b
    usePlayerStore.getState().toggleShuffle();
    let state = usePlayerStore.getState();
    expect(state.shuffle).toBe(true);
    expect(state.queue[0]?.id).toBe('b');
    expect(state.queueIndex).toBe(0);

    usePlayerStore.getState().toggleShuffle();
    state = usePlayerStore.getState();
    expect(state.shuffle).toBe(false);
    expect(state.queue.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(state.queueIndex).toBe(1);
    expect(state.currentTrack?.id).toBe('b');
  });
});

describe('repeat', () => {
  it('cycles off → all → one → off', () => {
    const { cycleRepeat } = usePlayerStore.getState();
    expect(usePlayerStore.getState().repeat).toBe('off');
    cycleRepeat();
    expect(usePlayerStore.getState().repeat).toBe('all');
    cycleRepeat();
    expect(usePlayerStore.getState().repeat).toBe('one');
    cycleRepeat();
    expect(usePlayerStore.getState().repeat).toBe('off');
  });
});

describe('queue editing', () => {
  it('addToQueue appends, playNext inserts after the current track', () => {
    usePlayerStore.getState().playQueue(tracks.slice(0, 2), 0); // [a, b], current a
    const e = makeTrack('e');
    const f = makeTrack('f');
    usePlayerStore.getState().addToQueue(e);
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['a', 'b', 'e']);
    usePlayerStore.getState().playNext(f);
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['a', 'f', 'b', 'e']);
  });

  it('removeFromQueue before the current track shifts the index', () => {
    usePlayerStore.getState().playQueue(tracks, 2); // current c
    usePlayerStore.getState().removeFromQueue(0);
    const state = usePlayerStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(state.queueIndex).toBe(1);
    expect(state.currentTrack?.id).toBe('c');
  });

  it('reorderQueue keeps the playing track index consistent', () => {
    usePlayerStore.getState().playQueue(tracks, 1); // current b
    usePlayerStore.getState().reorderQueue(3, 0); // move d to front
    const state = usePlayerStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(state.queueIndex).toBe(2);
    expect(state.currentTrack?.id).toBe('b');
  });

  it('clearQueue keeps only the current track', () => {
    usePlayerStore.getState().playQueue(tracks, 1);
    usePlayerStore.getState().clearQueue();
    const state = usePlayerStore.getState();
    expect(state.queue.map((t) => t.id)).toEqual(['b']);
    expect(state.queueIndex).toBe(0);
  });
});

describe('volume', () => {
  it('clamps and unmutes when raising volume', () => {
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().muted).toBe(true);
    usePlayerStore.getState().setVolume(1.4);
    const state = usePlayerStore.getState();
    expect(state.volume).toBe(1);
    expect(state.muted).toBe(false);
    expect(audioEngine.setVolume).toHaveBeenCalledWith(1);
  });
});
