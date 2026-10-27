/**
 * PULOU, PAROU.
 *
 * "Ele tá tocando uma música, pula pra outra, mas fica tocando a que tava
 * anterior; não avança" (27/10/2026). Reproduzido em produção: a fonte da
 * faixa pedida é resolvida com `await` (até 20 s quando a cópia foi podada ou
 * o importador não responde), e nesse intervalo o motor seguia tocando a
 * anterior com a tela já dizendo o nome da nova em 0:00.
 *
 * O que se prende aqui: entrar no caminho assíncrono de carga com o motor numa
 * OUTRA faixa cala o motor na hora. Os atalhos síncronos (cópia no aparelho,
 * faixa pré-carregada) e a recarga da MESMA faixa (retentativa) não se calam —
 * neles o próprio `load` troca o som, e calar seria um corte à toa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

/** O que o motor tinha quando `pause()` foi chamado — para provar o INSTANTE. */
const pausas: Array<string | null> = [];

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
      pausas.push(engine.currentTrack?.id ?? null);
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

vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, { error: () => undefined, success: () => undefined });
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

// O registro da biblioteca local NUNCA fica pronto: é a resolução lenta de uma
// faixa `local:` (cofre podado, importador mudo) — a janela do defeito.
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => new Promise(() => undefined)),
  registroPronto: vi.fn(() => new Promise(() => undefined)),
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

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const motor = audioEngine as unknown as { currentTrack: TrackDto | null; isPlaying: boolean };

const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

// `cat:` carrega na hora (só espera os downloads, que já estão prontos);
// `local:` espera o registro — que, aqui, nunca chega.
const rapida = makeTrack('cat:a', { streamUrl: 'https://cofre.exemplo/blob/a?k=tok' });
const lenta = makeTrack('local:b', { streamUrl: null });
const outraRapida = makeTrack('cat:c', { streamUrl: 'https://cofre.exemplo/blob/c?k=tok' });

const cargasDe = (id: string): number =>
  vi.mocked(audioEngine.load).mock.calls.filter(([t]) => (t as TrackDto).id === id).length;

beforeEach(() => {
  vi.useFakeTimers();
  initPlayerEngine();
  vi.mocked(audioEngine.load).mockClear();
  vi.mocked(audioEngine.pause).mockClear();
  pausas.length = 0;
  motor.currentTrack = null;
  motor.isPlaying = false;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Toca a primeira da fila e deixa o som "sair" (o motor fica nela). */
async function tocarAPrimeira(fila: TrackDto[]): Promise<void> {
  usePlayerStore.getState().playQueue(fila, 0);
  await vi.advanceTimersByTimeAsync(10);
  expect(cargasDe(fila[0]!.id)).toBe(1);
  emit('timeupdate', { position: 12, duration: 200 });
  pausas.length = 0;
  vi.mocked(audioEngine.pause).mockClear();
}

describe('pular com o motor ainda na anterior', () => {
  it('cala a anterior NA HORA, antes de a fonte da nova chegar', async () => {
    await tocarAPrimeira([rapida, lenta]);

    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(5_000);

    // A tela já é da nova…
    expect(usePlayerStore.getState().currentTrack?.id).toBe('local:b');
    // …a fonte dela ainda não veio (o registro nunca fica pronto)…
    expect(cargasDe('local:b')).toBe(0);
    // …e o motor foi calado enquanto AINDA estava na anterior — não 20 s depois.
    expect(pausas).toEqual(['cat:a']);
    expect(motor.isPlaying).toBe(false);
  });

  it('clicar noutra faixa da fila também cala', async () => {
    await tocarAPrimeira([rapida, outraRapida, lenta]);

    usePlayerStore.getState().playAt(2);
    await vi.advanceTimersByTimeAsync(10);

    expect(pausas).toEqual(['cat:a']);
  });

  it('a intenção de tocar fica de pé: a nova toca quando chegar', async () => {
    await tocarAPrimeira([rapida, outraRapida]);

    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(10);

    // Calou a anterior e carregou a nova com autoplay — a store segue "tocando".
    expect(pausas).toEqual(['cat:a']);
    expect(cargasDe('cat:c')).toBe(1);
    expect(vi.mocked(audioEngine.load).mock.calls.at(-1)?.[1]).toMatchObject({ autoplay: true });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('a MESMA faixa recarregada (retentativa) não se cala', async () => {
    await tocarAPrimeira([rapida, outraRapida]);

    usePlayerStore.getState().playAt(0);
    await vi.advanceTimersByTimeAsync(10);

    expect(pausas).toEqual([]);
    expect(cargasDe('cat:a')).toBe(2);
  });

  it('faixa pré-carregada no motor não passa pelo caminho assíncrono nem se cala', async () => {
    await tocarAPrimeira([rapida, outraRapida]);
    vi.mocked(audioEngine.faixaPreCarregada).mockImplementation((id: string) =>
      id === 'cat:c' ? outraRapida : null,
    );

    usePlayerStore.getState().next();

    // Promoção síncrona: o `load` saiu no mesmo quadro, sem pausa antes.
    expect(cargasDe('cat:c')).toBe(1);
    expect(pausas).toEqual([]);
    vi.mocked(audioEngine.faixaPreCarregada).mockImplementation(() => null);
  });
});
