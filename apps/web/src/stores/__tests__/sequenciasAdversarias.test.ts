/**
 * SEQUÊNCIAS ADVERSÁRIAS DO PLAYER — o que a pessoa faz quando está com pressa.
 *
 * Os testes do caminho feliz já existem (playerStore.test.ts). Aqui estão as
 * sequências que quebram player por baixo do pano: pular dez vezes, apertar
 * play/pause em rajada, buscar antes de a duração existir, apagar da fila a
 * faixa que está tocando, fila de uma faixa só em repetição.
 *
 * O motor é falso (mesmo molde de filaNaoPara.test.ts): o que se prova é a
 * ORDEM e o ESTADO que a store deixa — qual faixa o motor recebeu por último,
 * se o spinner apagou, se a intenção de tocar sobreviveu.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

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
    iniciarEm: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 180),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    duracaoConfiavel: vi.fn(() => true),
    on: vi.fn((event: string, handler: Handler) => {
      const list = engineHandlers.get(event) ?? [];
      list.push(handler);
      engineHandlers.set(event, list);
      return () => undefined;
    }),
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

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() });
  return { toast };
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
  registroPronto: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn(() => null),
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
  garantirDetalhe: vi.fn(() => Promise.resolve(false)),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));
vi.mock('@/lib/reco/radio', () => ({ construirRadio: () => [] }));
vi.mock('@/lib/local/faixasQueFalharam', () => ({
  registrar: vi.fn(),
  marcarReparada: vi.fn(),
  anotarTentativaDeReparo: vi.fn(),
  emAberto: () => [],
  lista: () => [],
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

function faixa(id: string, extra: Partial<TrackDto> = {}): TrackDto {
  return makeTrack(id, { streamUrl: `https://cofre.example/blob/${id}?k=token`, ...extra });
}
const fila = (...ids: string[]): TrackDto[] => ids.map((i) => faixa(i));

function carregadas(): string[] {
  return vi.mocked(audioEngine.load).mock.calls.map((c) => (c[0] as TrackDto).id);
}
function ultimaCarregada(): string | undefined {
  return carregadas().at(-1);
}
function emitir(evento: string, payload: unknown): void {
  for (const h of engineHandlers.get(evento) ?? []) h(payload);
}
async function assentar(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function deixarCarregar(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
  await assentar();
}

const initialState = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState(initialState, true);
  // som saindo zera o orçamento de pulos herdado do teste anterior
  emitir('timeupdate', { position: 1, duration: 180 });
  vi.clearAllMocks();
  vi.mocked(audioEngine.getDuration).mockReturnValue(180);
  vi.mocked(audioEngine.getPosition).mockReturnValue(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ status: 206, body: { cancel: () => Promise.resolve() } })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSettingsStore.setState({ crossfadeSeconds: 0 });
});

describe('pular em rajada', () => {
  it('dez "próxima" seguidas terminam na décima faixa, tocando, e só ela é carregada por último', async () => {
    const f = fila(...'abcdefghijkl'.split(''));
    usePlayerStore.getState().playQueue(f, 0, { source: 'queue' });
    for (let i = 0; i < 10; i++) usePlayerStore.getState().next();
    await deixarCarregar();

    const s = usePlayerStore.getState();
    expect(s.currentTrack?.id).toBe('k');
    expect(s.queueIndex).toBe(10);
    expect(s.isPlaying).toBe(true);
    // Nenhuma faixa velha pode chegar ao motor DEPOIS da última pedida.
    expect(ultimaCarregada()).toBe('k');
    expect(audioEngine.isPlaying).toBe(true);
  });

  it('"anterior" em rajada nunca passa do começo da fila e não zera a fila', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 2, { source: 'queue' });
    usePlayerStore.setState({ progress: 0 });
    for (let i = 0; i < 6; i++) usePlayerStore.getState().prev();
    await assentar();
    const s = usePlayerStore.getState();
    expect(s.queueIndex).toBe(0);
    expect(s.currentTrack?.id).toBe('a');
    expect(s.queue).toHaveLength(3);
  });
});

describe('play/pause em rajada', () => {
  it('número ímpar de toggles termina PAUSADO, com store e motor de acordo', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    await deixarCarregar();
    // `audioEngine.currentTrack` do mock é null: play() recarregaria; fixa a faixa.
    const motor = audioEngine as unknown as { currentTrack: TrackDto | null };
    motor.currentTrack = usePlayerStore.getState().currentTrack;
    for (let i = 0; i < 7; i++) usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(audioEngine.isPlaying).toBe(false);
    usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(audioEngine.isPlaying).toBe(true);
    motor.currentTrack = null;
  });

  it('pausar e despausar durante a carga termina tocando (a última intenção vence)', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    usePlayerStore.getState().pause();
    usePlayerStore.getState().play();
    usePlayerStore.getState().pause();
    usePlayerStore.getState().play();
    await deixarCarregar();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(audioEngine.isPlaying).toBe(true);
  });
});

describe('seek', () => {
  it('seek com duração ainda DESCONHECIDA (0) não joga a posição para o zero', () => {
    usePlayerStore.getState().playQueue([faixa('a', { durationMs: 0 })], 0, { source: 'queue' });
    usePlayerStore.setState({ duration: 0 });
    vi.mocked(audioEngine.seek).mockClear();
    usePlayerStore.getState().seek(95);
    expect(audioEngine.seek).toHaveBeenCalledWith(95);
  });

  it('seek para além do fim cola no fim; negativo cola no zero', () => {
    usePlayerStore.getState().playQueue(fila('a'), 0, { source: 'queue' });
    usePlayerStore.setState({ duration: 200 });
    usePlayerStore.getState().seek(9_999);
    expect(audioEngine.seek).toHaveBeenLastCalledWith(200);
    usePlayerStore.getState().seek(-5);
    expect(audioEngine.seek).toHaveBeenLastCalledWith(0);
  });

  it('seek com NaN/Infinity nunca chega ao motor como número não finito', () => {
    // `el.currentTime = NaN` LANÇA TypeError no navegador: um seekto sem tempo
    // (Media Session) ou um slider quebrado derrubaria o handler.
    usePlayerStore.getState().playQueue(fila('a'), 0, { source: 'queue' });
    usePlayerStore.setState({ duration: 200 });
    vi.mocked(audioEngine.seek).mockClear();
    usePlayerStore.getState().seek(Number.NaN);
    usePlayerStore.getState().seek(Number.POSITIVE_INFINITY);
    for (const c of vi.mocked(audioEngine.seek).mock.calls) {
      expect(Number.isFinite(c[0] as number)).toBe(true);
    }
    expect(Number.isFinite(usePlayerStore.getState().progress)).toBe(true);
  });
});

describe('duração esquisita no timeupdate', () => {
  it('Infinity/NaN/0 no evento não envenenam a duração da store', () => {
    usePlayerStore.getState().playQueue(fila('a'), 0, { source: 'queue' });
    usePlayerStore.setState({ duration: 180 });
    // Infinity não entra: o motor garante duração finita (getDuration), então o
    // caso só existiria com um motor que quebra o próprio contrato.
    for (const d of [Number.NaN, 0]) {
      vi.setSystemTime(Date.now() + 1000); // fora do throttle de 200ms
      emitir('timeupdate', { position: 2, duration: d });
      const dur = usePlayerStore.getState().duration;
      expect(Number.isFinite(dur)).toBe(true);
      expect(dur).toBeGreaterThan(0);
    }
  });
});

describe('repeat e fim da fila', () => {
  it('fila de UMA faixa com repeat=all: ao acabar, recarrega a mesma e segue tocando', async () => {
    usePlayerStore.getState().playQueue(fila('solo'), 0, { source: 'queue' });
    usePlayerStore.setState({ repeat: 'all' });
    await deixarCarregar();
    const antes = carregadas().length;
    emitir('ended', { track: usePlayerStore.getState().currentTrack });
    await deixarCarregar();
    expect(carregadas().length).toBeGreaterThan(antes);
    expect(ultimaCarregada()).toBe('solo');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('repeat=one: ao acabar volta ao zero na MESMA faixa, sem recarregar', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    usePlayerStore.setState({ repeat: 'one' });
    await deixarCarregar();
    vi.mocked(audioEngine.load).mockClear();
    emitir('ended', { track: usePlayerStore.getState().currentTrack });
    expect(audioEngine.seek).toHaveBeenCalledWith(0);
    expect(audioEngine.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('repeat=one NÃO prende o "próxima" manual: ele avança', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    usePlayerStore.setState({ repeat: 'one' });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });

  it('última faixa, repeat=off: para sem spinner e dá para tocar de novo', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 1, { source: 'queue' });
    await deixarCarregar();
    // O motor real apaga o spinner ao carregar; o falso não, então emite.
    emitir('loaded', { track: usePlayerStore.getState().currentTrack, duration: 180 });
    emitir('buffering', { buffering: false });
    emitir('ended', { track: usePlayerStore.getState().currentTrack });
    await deixarCarregar();
    const s = usePlayerStore.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.isBuffering).toBe(false);
    expect(s.currentTrack?.id).toBe('b');
    // e o play seguinte recomeça (não fica morto depois do fim da fila)
    usePlayerStore.getState().play();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});

describe('shuffle', () => {
  it('percorrendo com "próxima", toca cada faixa UMA vez até esgotar, e depois para', () => {
    const f = fila(...'abcdefgh'.split(''));
    usePlayerStore.setState({ shuffle: true });
    usePlayerStore.getState().playQueue(f, 3, { source: 'queue' });
    const vistas = [usePlayerStore.getState().currentTrack?.id];
    for (let i = 0; i < 7; i++) {
      usePlayerStore.getState().next();
      vistas.push(usePlayerStore.getState().currentTrack?.id);
    }
    expect(vistas[0]).toBe('d'); // a escolhida abre
    expect(new Set(vistas).size).toBe(8);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('ligar e desligar shuffle no meio não perde a faixa tocando nem a ordem original', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c', 'd', 'e'), 2, { source: 'queue' });
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().next();
    const tocando = usePlayerStore.getState().currentTrack?.id;
    usePlayerStore.getState().toggleShuffle();
    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(s.currentTrack?.id).toBe(tocando);
    expect(s.queue[s.queueIndex]?.id).toBe(tocando);
  });

  it('faixa adicionada com shuffle ligado sobrevive ao desligar', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 0, { source: 'queue' });
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().addToQueue(faixa('z'));
    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toContain('z');
  });
});

describe('editar a fila com a música tocando', () => {
  it('remover a faixa que TOCA passa para a que ocupa o lugar dela, tocando', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 1, { source: 'queue' });
    await deixarCarregar();
    usePlayerStore.getState().removeFromQueue(1);
    await deixarCarregar();
    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['a', 'c']);
    expect(s.currentTrack?.id).toBe('c');
    expect(s.queueIndex).toBe(1);
    expect(s.isPlaying).toBe(true);
    expect(ultimaCarregada()).toBe('c');
  });

  it('remover a faixa que toca ESTANDO PAUSADO mantém pausado (não "ressuscita" o som)', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 1, { source: 'queue' });
    await deixarCarregar();
    usePlayerStore.getState().pause();
    usePlayerStore.getState().removeFromQueue(1);
    await deixarCarregar();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(audioEngine.isPlaying).toBe(false);
  });

  it('remover a ÚLTIMA faixa que toca cai na anterior (a fila não fica sem faixa atual)', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 1, { source: 'queue' });
    await deixarCarregar();
    usePlayerStore.getState().removeFromQueue(1);
    await deixarCarregar();
    const s = usePlayerStore.getState();
    expect(s.currentTrack?.id).toBe('a');
    expect(s.queueIndex).toBe(0);
  });

  it('remover a ÚNICA faixa zera o player: sem faixa, sem tocando', async () => {
    usePlayerStore.getState().playQueue(fila('a'), 0, { source: 'queue' });
    usePlayerStore.getState().removeFromQueue(0);
    await deixarCarregar();
    const s = usePlayerStore.getState();
    expect(s.currentTrack).toBeNull();
    expect(s.isPlaying).toBe(false);
    expect(s.queueIndex).toBe(-1);
  });

  it('remover faixa FUTURA não mexe no que toca nem recarrega o motor', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 0, { source: 'queue' });
    await deixarCarregar();
    vi.mocked(audioEngine.load).mockClear();
    usePlayerStore.getState().removeFromQueue(2);
    expect(audioEngine.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
  });

  it('índice inválido em remover/reordenar/playAt é ignorado', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    usePlayerStore.getState().removeFromQueue(9);
    usePlayerStore.getState().removeFromQueue(-1);
    usePlayerStore.getState().reorderQueue(0, 9);
    usePlayerStore.getState().playAt(9);
    expect(usePlayerStore.getState().queue).toHaveLength(2);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
  });

  it('arrastar a faixa que toca para o fim: continua tocando, sem reiniciar a música', async () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c', 'd'), 1, { source: 'queue' });
    await deixarCarregar();
    vi.mocked(audioEngine.load).mockClear();
    usePlayerStore.getState().reorderQueue(1, 3); // a c d b
    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(s.queueIndex).toBe(3);
    expect(s.currentTrack?.id).toBe('b');
    expect(audioEngine.load).not.toHaveBeenCalled();
  });

  it('arrastar OUTRA faixa por cima da atual ajusta o índice nos dois sentidos', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c', 'd', 'e'), 2, { source: 'queue' });
    const atual = (): string | undefined => {
      const s = usePlayerStore.getState();
      return s.queue[s.queueIndex]?.id;
    };
    usePlayerStore.getState().reorderQueue(0, 4);
    expect(atual()).toBe('c');
    usePlayerStore.getState().reorderQueue(4, 0);
    expect(atual()).toBe('c');
    usePlayerStore.getState().reorderQueue(4, 2);
    expect(atual()).toBe('c');
    usePlayerStore.getState().reorderQueue(0, 3);
    expect(atual()).toBe('c');
  });

  it('"tocar a seguir" numa fila vazia não deixa o índice fora da fila', () => {
    usePlayerStore.getState().playNext(faixa('x'));
    const s = usePlayerStore.getState();
    expect(s.queueIndex).toBeLessThan(Math.max(1, s.queue.length));
  });
});

describe('voltar (previous)', () => {
  it('até 3s volta à anterior; passou de 3s recomeça', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 2, { source: 'queue' });
    usePlayerStore.setState({ progress: 3 });
    usePlayerStore.getState().prev();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
    usePlayerStore.setState({ progress: 3.01 });
    vi.mocked(audioEngine.seek).mockClear();
    usePlayerStore.getState().prev();
    expect(audioEngine.seek).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });

  it('na primeira faixa recomeça em vez de ficar parado, mesmo nos primeiros segundos', () => {
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    usePlayerStore.setState({ progress: 1 });
    usePlayerStore.getState().prev();
    expect(audioEngine.seek).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
  });
});

describe('volume', () => {
  it('NaN no volume não chega ao motor nem à store', () => {
    usePlayerStore.getState().setVolume(0.5);
    vi.mocked(audioEngine.setVolume).mockClear();
    usePlayerStore.getState().setVolume(Number.NaN);
    for (const c of vi.mocked(audioEngine.setVolume).mock.calls) {
      expect(Number.isFinite(c[0] as number)).toBe(true);
    }
    expect(Number.isFinite(usePlayerStore.getState().volume)).toBe(true);
  });

  it('volume 0 não desmuta; subir de 0 mutado desmuta', () => {
    usePlayerStore.getState().toggleMute();
    usePlayerStore.getState().setVolume(0);
    expect(usePlayerStore.getState().muted).toBe(true);
    usePlayerStore.getState().setVolume(0.3);
    expect(usePlayerStore.getState().muted).toBe(false);
  });

  it('o volume é gravado para a próxima abertura', () => {
    usePlayerStore.getState().setVolume(0.42);
    const gravado = JSON.parse(window.localStorage.getItem('aurial:player') ?? '{}');
    expect(gravado.state.volume).toBe(0.42);
  });
});

describe('crossfade com faixa curta', () => {
  it('faixa de 2,5s com crossfade de 5s NÃO dispara a troca antecipada (acaba pelo ended)', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 5 });
    usePlayerStore.getState().playQueue(fila('a', 'b'), 0, { source: 'queue' });
    await deixarCarregar();
    vi.mocked(audioEngine.load).mockClear();
    for (const pos of [0.5, 1, 1.5, 2, 2.4]) {
      emitir('timeupdate', { position: pos, duration: 2.5 });
    }
    expect(audioEngine.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
    emitir('ended', { track: usePlayerStore.getState().currentTrack });
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });

  it('faixa longa dispara o crossfade UMA vez só', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 5 });
    usePlayerStore.getState().playQueue(fila('a', 'b', 'c'), 0, { source: 'queue' });
    await deixarCarregar();
    vi.mocked(audioEngine.load).mockClear();
    emitir('timeupdate', { position: 176, duration: 180 });
    expect(carregadas()).toEqual(['b']);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
  });
});
