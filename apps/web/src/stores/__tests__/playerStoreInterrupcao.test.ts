/**
 * Duas regras de convivência que o player quebrava:
 *
 * 1. Faixa morta faz PULAR, e a caminhada atrás de som tem ORÇAMENTO DE TEMPO,
 *    não uma contagem fixa: uma sequência ruim de cópias podadas se atravessa,
 *    uma queda geral (ou ficar sem rede) para logo. O contador não pode zerar
 *    no 'loaded' — ele dispara mesmo na faixa que vai falhar logo depois; só
 *    som saindo de verdade zera.
 *
 * 2. Quando outro app toma o áudio, aceitar. O player não ficava sabendo da
 *    pausa do sistema e o watchdog chamava play() de volta, roubando o alto-
 *    falante do outro app em loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

let enginePlaying = true;

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
    currentTrack: null,
    analyser: null,
    get isPlaying(): boolean {
      return enginePlaying;
    },
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

/** O player avisa por toast; o teste conta os avisos para provar que não spama. */
const toastCalls: string[] = [];
vi.mock('sonner', () => {
  const toast = Object.assign((msg: string) => void toastCalls.push(msg), {
    error: (msg: string) => void toastCalls.push(`error:${msg}`),
    success: (msg: string) => void toastCalls.push(`success:${msg}`),
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

// Nenhuma fonte alternativa: aqui se testa o que acontece DEPOIS de o fallback
// se esgotar — a faixa está morta de verdade.
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
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
  // Sem cópia local: é a premissa deste arquivo (a faixa está morta de verdade).
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

/** Uma fila de faixas de catálogo, todas com fonte e todas mortas. */
function fila(n: number): TrackDto[] {
  return Array.from({ length: n }, (_, i) =>
    makeTrack(`cat:${i}`, { streamUrl: `https://exemplo/${i}.mp3` }),
  );
}

const initialState = usePlayerStore.getState();

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
  toastCalls.length = 0;
  enginePlaying = true;
  // O contador de mortes seguidas vive no módulo e só zera com som saindo.
  // Sem isto, um teste que esgota os 3 pulos deixa o seguinte já no limite.
  emit('timeupdate', { position: 1, duration: 180 });
});

initPlayerEngine();

describe('faixa morta pula, mas não varre a fila', () => {
  /** Simula a faixa atual falhando por completo (com o 'loaded' que vem antes). */
  const matarFaixaAtual = async (): Promise<void> => {
    const atual = usePlayerStore.getState().currentTrack!;
    // A fonte morta responde cabeçalho e dispara 'loaded' ANTES de falhar —
    // é exatamente este 'loaded' que zerava o contador de pulos.
    emit('loaded', { track: atual, duration: 180 });
    emit('error', { message: 'fonte morta', track: atual, kind: 'load' });
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().currentTrack?.id).not.toBe(atual.id);
    });
  };

  it('atravessa uma sequência ruim em vez de desistir na terceira', async () => {
    // Boa parte das cópias do cofre está podada: três mortes seguidas é rotina,
    // e parar aí deixava a pessoa sem som com música viva logo adiante.
    const tracks = fila(10);
    usePlayerStore.getState().playQueue(tracks, 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    for (let i = 0; i < 5; i += 1) await matarFaixaAtual();

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().queueIndex).toBeGreaterThanOrEqual(5);
  });

  it('avisa UMA vez por sequência, não a cada pulo', async () => {
    const tracks = fila(10);
    usePlayerStore.getState().playQueue(tracks, 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    for (let i = 0; i < 4; i += 1) await matarFaixaAtual();

    // Um toast de "pulando" para a sequência inteira — o resto seria barulho
    // sobre um problema que o app já está resolvendo sozinho.
    expect(toastCalls.length).toBe(1);
  });

  it('não varre a fila inteira: a caminhada tem teto', async () => {
    // A trava contra laço quente continua de pé — falha instantânea não pode
    // virar varredura de milhares de faixas.
    const tracks = fila(200);
    usePlayerStore.getState().playQueue(tracks, 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    for (let i = 0; i < 45 && usePlayerStore.getState().isPlaying; i += 1) {
      await matarFaixaAtual().catch(() => undefined);
    }

    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    expect(usePlayerStore.getState().queueIndex).toBeLessThan(60);
  });

  it('sem rede para na primeira: queda geral não é sequência ruim', async () => {
    const tracks = fila(10);
    usePlayerStore.getState().playQueue(tracks, 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const atual = usePlayerStore.getState().currentTrack!;
      emit('loaded', { track: atual, duration: 180 });
      emit('error', { message: 'fonte morta', track: atual, kind: 'load' });
      await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
      expect(usePlayerStore.getState().queueIndex).toBe(0);
    } finally {
      online.mockRestore();
    }
  });

  it('som saindo zera o contador: uma faixa boa no meio renova o orçamento', async () => {
    const tracks = fila(10);
    usePlayerStore.getState().playQueue(tracks, 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    await matarFaixaAtual();
    await matarFaixaAtual();

    // Esta toca de verdade — posição andando é o único sinal de fila saudável.
    emit('timeupdate', { position: 12, duration: 180 });

    // Com o contador zerado, cabem 3 pulos novos.
    await matarFaixaAtual();
    await matarFaixaAtual();
    await matarFaixaAtual();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});

describe('outro app tomou o áudio', () => {
  it('aceita a pausa do sistema em vez de continuar "tocando"', async () => {
    usePlayerStore.getState().playQueue(fila(3), 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    enginePlaying = false; // o elemento foi pausado por fora
    emit('interrupted', { track: usePlayerStore.getState().currentTrack });

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().isBuffering).toBe(false);
  });

  it('não chama play() para retomar sozinho', async () => {
    usePlayerStore.getState().playQueue(fila(3), 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    vi.clearAllMocks();

    enginePlaying = false;
    emit('interrupted', { track: usePlayerStore.getState().currentTrack });
    await new Promise((r) => setTimeout(r, 20));

    expect(audioEngine.play).not.toHaveBeenCalled();
  });

  it('não avança para a próxima faixa — interrupção não é faixa morta', async () => {
    usePlayerStore.getState().playQueue(fila(3), 0);
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    const antes = usePlayerStore.getState().queueIndex;

    enginePlaying = false;
    emit('interrupted', { track: usePlayerStore.getState().currentTrack });

    expect(usePlayerStore.getState().queueIndex).toBe(antes);
  });
});
