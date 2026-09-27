/**
 * RETOMAR SOZINHO AO REABRIR — e o que fazer quando o navegador recusa.
 *
 * O pedido: depois de uma atualização (ou um recarregar qualquer) com a
 * música tocando, ela precisa voltar TOCANDO, no ponto exato — não só
 * carregada e pausada esperando um clique qualquer.
 *
 * O boot já tentava isso (ver `prepararRetomadaTocando`/`readResume` em
 * `playerStore.ts`), mas o `play()` automático nasce SEM gesto do usuário, e a
 * política de autoplay do navegador recusa exatamente esse caso — Chrome com
 * Media Engagement baixo, qualquer PWA não instalado, e sempre no iOS. A
 * recusa chegava como `error{kind:'play'}`, e o player respondia como se
 * fosse um defeito: parava, e mostrava um toast vermelho pedindo para "tocar
 * na página e tentar de novo" — para um retomar que a PESSOA nem pediu ainda.
 *
 * Aqui se prende o comportamento novo: o boot marca esta tentativa como
 * "sou eu tentando sozinho" (`armarRetomandoAoAbrir`), e só ELA — nunca um
 * play pedido de verdade — vira convite discreto (`resumeInvite`) em vez de
 * erro. A faixa fica carregada e no PONTO CERTO de qualquer jeito; só falta o
 * toque. E se o som voltar por qualquer caminho (o convite, ou um toque em
 * QUALQUER lugar da página — ver o evento `unlocked` do motor), o convite some
 * sozinho.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

type Handler = (payload: unknown) => void;

vi.mock('@/lib/audio/AudioEngine', () => {
  /** Uma engine nova a cada `import()` — o boot lê `resume` uma vez só, então
   *  cada teste precisa do seu próprio motor, sem handlers do teste anterior. */
  function criarEngine() {
    const handlers = new Map<string, Handler[]>();
    return {
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
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => undefined;
      }),
      off: vi.fn(),
      destroy: vi.fn(),
      analyser: null,
      currentTrack: null as { id: string } | null,
      isPlaying: false,
      /** Só para o teste: dispara os ouvintes que `initPlayerEngine` registrou. */
      _emit(event: string, payload: unknown) {
        for (const h of handlers.get(event) ?? []) h(payload);
      },
    };
  }
  return { audioEngine: criarEngine(), AudioEngine: class {} };
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
vi.mock('@/lib/reco/radio', () => ({ construirRadio: () => [] }));

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

const track = makeTrack('local:a', { title: 'A' });

/** Deixa as continuações assíncronas de `loadIndex` chegarem ao fim. */
const assentar = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

async function reabrirComRetomadaTocando(progress: number) {
  window.localStorage.setItem('aurial:resume', JSON.stringify({ track, progress, tocando: true }));
  const playerStoreMod = await import('@/stores/playerStore');
  const audioMod = (await import('@/lib/audio/AudioEngine')) as unknown as {
    audioEngine: { _emit: (event: string, payload: unknown) => void };
  };
  playerStoreMod.initPlayerEngine();
  await assentar();
  return { usePlayerStore: playerStoreMod.usePlayerStore, audioEngine: audioMod.audioEngine };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe('retomar sozinho ao reabrir', () => {
  it('autoplay recusado vira convite discreto — nunca erro — e preserva o ponto', async () => {
    const { usePlayerStore, audioEngine } = await reabrirComRetomadaTocando(42);

    // A faixa já chegou no ponto certo (o 'loaded' do motor busca a posição
    // salva independente de o play ter funcionado — ver `pendingResumeSeek`).
    audioEngine._emit('loaded', { track, duration: 200 });
    expect(usePlayerStore.getState().progress).toBe(42);

    // O navegador recusa o autoplay sem gesto (NotAllowedError vira este evento).
    audioEngine._emit('error', {
      message: 'Reprodução bloqueada pelo navegador — toque na página e tente novamente.',
      track,
      kind: 'play',
    });

    const s = usePlayerStore.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.resumeInvite).toBe(true); // o convite, não um erro
    expect(s.progress).toBe(42); // continua no ponto — a recusa não reinicia nada
  });

  it('tocar no convite (ou em qualquer botão de play) apaga o convite', async () => {
    const { usePlayerStore, audioEngine } = await reabrirComRetomadaTocando(10);
    audioEngine._emit('error', { message: 'x', track, kind: 'play' });
    expect(usePlayerStore.getState().resumeInvite).toBe(true);

    usePlayerStore.getState().play();

    expect(usePlayerStore.getState().resumeInvite).toBe(false);
  });

  it("evento 'unlocked' do motor sincroniza isPlaying sem esperar o toque no convite", async () => {
    const { usePlayerStore, audioEngine } = await reabrirComRetomadaTocando(10);
    audioEngine._emit('error', { message: 'x', track, kind: 'play' });
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    // A pessoa tocou em QUALQUER lugar da página — o motor conseguiu tocar
    // sozinho (ver o ouvinte de gesto pendurado em `startSlot`) e avisa.
    audioEngine._emit('unlocked', { track });

    const s = usePlayerStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.resumeInvite).toBe(false);
  });
});
