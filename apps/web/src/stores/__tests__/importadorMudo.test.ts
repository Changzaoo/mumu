/**
 * O IMPORTADOR NÃO RESPONDEU — dito em 8 s, não em 60.
 *
 * Faixa de extração ao vivo (`youtube:` da busca, "Em alta") só toca se o
 * importador estiver de pé. O que se prende: com o `/health` mudo a faixa para
 * em segundos com o aviso certo e o disjuntor abre; com ele respondendo, nada
 * muda; e se o som já saiu, a sonda atrasada não cala a música.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

vi.mock('@/lib/audio/AudioEngine', () => {
  const engine = {
    currentTrack: null as TrackDto | null,
    isPlaying: false,
    load: vi.fn((track: TrackDto) => {
      engine.currentTrack = track;
      engine.isPlaying = true;
    }),
    play: vi.fn(),
    pause: vi.fn(() => {
      engine.isPlaying = false;
    }),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    faixaPreCarregada: vi.fn(() => null),
    slotOciosoLivre: vi.fn(() => true),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    setLocalSourceResolver: vi.fn(),
    iniciarEm: vi.fn(),
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
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

const toastError = vi.fn();
vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, { error: toastError, success: () => undefined });
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
  garantirDetalhe: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasDownloadedAudio: vi.fn(() => false),
  ensureDownloadedAudioUrl: vi.fn(() => Promise.resolve(null)),
  rebaixarAoFalhar: vi.fn(),
  guardarAoOuvir: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));

// A sonda do médico, com o diagnóstico escolhido pelo teste e a demora de 8 s.
let diagnostico: 'ok' | 'sem-alcance' | 'bloqueado' = 'ok';
const sondarImportador = vi.fn(
  () => new Promise<string>((r) => setTimeout(() => r(diagnostico), 8_000)),
);
vi.mock('@/lib/telemetry/medico', () => ({ sondarImportador: () => sondarImportador() }));
const abrirCircuito = vi.fn();
vi.mock('@/lib/local/saudeDoImportador', () => ({
  abrirCircuito: () => abrirCircuito(),
  circuitoAberto: () => false,
  fecharCircuito: vi.fn(),
}));
const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));

import { IMPORTADOR_MUDO_MSG, initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const motor = audioEngine as unknown as { currentTrack: TrackDto | null; isPlaying: boolean };
const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

const doYoutube = makeTrack('youtube:abc', {
  streamUrl: 'https://importer.exemplo/stream?url=https%3A%2F%2Fyoutu.be%2Fabc&token=t',
});
const doAcervo = makeTrack('cat:x', { streamUrl: 'https://cofre.exemplo/blob/x?k=tok' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ status: 206, body: { cancel: () => Promise.resolve() } })),
  );
  initPlayerEngine();
  vi.mocked(audioEngine.load).mockClear();
  vi.mocked(audioEngine.pause).mockClear();
  vi.mocked(audioEngine.getPosition).mockReturnValue(0);
  sondarImportador.mockClear();
  abrirCircuito.mockClear();
  toastError.mockClear();
  anotar.mockClear();
  motor.currentTrack = null;
  motor.isPlaying = false;
  diagnostico = 'ok';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('faixa de extração ao vivo e o importador', () => {
  it('importador mudo: para em 8 s com o aviso certo e abre o disjuntor', async () => {
    diagnostico = 'sem-alcance';
    usePlayerStore.getState().playQueue([doYoutube], 0);
    await vi.advanceTimersByTimeAsync(50);
    expect(audioEngine.load).toHaveBeenCalledTimes(1); // o play saiu na hora, como sempre
    expect(sondarImportador).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    await vi.advanceTimersByTimeAsync(8_100);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().carga).toBeNull();
    expect(audioEngine.pause).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(IMPORTADOR_MUDO_MSG);
    expect(abrirCircuito).toHaveBeenCalledTimes(1);
    expect(anotar).toHaveBeenCalledWith('erro', 'importador-mudo', expect.stringContaining('sem-alcance'));
  });

  it('importador de pé: nada muda', async () => {
    usePlayerStore.getState().playQueue([doYoutube], 0);
    await vi.advanceTimersByTimeAsync(8_100);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    expect(abrirCircuito).not.toHaveBeenCalled();
  });

  it('o som saiu antes da resposta: a sonda atrasada não cala a música', async () => {
    diagnostico = 'bloqueado';
    usePlayerStore.getState().playQueue([doYoutube], 0);
    await vi.advanceTimersByTimeAsync(50);
    vi.mocked(audioEngine.getPosition).mockReturnValue(3);
    emit('timeupdate', { position: 3, duration: 200 });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a pessoa já foi para outra faixa: a sonda velha não para a nova', async () => {
    diagnostico = 'sem-alcance';
    usePlayerStore.getState().playQueue([doYoutube, doAcervo], 0);
    await vi.advanceTimersByTimeAsync(50);
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(8_100);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:x');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('faixa do acervo não pergunta ao importador', async () => {
    usePlayerStore.getState().playQueue([doAcervo], 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(sondarImportador).not.toHaveBeenCalled();
  });
});
