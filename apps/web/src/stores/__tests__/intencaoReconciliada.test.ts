/**
 * RF1 — O QUE A PESSOA QUIS GANHA DO QUE ESTAVA COMBINADO.
 *
 * Carregar uma faixa `local:` não é instantâneo: a store espera os cofres
 * locais hidratarem e, se preciso, busca o endereço vivo no acervo. Isso é
 * meio segundo em rede boa e vários segundos em rede de celular — e durante
 * essa espera a pessoa continua com o dedo na tela.
 *
 * O defeito estava em decidir no COMEÇO da transição o que só se pode decidir
 * no FIM. `loadIndex` capturava `autoplay` e, ao terminar a espera, mandava o
 * motor tocar com o valor de antes. Quem apertasse pause durante o
 * carregamento via o pior estado possível do player:
 *
 *   - a música COMEÇAVA a tocar, porque o motor recebeu `autoplay: true`;
 *   - a tela dizia PAUSADO, porque `pause()` já tinha escrito `isPlaying:false`;
 *   - apertar pause de novo não fazia nada visível — a interface já estava no
 *     estado que o botão produz.
 *
 * A regra que estes testes prendem: a store guarda a INTENÇÃO (`querTocar`) e
 * reconcilia no fim de cada transição. Junto vem o token de geração — uma carga
 * que já foi substituída por outra não fala mais, nem para tocar nem para parar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/audio/AudioEngine', () => {
  let tocando = false;
  const engine = {
    load: vi.fn((_t: TrackDto, o?: { autoplay?: boolean }) => {
      tocando = o?.autoplay !== false;
    }),
    play: vi.fn(() => {
      tocando = true;
    }),
    pause: vi.fn(() => {
      tocando = false;
    }),
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
    on: vi.fn(() => () => undefined),
    off: vi.fn(),
    destroy: vi.fn(),
    unlock: vi.fn(),
    currentTrack: null,
    analyser: null,
    get isPlaying(): boolean {
      return tocando;
    },
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: undefined })) },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));
vi.mock('@/lib/audio/mediaSession', () => ({ initMediaSession: vi.fn() }));

vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => 'https://cofre.example/blob/x?k=vivo'),
  reportDeadRemote: vi.fn(),
  sourceUrlFor: vi.fn(() => null),
  setTrackDuration: vi.fn(),
}));
vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasDownloadedAudio: vi.fn(() => false),
  ensureDownloadedAudioUrl: vi.fn(() => Promise.resolve(null)),
  rebaixarAoFalhar: vi.fn(),
}));
vi.mock('@/lib/local/detalheDaFaixa', () => ({
  garantirDetalhe: vi.fn(() => Promise.resolve(true)),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

/** Faixa `local:` sem áudio no aparelho: o caminho que ESPERA antes de tocar. */
function faixaLocal(id = 'local:x'): TrackDto {
  return makeTrack(id, { streamUrl: null });
}

/** Com que `autoplay` o motor foi mandado carregar da última vez. */
function autoplayDaUltimaCarga(): boolean | undefined {
  const chamada = vi.mocked(audioEngine.load).mock.calls.at(-1);
  return (chamada?.[1] as { autoplay?: boolean } | undefined)?.autoplay;
}

const initialState = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
});

describe('a intenção da pessoa é reconciliada no fim da transição', () => {
  it('pause DURANTE o carregamento termina pausado', async () => {
    usePlayerStore.getState().playTrack(faixaLocal(), { source: 'library' });

    // O dedo chega antes da rede. A partir daqui a intenção é NÃO tocar.
    usePlayerStore.getState().pause();

    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    // ANTES: o motor recebia `autoplay: true` (capturado no começo) e a música
    // começava com a tela dizendo "pausado".
    expect(autoplayDaUltimaCarga()).toBe(false);
    expect(audioEngine.isPlaying).toBe(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('play DURANTE o carregamento termina tocando', async () => {
    usePlayerStore.getState().playTrack(faixaLocal(), { source: 'library' });
    usePlayerStore.getState().pause();
    usePlayerStore.getState().play();

    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(true));

    expect(audioEngine.isPlaying).toBe(true);
  });

  it('a carga velha não fala mais depois que outra faixa foi pedida', async () => {
    const player = usePlayerStore.getState();
    player.playTrack(faixaLocal('local:a'), { source: 'library' });
    player.playTrack(faixaLocal('local:b'), { source: 'library' });

    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());
    // Deixa qualquer continuação atrasada tentar falar.
    await new Promise((r) => setTimeout(r, 0));

    const carregadas = vi.mocked(audioEngine.load).mock.calls.map((c) => (c[0] as TrackDto).id);
    expect(carregadas).not.toContain('local:a');
    expect(usePlayerStore.getState().currentTrack?.id).toBe('local:b');
  });
});
