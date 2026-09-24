/**
 * ANTES DE PULAR, TENTA DE NOVO A MESMA FAIXA.
 *
 * "Às vezes clico numa faixa, dá erro e ele sai pulando um monte de faixas sem
 * nem tentar de novo a que deu erro." O caso comum era o cofre reconstruindo
 * a cópia (503 por uns 20s): o <audio> falha em milissegundos, a faixa era dada
 * como morta, e a fila inteira era atravessada em segundos.
 *
 * O que se prende aqui: 503 (reconstruindo) recarrega A MESMA faixa depois de
 * esperar; 404 (cópia podada, morte de verdade) continua pulando na hora — o
 * pulo rápido existe para isso e não pode virar espera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

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
  const toast = Object.assign(() => undefined, {
    error: () => undefined,
    success: () => undefined,
  });
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

vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  registroPronto: vi.fn(() => Promise.resolve()),
  list: vi.fn(() => []),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => null),
  reportDeadRemote: vi.fn(),
  sourceUrlFor: vi.fn(() => null),
}));

vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasDownloadedAudio: vi.fn(() => false),
  ensureDownloadedAudioUrl: vi.fn(() => Promise.resolve(null)),
  rebaixarAoFalhar: vi.fn(),
}));

vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

// Endereços da cópia do cofre: é só nela que existe reconstrução a esperar.
const fila: TrackDto[] = ['a', 'b', 'c'].map((id) =>
  makeTrack(`cat:${id}`, { streamUrl: `https://cofre.exemplo/blob/${id}?k=tok` }),
);

/** Responde a sonda de um byte: `status` para a faixa `a`, 206 para as outras. */
function servidorResponde(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        status: url.includes('/blob/a?') ? status : 206,
        body: { cancel: () => Promise.resolve() },
      }),
    ),
  );
}

const cargasDe = (id: string): number =>
  vi.mocked(audioEngine.load).mock.calls.filter(([t]) => (t as TrackDto).id === id).length;

beforeEach(() => {
  vi.useFakeTimers();
  initPlayerEngine();
  vi.mocked(audioEngine.load).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tocarEFalharAPrimeira(): Promise<void> {
  usePlayerStore.getState().playQueue(fila, 0);
  await vi.advanceTimersByTimeAsync(10);
  expect(cargasDe('cat:a')).toBe(1);
  emit('error', { message: 'falhou', track: usePlayerStore.getState().currentTrack, kind: 'load' });
  await vi.advanceTimersByTimeAsync(50);
}

describe('faixa clicada que falha', () => {
  it('cofre reconstruindo (503): espera e tenta A MESMA faixa, sem pular', async () => {
    servidorResponde(503);
    await tocarEFalharAPrimeira();

    // Ainda nela — nada de pular para a próxima.
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:a');

    await vi.advanceTimersByTimeAsync(4_500);
    expect(cargasDe('cat:a')).toBe(2);
    expect(cargasDe('cat:b')).toBe(0);
  });

  it('fonte de fora do importador pula na hora, sem esperar a rede', async () => {
    const semCofre = ['x', 'y'].map((id) =>
      makeTrack(`cat:${id}`, { streamUrl: `https://audius.exemplo/${id}.mp3` }),
    );
    const buscas = vi.fn(() => new Promise(() => undefined)); // rede que nunca responde
    vi.stubGlobal('fetch', buscas);
    usePlayerStore.getState().playQueue(semCofre, 0);
    await vi.advanceTimersByTimeAsync(10);
    emit('error', {
      message: 'falhou',
      track: usePlayerStore.getState().currentTrack,
      kind: 'load',
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:y');
  });

  it('cópia podada (404): pula na hora, como sempre', async () => {
    servidorResponde(404);
    await tocarEFalharAPrimeira();

    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:b');
    expect(cargasDe('cat:a')).toBe(1);
  });
});
