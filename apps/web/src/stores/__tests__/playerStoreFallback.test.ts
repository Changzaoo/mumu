/**
 * Fonte morta não mata a faixa (cofre de blobs com LRU / token expirado):
 * quando a URL gravada falha, o player tenta a PRÓXIMA fonte (cópia enviada →
 * stream ao vivo com token novo → link direto) antes de desistir. E um hydrate
 * local que rejeita não pode travar TODA a reprodução para sempre.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@aurial/shared';

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
    on: vi.fn((event: string, handler: Handler) => {
      const list = engineHandlers.get(event) ?? [];
      list.push(handler);
      engineHandlers.set(event, list);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    currentTrack: null,
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

// Biblioteca local: hydrate REJEITA (Cache Storage indisponível) — a
// reprodução tem de seguir mesmo assim. Sem áudio local neste aparelho.
const remoteUrlFor = vi.fn<(id: string) => string | null>(() => null);
const sourceUrlFor = vi.fn<(id: string) => string | null>(() => null);
const reportDeadRemote = vi.fn<(id: string, deadUrl: string) => void>();
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.reject(new Error('cache storage indisponível'))),
  localAudioUrl: vi.fn(() => null),
  remoteUrlFor: (id: string) => remoteUrlFor(id),
  reportDeadRemote: (id: string, deadUrl: string) => reportDeadRemote(id, deadUrl),
  sourceUrlFor: (id: string) => sourceUrlFor(id),
}));

vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
}));

const buildStreamUrl = vi.fn<(url: string) => Promise<string | null>>(() => Promise.resolve(null));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: (url: string) => buildStreamUrl(url),
  importerHostLabel: (host: string) => (/youtube\.com$/i.test(host) ? 'YouTube' : null),
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

const DEAD_BLOB = 'https://importer.example/blob/local%3At1?k=morto';
const FRESH_STREAM = 'https://importer.example/stream?url=x&token=fresco';

function makeLocalTrack(overrides: Partial<TrackDto> = {}): TrackDto {
  return makeTrack('local:t1', { streamUrl: DEAD_BLOB, ...overrides });
}

const initialState = usePlayerStore.getState();

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
  remoteUrlFor.mockReturnValue(null);
  sourceUrlFor.mockReturnValue(null);
  buildStreamUrl.mockResolvedValue(null);
});

initPlayerEngine();

describe('resiliência do hydrate local', () => {
  it('toca mesmo com o hydrate da biblioteca rejeitando', async () => {
    const track = makeLocalTrack();
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => {
      expect(audioEngine.load).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'local:t1', streamUrl: DEAD_BLOB }),
        expect.objectContaining({ autoplay: true }),
      );
    });
  });
});

describe('fallback de fonte morta', () => {
  it('recarrega com stream ao vivo (token novo) quando a URL gravada falha', async () => {
    sourceUrlFor.mockReturnValue('https://www.youtube.com/watch?v=abc');
    buildStreamUrl.mockResolvedValue(FRESH_STREAM);

    const track = makeLocalTrack();
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    emit('error', { message: 'Não foi possível reproduzir esta faixa.', track, kind: 'load' });

    await vi.waitFor(() => {
      expect(audioEngine.load).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'local:t1', streamUrl: FRESH_STREAM }),
        expect.objectContaining({ autoplay: true }),
      );
    });
    const state = usePlayerStore.getState();
    expect(state.currentTrack?.streamUrl).toBe(FRESH_STREAM);
    expect(state.queue[0]?.streamUrl).toBe(FRESH_STREAM);
    expect(state.isPlaying).toBe(true);
  });

  it('usa a cópia enviada (remoteUrl) quando ela difere da URL morta', async () => {
    remoteUrlFor.mockReturnValue('https://importer.example/blob/local%3At1?k=valido');

    const track = makeLocalTrack({ streamUrl: 'https://importer.example/stream?token=velho' });
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    emit('error', { message: 'x', track, kind: 'load' });

    await vi.waitFor(() => {
      expect(audioEngine.load).toHaveBeenLastCalledWith(
        expect.objectContaining({
          streamUrl: 'https://importer.example/blob/local%3At1?k=valido',
        }),
        expect.anything(),
      );
    });
  });

  it('para honestamente quando as alternativas se esgotam', async () => {
    sourceUrlFor.mockReturnValue('https://www.youtube.com/watch?v=abc');
    buildStreamUrl.mockResolvedValue(FRESH_STREAM);

    const track = makeLocalTrack();
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    emit('error', { message: 'x', track, kind: 'load' });
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().currentTrack?.streamUrl).toBe(FRESH_STREAM);
    });

    // O stream novo também falha — buildStreamUrl devolve a MESMA URL (token
    // ainda em cache), já tentada → sem alternativa → parar e avisar.
    const loads = vi.mocked(audioEngine.load).mock.calls.length;
    emit('error', {
      message: 'x',
      track: usePlayerStore.getState().currentTrack,
      kind: 'load',
    });
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().isPlaying).toBe(false);
    });
    expect(vi.mocked(audioEngine.load).mock.calls.length).toBe(loads);
    expect(usePlayerStore.getState().isBuffering).toBe(false);
  });

  it('reporta a URL morta à biblioteca para curar o cofre', async () => {
    sourceUrlFor.mockReturnValue('https://www.youtube.com/watch?v=abc');
    buildStreamUrl.mockResolvedValue(FRESH_STREAM);

    const track = makeLocalTrack();
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    emit('error', { message: 'x', track, kind: 'load' });

    await vi.waitFor(() => {
      expect(reportDeadRemote).toHaveBeenCalledWith('local:t1', DEAD_BLOB);
    });
  });

  it('pula para a próxima faixa da fila quando a atual morre de vez', async () => {
    // Sem remoteUrl nem sourceUrl: a faixa A não tem NENHUMA alternativa.
    const a = makeTrack('local:t1', { streamUrl: DEAD_BLOB });
    const b = makeTrack('local:t2', { streamUrl: 'https://cdn.example/b.mp3' });
    usePlayerStore.getState().playQueue([a, b], 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    emit('loaded', { track: a, duration: 100 }); // zera o contador de mortes seguidas

    emit('error', { message: 'x', track: a, kind: 'load' });

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().currentTrack?.id).toBe('local:t2');
    });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('não tenta fallback em bloqueio de autoplay (kind=play)', async () => {
    const track = makeLocalTrack();
    usePlayerStore.getState().playTrack(track);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    const loads = vi.mocked(audioEngine.load).mock.calls.length;

    emit('error', { message: 'Reprodução bloqueada.', track, kind: 'play' });

    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    expect(vi.mocked(audioEngine.load).mock.calls.length).toBe(loads);
  });
});
