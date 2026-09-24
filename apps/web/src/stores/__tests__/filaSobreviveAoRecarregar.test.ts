/**
 * A FILA SOBREVIVE AO RECARREGAR.
 *
 * A retomada guardava só a faixa atual e o boot montava a fila como
 * `[essa faixa]`: recarregar a página apagava tudo o que vinha depois, e quando
 * a faixa restaurada acabava o player parava — a pessoa tinha que voltar e
 * escolher música de novo. Aqui se prende a volta da fila inteira, na posição
 * certa, com a faixa de fora da biblioteca (que só existe gravada) junto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

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
    setLocalSourceResolver: vi.fn(),
    unlock: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    on: vi.fn(() => () => undefined),
    off: vi.fn(),
    destroy: vi.fn(),
    analyser: null,
    currentTrack: null,
    isPlaying: false,
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

vi.mock('@/lib/audio/mediaSession', () => ({ initMediaSession: vi.fn() }));

const a = makeTrack('local:a', { title: 'A' });
const b = makeTrack('local:b', { title: 'B' });
const doCatalogo = makeTrack('cat:c', { title: 'C', coverUrl: 'blob:morta' });

vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  registroPronto: vi.fn(() => Promise.resolve()),
  list: vi.fn(() => [{ track: a }, { track: b }]),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => null),
  reportDeadRemote: vi.fn(),
  sourceUrlFor: vi.fn(() => null),
}));

const assentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

async function reabrir(): Promise<typeof import('@/stores/playerStore')> {
  const mod = await import('@/stores/playerStore');
  mod.initPlayerEngine();
  await assentar();
  await assentar();
  return mod;
}

describe('a fila ao recarregar a página', () => {
  it('volta inteira, na posição em que estava', async () => {
    window.localStorage.setItem('aurial:resume', JSON.stringify({ track: b, progress: 12 }));
    window.localStorage.setItem(
      'aurial:fila',
      JSON.stringify({
        itens: ['local:a', 'local:b', doCatalogo],
        index: 1,
        trackId: 'local:b',
        context: { source: 'playlist' },
      }),
    );

    const { usePlayerStore } = await reabrir();
    const s = usePlayerStore.getState();

    expect(s.queue.map((t: TrackDto) => t.id)).toEqual(['local:a', 'local:b', 'cat:c']);
    expect(s.queueIndex).toBe(1);
    expect(s.currentTrack?.id).toBe('local:b');
    expect(s.context?.source).toBe('playlist');
  });

  it('não reaproveita a fila de OUTRA faixa', async () => {
    window.localStorage.setItem('aurial:resume', JSON.stringify({ track: a, progress: 5 }));
    window.localStorage.setItem(
      'aurial:fila',
      JSON.stringify({
        itens: ['local:a', 'local:b'],
        index: 1,
        trackId: 'local:b',
        context: null,
      }),
    );

    const { usePlayerStore } = await reabrir();

    expect(usePlayerStore.getState().queue.map((t: TrackDto) => t.id)).toEqual(['local:a']);
  });

  it('grava a fila sem a capa de object URL, que morre com a página', async () => {
    vi.useFakeTimers();
    try {
      const { usePlayerStore } = await import('@/stores/playerStore');
      const mod = await import('@/stores/playerStore');
      mod.initPlayerEngine();
      usePlayerStore.setState({ currentTrack: a, queue: [a, doCatalogo], queueIndex: 0 });
      vi.advanceTimersByTime(1500);

      const gravada = JSON.parse(window.localStorage.getItem('aurial:fila') ?? 'null') as {
        itens: (string | TrackDto)[];
      };
      expect(gravada.itens[0]).toBe('local:a');
      expect((gravada.itens[1] as TrackDto).id).toBe('cat:c');
      expect((gravada.itens[1] as TrackDto).coverUrl).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
