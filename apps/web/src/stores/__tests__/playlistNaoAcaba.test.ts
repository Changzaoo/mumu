/**
 * A MÚSICA NÃO PARA — e o que a pessoa pula é lembrado.
 *
 *  - Uma playlist acabando emenda a mais parecida das playlists da pessoa, e o
 *    "Tocando da playlist" só muda quando a primeira faixa dela começa.
 *  - Pular (a pessoa) anota o pulo; pular faixa morta (o player) não anota —
 *    senão a falha do servidor viraria "ela não gosta desta música".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

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
    on: vi.fn((event: string, handler: Handler) => {
      const list = engineHandlers.get(event) ?? [];
      list.push(handler);
      engineHandlers.set(event, list);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    analyser: null,
    currentTrack: null,
    isPlaying: false,
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, { error: () => undefined });
  return { toast };
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

const f = (id: string, artista: string): TrackDto =>
  makeTrack(id, {
    genre: 'Trap',
    streamUrl: `https://audius.exemplo/${id}.mp3`,
    artists: [{ id: artista, name: artista, slug: '', imageUrl: null }],
  });

const trapA = [f('a1', 'Matuê'), f('a2', 'Teto')];
const trapB = [f('b1', 'Matuê'), f('b2', 'Teto'), f('b3', 'Wiu')];
const louvor = [f('c1', 'Aline Barros'), f('c2', 'Fernandinho')];

vi.mock('@/lib/local/localPlaylists', () => {
  const listas = [
    { id: 'A', title: 'Trap de sexta', trackIds: [] },
    { id: 'B', title: 'Trap de sábado', trackIds: [] },
    { id: 'C', title: 'Louvor', trackIds: [] },
  ];
  const faixas: Record<string, TrackDto[]> = { A: trapA, B: trapB, C: louvor };
  return {
    list: () => listas,
    get: (id: string) => listas.find((l) => l.id === id) ?? null,
    resolveTracks: (id: string) => faixas[id] ?? [],
  };
});
vi.mock('@/lib/reco/radio', () => ({ construirRadio: () => [] }));
vi.mock('@/lib/reco/sinaisDoAparelho', () => ({
  sinaisDoAparelho: () => ({ fatorDePulo: () => 1 }),
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { lerPulos } from '@/lib/reco/pulos';

const assentar = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const inicial = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  usePlayerStore.setState(inicial, true);
  window.localStorage.clear();
});

describe('fim de playlist', () => {
  it('emenda a playlist mais parecida, não a de outro gênero', async () => {
    usePlayerStore.getState().playQueue(trapA, 1, { source: 'playlist', sourceId: 'A' });
    await assentar();

    const ids = usePlayerStore.getState().queue.map((t) => t.id);
    expect(ids).toEqual(['a1', 'a2', 'b1', 'b2', 'b3']);
  });

  it('o "tocando da playlist" muda quando a emendada começa', async () => {
    usePlayerStore.getState().playQueue(trapA, 1, { source: 'playlist', sourceId: 'A' });
    await assentar();
    expect(usePlayerStore.getState().context?.sourceId).toBe('A');

    usePlayerStore.getState().next();
    await assentar();

    expect(usePlayerStore.getState().currentTrack?.id).toBe('b1');
    expect(usePlayerStore.getState().context).toEqual({ source: 'playlist', sourceId: 'B' });
  });
});

describe('a mesma playlist até o fim, duas vezes', () => {
  it('na segunda vez a música também continua', async () => {
    for (let vez = 0; vez < 2; vez++) {
      usePlayerStore.getState().playQueue(trapA, 1, { source: 'playlist', sourceId: 'A' });
      await assentar();
      expect(usePlayerStore.getState().queue.length).toBeGreaterThan(trapA.length);
    }
  });
});

describe('memória de pulos', () => {
  it('a pessoa pulou depois de tocar um pouco: fica anotado', async () => {
    usePlayerStore.getState().playQueue(louvor, 0, { source: 'queue' });
    await assentar();
    usePlayerStore.setState({ progress: 12, duration: 180 });

    usePlayerStore.getState().next();

    expect(lerPulos().map((p) => p.id)).toContain('c1');
  });

  it('o player pulou faixa morta: não é pulo de ninguém', async () => {
    usePlayerStore.getState().playQueue(louvor, 0, { source: 'queue' });
    await assentar();
    usePlayerStore.setState({ progress: 12, duration: 180 });

    // A memória de pulos guarda cache no módulo: compara antes e depois.
    const antes = lerPulos().filter((p) => p.id === 'c1').length;
    // Fonte de fora do importador: morte decidida na hora, sem sonda.
    const atual = usePlayerStore.getState().currentTrack;
    for (const h of engineHandlers.get('error') ?? []) {
      h({ message: 'morta', track: atual, kind: 'load' });
    }
    await assentar();

    expect(usePlayerStore.getState().currentTrack?.id).toBe('c2');
    expect(lerPulos().filter((p) => p.id === 'c1').length).toBe(antes);
  });
});
