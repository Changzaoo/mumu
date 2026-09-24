/**
 * TROCAR DE MÚSICA NÃO É TROCAR DE APARELHO.
 *
 * Com o som saindo do celular e o computador só espelhando, clicar numa música
 * no computador começava a tocar NO COMPUTADOR — duas músicas no ar, ou o som
 * saindo de onde ninguém está. O clique escolhe a música; quem escolhe o
 * aparelho é o seletor de dispositivos. É a regra do Spotify Connect, e é o que
 * este arquivo prende.
 *
 * As duas metades importam tanto quanto: se ESTE aparelho está tocando, o
 * clique é dele e nada pode ser desviado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const sendCommand = vi.fn(() => Promise.resolve());
vi.mock('@/lib/devices/presence', () => ({ sendCommand }));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { definirAlvoRemoto } from '@/lib/devices/alvoRemoto';
import { makeTrack } from '@/test/factories';

const inicial = usePlayerStore.getState();
const faixas = [makeTrack('a'), makeTrack('b'), makeTrack('c')];

/** O envio viaja num `import()` dinâmico — é preciso deixar a fila de micro
 *  tarefas rodar antes de olhar o que foi mandado. */
const assentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  usePlayerStore.setState(inicial, true);
  definirAlvoRemoto(null);
  sendCommand.mockClear();
});

describe('com outro aparelho tocando', () => {
  beforeEach(() => {
    definirAlvoRemoto({ id: 'celular', name: 'moto g' });
  });

  it('clicar numa música manda a faixa para lá, sem tocar aqui', async () => {
    usePlayerStore.getState().playTrack(faixas[0] as never);
    await assentar();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(sendCommand).toHaveBeenCalledWith(
      'celular',
      'playTrack',
      undefined,
      expect.objectContaining({ trackId: 'a' }),
    );
  });

  it('tocar uma lista manda a fila inteira e a posição clicada', async () => {
    usePlayerStore.getState().playQueue(faixas as never, 2);
    await assentar();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(sendCommand).toHaveBeenCalledWith('celular', 'playTrack', undefined, {
      trackId: 'c',
      queue: ['a', 'b', 'c'],
      index: 2,
    });
  });

  it('mas se ESTE aparelho está tocando, o clique é dele', async () => {
    usePlayerStore.setState({ isPlaying: true });

    usePlayerStore.getState().playTrack(faixas[0] as never);
    await assentar();

    expect(sendCommand).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
  });
});

describe('sem ninguém tocando fora', () => {
  it('toca aqui mesmo, como sempre', async () => {
    usePlayerStore.getState().playTrack(faixas[1] as never);
    await assentar();

    expect(sendCommand).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });
});

describe('o fim da faixa', () => {
  it('avança AQUI mesmo com outro aparelho marcado como tocando', async () => {
    initPlayerEngine();
    usePlayerStore.getState().playQueue(faixas as never, 0);
    await assentar();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');

    // No instante do 'ended' o `isPlaying` pode já estar em falso, e uma
    // presença velha do celular ainda diz "tocando". A fila tem que andar
    // aqui — mandar a próxima para lá deixaria este aparelho mudo.
    definirAlvoRemoto({ id: 'celular', name: 'moto g' });
    usePlayerStore.setState({ isPlaying: false });
    for (const handler of engineHandlers.get('ended') ?? []) handler({ track: faixas[0] });
    await assentar();

    expect(sendCommand).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });
});
