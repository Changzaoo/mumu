/**
 * A FILA TEM QUE ANDAR COM A TELA APAGADA — sem depender de relógio repetido.
 *
 * O avanço de faixa tinha duas pernas, e as duas dependem de o navegador nos
 * dar atenção: o evento 'ended' do elemento e o polling de `timeupdate`. Com a
 * tela desligada o sistema estrangula temporizador repetido — o heartbeat de 1s
 * vira um por minuto, ou some — e o rAF que alimenta o `timeupdate` congela de
 * vez. A música acabava e ficava tudo em silêncio até alguém acender a tela.
 *
 * A terceira perna é um temporizador ÚNICO e DISTANTE, armado quando a faixa
 * carrega e mirado um instante antes do fim dela. Ele existia, mas era pulado
 * justamente para quem usa CROSSFADE — nesse caso o avanço voltava a pendurar-se
 * no `timeupdate`, ou seja, no relógio que o sistema desliga.
 *
 * O que estes testes prendem, e o jeito como prendem importa: eles NÃO emitem
 * 'ended' e NÃO emitem 'timeupdate'. Se a fila andar mesmo assim, ela andou sem
 * o relógio que o segundo plano tira da gente — que é exatamente a garantia
 * pedida. Um teste que emitisse 'timeupdate' passaria sem provar nada.
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
};

function posicaoAtual(): number {
  if (!engineState.currentTrack) return 0;
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
    getPosition: vi.fn(() => posicaoAtual()),
    getDuration: vi.fn(() => engineState.duration),
    getBufferedEnd: vi.fn(() => 1),
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
import { useSettingsStore } from '@/stores/settingsStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const emit = (event: string, payload: unknown): void => {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
};

const DURACAO = 180;

function fila(n: number): TrackDto[] {
  return Array.from({ length: n }, (_, i) =>
    makeTrack(`cat:${i}`, { streamUrl: `https://exemplo/${i}.mp3`, durationMs: DURACAO * 1000 }),
  );
}

/** Apaga (ou acende) a tela do ponto de vista da página. */
function telaApagada(apagada: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: apagada });
}

/**
 * Põe a fila para tocar e deixa a faixa atual carregada, como depois de um
 * 'loaded' real — é o 'loaded' que arma os temporizadores.
 */
async function comecarAtocar(tracks: TrackDto[]): Promise<void> {
  // OS TEMPORIZADORES FALSOS ENTRAM ANTES DO 'loaded', e a ordem é o teste.
  //
  // É o 'loaded' que arma a troca antecipada. Ligar o relógio falso depois dele
  // deixava o `setTimeout` marcado no relógio DE VERDADE, e `advanceTimersByTime`
  // não tinha o que disparar: a fila não andava e a suíte culpava o produto por
  // um erro de encenação.
  vi.useFakeTimers();
  usePlayerStore.getState().playQueue(tracks, 0);
  // A carga resolve a fonte com `await` antes de chamar o engine — sem dar essa
  // volta, o 'loaded' abaixo chegaria antes de existir faixa atual.
  await vi.advanceTimersByTimeAsync(50);
  expect(audioEngine.load).toHaveBeenCalled();
  engineState.duration = DURACAO;
  engineState.comecouEm = Date.now();
  emit('loaded', { track: usePlayerStore.getState().currentTrack, duration: DURACAO });
}

const initialState = usePlayerStore.getState();
const settingsIniciais = useSettingsStore.getState();

beforeEach(() => {
  vi.useRealTimers();
  usePlayerStore.setState(initialState, true);
  useSettingsStore.setState(settingsIniciais, true);
  vi.clearAllMocks();
  // NÃO limpar `engineHandlers`: quem os registrou foi `initPlayerEngine`, uma
  // vez só, na carga do módulo. Zerar aqui desligava o player do engine e o
  // 'loaded' nunca chegava — os temporizadores não eram armados e o teste
  // reprovava o produto por um defeito do próprio teste.
  engineState.playing = true;
  engineState.duration = 0;
  engineState.comecouEm = 0;
  engineState.currentTrack = null;
  telaApagada(false);
});

initPlayerEngine();

describe('avanço de faixa com a tela apagada', () => {
  it('passa para a próxima sem "ended" e sem "timeupdate"', async () => {
    telaApagada(true);
    const tracks = fila(3);
    await comecarAtocar(tracks);

    // O playhead anda sozinho enquanto o relógio corre — como o áudio de
    // verdade faz, sem nos avisar, porque é o aviso que o segundo plano corta.
    await vi.advanceTimersByTimeAsync(DURACAO * 1000);

    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:1');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('a próxima começa ANTES de a atual acabar — é isso que salva a sessão', async () => {
    // O sistema entende silêncio como "este app parou de tocar" e derruba a
    // sessão de mídia; o play() seguinte é recusado por política de autoplay.
    // Por isso a troca tem que acontecer com a atual ainda saindo.
    telaApagada(true);
    const tracks = fila(2);
    await comecarAtocar(tracks);

    // Ainda falta quase um segundo de música: se a troca só acontecesse no fim,
    // nada teria sido carregado neste ponto.
    await vi.advanceTimersByTimeAsync((DURACAO - 0.8) * 1000);

    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:1');
  });

  it('com crossfade configurado a fila TAMBÉM anda', async () => {
    // Este era o buraco: a troca antecipada era pulada quando havia crossfade,
    // e o avanço voltava a depender do 'timeupdate' — o relógio que o segundo
    // plano desliga. Quem usava crossfade ficava sem música no bolso.
    useSettingsStore.setState({ crossfadeSeconds: 6 });
    telaApagada(true);
    const tracks = fila(3);
    await comecarAtocar(tracks);

    await vi.advanceTimersByTimeAsync(DURACAO * 1000);

    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('o crossfade pedido vira a antecedência, não é encurtado', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 6 });
    telaApagada(true);
    const tracks = fila(2);
    await comecarAtocar(tracks);

    // Um instante depois de faltar 6s: a troca já tem que ter acontecido, senão
    // a mistura sairia menor que a que a pessoa configurou.
    await vi.advanceTimersByTimeAsync((DURACAO - 5.5) * 1000);

    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:1');
    const ultimaCarga = vi.mocked(audioEngine.load).mock.calls.at(-1);
    expect((ultimaCarga?.[1] as { crossfadeSeconds?: number })?.crossfadeSeconds).toBe(6);
  });

  it('com a tela ACESA não antecipa: o gapless de álbum continua intacto', async () => {
    telaApagada(false);
    const tracks = fila(2);
    await comecarAtocar(tracks);

    await vi.advanceTimersByTimeAsync((DURACAO - 0.5) * 1000);

    // Nada de cortar o fim da faixa quando o 'ended' nativo pode fazer melhor.
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:0');
  });

  it('na última faixa sem repetição não inventa uma próxima', async () => {
    telaApagada(true);
    const tracks = fila(1);
    await comecarAtocar(tracks);

    await vi.advanceTimersByTimeAsync(DURACAO * 1000);

    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:0');
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('pausado com a tela apagada, a fila NÃO anda sozinha', async () => {
    telaApagada(true);
    const tracks = fila(3);
    await comecarAtocar(tracks);

    usePlayerStore.setState({ isPlaying: false });
    engineState.playing = false;

    await vi.advanceTimersByTimeAsync(DURACAO * 1000);

    // Pausa é pausa. Avançar aqui seria o player ligando sozinho no bolso.
    expect(usePlayerStore.getState().currentTrack?.id).toBe('cat:0');
  });
});
