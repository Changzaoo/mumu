/**
 * TODO CAMINHO QUE CARREGA TEM REDE DE SEGURANÇA — e desistir para o som de verdade.
 *
 *  1. Crossfade (no 'timeupdate') e troca antecipada (`doHandoff`) chamam o motor
 *     fora de `loadIndex`. O 'loaded' que a promoção de uma pré-carga emite sai
 *     antes de a store trocar de faixa e arma o watchdog para a faixa ERRADA; uma
 *     fonte que pendura sem erro deixava o player mudo para sempre.
 *  2. `pararComErro` desistia sem pausar o motor, que ainda podia estar tocando a
 *     faixa anterior: `isPlaying: false` com música saindo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

/**
 * Engine de mentira com PLAYHEAD QUE ANDA SOZINHO.
 *
 * A primeira versão tinha `position` fixa, empurrada à mão por cada teste, e
 * isso não é uma simplificação inofensiva: é justamente a premissa do problema.
 * Com a tela apagada o playhead continua andando SEM nos avisar — o áudio toca,
 * o relógio da página é que para. Um dublê de posição congelada testa o mundo em
 * que o sintoma não existe.
 *
 * Aqui a posição sai do relógio, que sob temporizadores falsos é o mesmo relógio
 * que o teste adianta. Ninguém precisa empurrar nada.
 */
const engineState = {
  playing: true,
  duration: 0,
  comecouEm: 0,
  currentTrack: null as TrackDto | null,
  /** A duração é a de verdade (arquivo inteiro baixado / bate com o catálogo)? */
  duracaoConfiavel: true,
  /** A faixa carregada nunca começa: sem playhead, sem bytes. */
  congelada: false,
};

function posicaoAtual(): number {
  if (!engineState.currentTrack || engineState.congelada) return 0;
  return Math.min(engineState.duration, (Date.now() - engineState.comecouEm) / 1000);
}

vi.mock('@/lib/audio/AudioEngine', () => {
  const engine = {
    load: vi.fn((track: TrackDto) => {
      // O engine real passa a apontar para a faixa nova ao carregá-la, e
      // `armHandoffTimer` confere isso antes de mirar — sem espelhar aqui, o
      // teste mediria um caminho que nunca acontece.
      engineState.currentTrack = track;
      engineState.comecouEm = Date.now();
    }),
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
    getPosition: vi.fn(() => posicaoAtual()),
    getDuration: vi.fn(() => engineState.duration),
    getBufferedEnd: vi.fn(() => (engineState.congelada ? 0 : 1)),
    isTrackEnded: vi.fn(() => false),
    duracaoConfiavel: vi.fn(() => engineState.duracaoConfiavel),
    on: vi.fn((event: string, handler: Handler) => {
      const list = engineHandlers.get(event) ?? [];
      list.push(handler);
      engineHandlers.set(event, list);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    analyser: null,
    get currentTrack(): TrackDto | null {
      return engineState.currentTrack;
    },
    get isPlaying(): boolean {
      return engineState.playing;
    },
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
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => null),
  reportDeadRemote: (id: string, url: string) => reportarMorta(id, url),
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
import { useSettingsStore } from '@/stores/settingsStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

const DURACAO = 180;
const reportarMorta = vi.fn();

function fila(n: number): TrackDto[] {
  return Array.from({ length: n }, (_, i) =>
    makeTrack(`cat:${i}`, { streamUrl: `https://exemplo/${i}.mp3`, durationMs: DURACAO * 1000 }),
  );
}

const initialState = usePlayerStore.getState();
const settingsIniciais = useSettingsStore.getState();

beforeEach(() => {
  vi.useRealTimers();
  usePlayerStore.setState(initialState, true);
  useSettingsStore.setState(settingsIniciais, true);
  vi.clearAllMocks();
  engineState.playing = true;
  engineState.duration = 0;
  engineState.comecouEm = 0;
  engineState.currentTrack = null;
  engineState.duracaoConfiavel = true;
  engineState.congelada = false;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

initPlayerEngine();

describe('caminhos de carga fora do loadIndex', () => {
  it('crossfade para uma faixa que PENDURA sem erro: o watchdog a derruba', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 6 });
    vi.useFakeTimers();
    usePlayerStore.getState().playQueue(fila(3), 0);
    await vi.advanceTimersByTimeAsync(50);
    engineState.duration = DURACAO;
    engineState.comecouEm = Date.now();
    emit('loaded', { track: usePlayerStore.getState().currentTrack, duration: DURACAO });

    // Perto do fim: o bloco de crossfade carrega a cat:1.
    emit('timeupdate', { position: DURACAO - 4, duration: DURACAO });
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:1');

    // A nova nunca carrega nem erra: playhead parado em 0, nada em buffer.
    engineState.congelada = true;
    await vi.advanceTimersByTimeAsync(25_000);

    // O watchdog agiu sobre a faixa NOVA (marcou a fonte dela como morta).
    expect(reportarMorta).toHaveBeenCalledWith('cat:1', 'https://exemplo/1.mp3');
  });

  it('troca antecipada (tela apagada) para faixa que pendura: o watchdog a derruba', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    vi.useFakeTimers();
    usePlayerStore.getState().playQueue(fila(3), 0);
    await vi.advanceTimersByTimeAsync(50);
    engineState.duration = DURACAO;
    engineState.comecouEm = Date.now();
    emit('loaded', { track: usePlayerStore.getState().currentTrack, duration: DURACAO });

    await vi.advanceTimersByTimeAsync((DURACAO - 0.5) * 1000);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:1');

    engineState.congelada = true;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(reportarMorta).toHaveBeenCalledWith('cat:1', 'https://exemplo/1.mp3');
  });
});

describe('desistir da faixa para o motor', () => {
  it('sem rede e sem baixadas: o player pausa o motor, não só a store', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      usePlayerStore.getState().playQueue(fila(2), 0);
      await vi.waitFor(() => {
        expect(usePlayerStore.getState().isPlaying).toBe(false);
      });
      expect(audioEngine.pause).toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });
});
