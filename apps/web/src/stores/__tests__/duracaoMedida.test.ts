/**
 * A DURAÇÃO QUE O PLAYER MEDE SÓ VOLTA PARA A BIBLIOTECA QUANDO É DE VERDADE.
 *
 * O `timeupdate` traz o que o motor sabe NO MOMENTO — no meio de um stream, é o
 * palpite do navegador (o fim do trecho baixado, a estimativa do Safari). Foi
 * anotando esse palpite que faixas de quatro minutos ficaram gravadas como
 * "0:14". A regra: só anota com `duracaoConfiavel()`, só para a faixa que o
 * motor está de fato tocando, e aí a medida vence o valor gravado se ele
 * estiver longe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler[]>();
const motor = { confiavel: false, faixa: null as TrackDto | null };

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
    iniciarEm: vi.fn(),
    getPosition: vi.fn(() => 1),
    getDuration: vi.fn(() => 240),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    duracaoConfiavel: vi.fn(() => motor.confiavel),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    unlock: vi.fn(),
    get currentTrack(): TrackDto | null {
      return motor.faixa;
    },
    analyser: null,
    isPlaying: true,
  };
  return { audioEngine: engine, AudioEngine: class {} };
});
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: undefined })) },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));
vi.mock('@/lib/audio/mediaSession', () => ({ initMediaSession: vi.fn() }));
const setTrackDuration = vi.fn();
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  registroPronto: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => null),
  reportDeadRemote: vi.fn(),
  sourceUrlFor: vi.fn(() => null),
  setTrackDuration: (...a: unknown[]) => setTrackDuration(...a),
  // Mesma regra do módulo real (coberta em lib/local/__tests__/duracaoDaFaixa).
  duracaoDiverge: (gravada: number | null | undefined, medida: number) =>
    !(typeof gravada === 'number' && Number.isFinite(gravada) && gravada > 0) ||
    Math.abs(gravada - medida) > Math.max(5000, medida * 0.1),
}));
vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasDownloadedAudio: vi.fn(() => false),
  ensureDownloadedAudioUrl: vi.fn(() => Promise.resolve(null)),
  rebaixarAoFalhar: vi.fn(),
}));
vi.mock('@/lib/local/detalheDaFaixa', () => ({
  garantirDetalhe: vi.fn(() => Promise.resolve(false)),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { makeTrack } from '@/test/factories';

initPlayerEngine();

function tocar(track: TrackDto, duracaoMedida: number): void {
  usePlayerStore.setState({ currentTrack: track });
  motor.faixa = track;
  for (const h of handlers.get('timeupdate') ?? []) h({ position: 1, duration: duracaoMedida });
}

beforeEach(() => {
  setTrackDuration.mockClear();
  motor.confiavel = false;
});

describe('anotar a duração medida', () => {
  it('palpite de stream parcial NÃO é anotado; a medida confiável é', () => {
    const t = makeTrack('local:parcial', { durationMs: 0 });
    tocar(t, 14); // o navegador só "sabe" o trecho baixado
    expect(setTrackDuration).not.toHaveBeenCalled();
    motor.confiavel = true; // arquivo inteiro no buffer
    tocar(t, 240);
    expect(setTrackDuration).toHaveBeenCalledWith('local:parcial', 240_000);
    tocar(t, 240);
    expect(setTrackDuration).toHaveBeenCalledTimes(1); // uma vez por sessão
  });

  it('o "0:14" gravado é corrigido pela medida real', () => {
    motor.confiavel = true;
    tocar(makeTrack('local:curta', { durationMs: 14_000 }), 240);
    expect(setTrackDuration).toHaveBeenCalledWith('local:curta', 240_000);
  });

  it('duração boa não se mexe', () => {
    motor.confiavel = true;
    tocar(makeTrack('local:boa', { durationMs: 239_000 }), 240);
    expect(setTrackDuration).not.toHaveBeenCalled();
  });

  it('a medida de OUTRA faixa (virada do crossfade) não é anotada nesta', () => {
    motor.confiavel = true;
    const atual = makeTrack('local:atual', { durationMs: 0 });
    usePlayerStore.setState({ currentTrack: atual });
    motor.faixa = makeTrack('local:proxima', { durationMs: 0 });
    for (const h of handlers.get('timeupdate') ?? []) h({ position: 1, duration: 200 });
    expect(setTrackDuration).not.toHaveBeenCalled();
  });
});
