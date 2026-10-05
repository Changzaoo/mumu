/**
 * DO TOQUE AO SOM — o que foi tirado do caminho, e o que continua no instante certo.
 *
 * Medição (Moto G34 emulado): play -> som 1,9 s; "próxima" -> som 1,9 s; 1,2 s de
 * tarefas longas depois do toque; progresso gravado e `tick` a 60 Hz. Este arquivo
 * prende o conserto:
 *
 *  1. a SEGUINTE já está resolvida (fonte viva) e pré-carregada quando a atual
 *     passa dos primeiros segundos — inclusive logo depois de uma "próxima" manual;
 *  2. promover a pré-carga é SÍNCRONO: `load()` sai no mesmo quadro do toque, sem
 *     esperar cofre local, `GET /catalogo` nem alça de blob;
 *  3. quando não há pré-carga, os dois cofres locais e a resolução remota correm
 *     EM PARALELO (não mais em série);
 *  4. telemetria, letra, guardião e rádio esperam o som (com teto), e só roda o
 *     lote da faixa que ainda é a atual;
 *  5. o crossfade dispara no instante exato por UM temporizador, sem 60 Hz;
 *  6. a retomada é gravada no máximo 1x por janela — e SEMPRE no pause, na
 *     mudança de visibilidade e no `pagehide`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

const mocks = vi.hoisted(() => ({
  queueLyricsSync: vi.fn(),
  prefetchLyrics: vi.fn(),
  aquecerCalibracao: vi.fn(),
  informarContexto: vi.fn(),
}));

/** Estado do motor de mentira (posição anda com o relógio falso). */
const motor = {
  atual: null as TrackDto | null,
  preCarregada: null as TrackDto | null,
  tocando: false,
  posicaoInicial: 6,
  t0: 0,
};
const posicao = (): number => motor.posicaoInicial + (Date.now() - motor.t0) / 1000;

vi.mock('@/lib/audio/AudioEngine', () => {
  const engine = {
    load: vi.fn((t: TrackDto, o?: { autoplay?: boolean }) => {
      if (motor.preCarregada?.id === t.id) motor.preCarregada = null; // promovida
      motor.atual = t;
      motor.t0 = Date.now();
      motor.tocando = o?.autoplay !== false;
    }),
    play: vi.fn(() => {
      motor.tocando = true;
    }),
    pause: vi.fn(() => {
      motor.tocando = false;
    }),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn((t: TrackDto | null) => {
      motor.preCarregada = t;
    }),
    faixaPreCarregada: vi.fn((id: string) =>
      motor.preCarregada?.id === id ? motor.preCarregada : null,
    ),
    slotOciosoLivre: vi.fn(() => motor.preCarregada === null),
    duracaoConfiavel: vi.fn(() => true),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    setLocalSourceResolver: vi.fn(),
    iniciarEm: vi.fn(),
    getPosition: vi.fn(() => posicao()),
    getDuration: vi.fn(() => 180),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    on: vi.fn((event: string, handler: Handler) => {
      const lista = engineHandlers.get(event) ?? [];
      lista.push(handler);
      engineHandlers.set(event, lista);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    unlock: vi.fn(),
    get currentTrack(): TrackDto | null {
      return motor.atual;
    },
    analyser: null,
    get isPlaying(): boolean {
      return motor.tocando;
    },
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

/** Ids cujo `GET /catalogo/:id` já voltou: só então o registro conhece o endereço. */
const detalhados = new Set<string>();
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  registroPronto: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: vi.fn((id: string) =>
    detalhados.has(id) ? `https://cofre.example/blob/${id}?k=token` : null,
  ),
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
  garantirDetalhe: vi.fn((id: string) => {
    detalhados.add(id);
    return Promise.resolve(true);
  }),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
  aquecerFontes: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/reco/radio', () => ({ construirRadio: () => [] }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: mocks.queueLyricsSync }));
vi.mock('@/lib/lyrics/lyrics', () => ({ prefetchLyrics: mocks.prefetchLyrics }));
vi.mock('@/lib/lyrics/calibragem', () => ({ aquecerCalibracao: mocks.aquecerCalibracao }));
vi.mock('@/lib/offline/guardiaoOffline', () => ({
  informarContexto: mocks.informarContexto,
  informarCarregando: vi.fn(),
}));
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
import { ensureDownloadedAudioUrl } from '@/features/downloads/downloadManager';
import { ensureLocalAudioUrl } from '@/lib/local/localLibrary';
import { garantirDetalhe } from '@/lib/local/detalheDaFaixa';
import { makeTrack } from '@/test/factories';

/** Faixa do acervo local SEM endereço — a entrada magra, que precisa de `GET /catalogo`. */
function magra(id: string): TrackDto {
  return makeTrack(`local:${id}`, { streamUrl: '' });
}
/** Faixa de catálogo (não `local:`): a `streamUrl` que veio é a única. */
function catalogo(id: string): TrackDto {
  return makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3` });
}

const initialState = usePlayerStore.getState();
initPlayerEngine();

function emitir(evento: string, payload: unknown): void {
  for (const handler of engineHandlers.get(evento) ?? []) handler(payload);
}
const timeupdate = (position: number): void => emitir('timeupdate', { position, duration: 180 });

async function assentar(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function carregadas(): string[] {
  return vi.mocked(audioEngine.load).mock.calls.map((c) => (c[0] as TrackDto).id);
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState(initialState, true);
  useSettingsStore.setState({ crossfadeSeconds: 0 });
  vi.clearAllMocks();
  detalhados.clear();
  motor.atual = null;
  motor.preCarregada = null;
  motor.tocando = false;
  motor.posicaoInicial = 6;
  motor.t0 = Date.now();
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ status: 206, body: { cancel: () => Promise.resolve() } })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('a seguinte já está pronta quando a atual começa', () => {
  it('resolve a fonte da seguinte e pré-carrega o elemento depois dos primeiros segundos', async () => {
    usePlayerStore.getState().playQueue([magra('a1'), magra('b1'), magra('c1')], 0);
    await assentar();
    expect(carregadas()).toEqual(['local:a1']);
    vi.mocked(garantirDetalhe).mockClear();
    motor.posicaoInicial = 1; // a faixa acabou de começar a soar
    motor.t0 = Date.now();

    timeupdate(1); // saiu som: começa a preparar a seguinte
    await assentar();
    // Resolvida durante a atual — o `GET /catalogo/b1` já foi, antes de qualquer toque.
    expect(garantirDetalhe).toHaveBeenCalledWith('local:b1');
    // Antes de PRECARGA_APOS_S o elemento ainda não é pedido (a atual tem a banda).
    timeupdate(2);
    expect(audioEngine.preloadNext).not.toHaveBeenCalled();

    motor.posicaoInicial = 6;
    motor.t0 = Date.now();
    timeupdate(6);
    expect(audioEngine.preloadNext).toHaveBeenCalledTimes(1);
    const entregue = vi.mocked(audioEngine.preloadNext).mock.calls[0]?.[0] as TrackDto;
    expect(entregue.id).toBe('local:b1');
    // A fonte VIVA, não a foto vazia da fila — sem isto o motor nem criava o slot.
    expect(entregue.streamUrl).toContain('/blob/local:b1');
    // Uma só à frente: pulsos seguintes não pedem de novo nem abrem a terceira.
    timeupdate(7);
    timeupdate(8);
    expect(audioEngine.preloadNext).toHaveBeenCalledTimes(1);
    expect(garantirDetalhe).not.toHaveBeenCalledWith('local:c1');
  });

  it('"próxima" com a seguinte pré-carregada: load() sai SÍNCRONO, sem refazer a resolução', async () => {
    usePlayerStore.getState().playQueue([magra('a2'), magra('b2'), magra('c2')], 0);
    await assentar();
    timeupdate(1);
    await assentar();
    timeupdate(6);
    expect(motor.preCarregada?.id).toBe('local:b2');

    vi.mocked(garantirDetalhe).mockClear();
    vi.mocked(ensureLocalAudioUrl).mockClear();
    vi.mocked(ensureDownloadedAudioUrl).mockClear();
    vi.mocked(audioEngine.load).mockClear();

    usePlayerStore.getState().next();
    // SEM `await`: o play() tem que ter sido pedido no mesmo quadro do toque.
    expect(carregadas()).toEqual(['local:b2']);
    expect(garantirDetalhe).not.toHaveBeenCalled();
    expect(ensureLocalAudioUrl).not.toHaveBeenCalled();
    expect(ensureDownloadedAudioUrl).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('local:b2');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    // A foto da fila ganhou o endereço vivo (o fallback e a retomada precisam dele).
    expect(usePlayerStore.getState().queue[1]?.streamUrl).toContain('/blob/local:b2');
  });

  it('depois de uma "próxima" manual, a SEGUINTE já é preparada assim que a nova soa', async () => {
    usePlayerStore.getState().playQueue([magra('a3'), magra('b3'), magra('c3')], 0);
    await assentar();
    timeupdate(1);
    await assentar();
    timeupdate(6);
    usePlayerStore.getState().next();

    vi.mocked(garantirDetalhe).mockClear();
    timeupdate(1); // b3 soando
    await assentar();
    expect(garantirDetalhe).toHaveBeenCalledWith('local:c3');
    timeupdate(6);
    expect(motor.preCarregada?.id).toBe('local:c3');
  });

  it('slot ocioso ocupado: a pré-carga antecipada NÃO derruba o que lá está', async () => {
    usePlayerStore.getState().playQueue([magra('a4'), magra('b4'), magra('c4')], 0);
    await assentar();
    motor.preCarregada = makeTrack('fantasma'); // a anterior ainda saindo / pré-carga velha
    timeupdate(1);
    await assentar();
    timeupdate(6);
    expect(audioEngine.preloadNext).not.toHaveBeenCalled();
    expect(motor.preCarregada?.id).toBe('fantasma');
  });

  it('sem pré-carga a fonte morta cai no caminho completo (não promove elemento falho)', async () => {
    vi.mocked(audioEngine.faixaPreCarregada).mockReturnValueOnce(null); // `falhouAoCarregar`
    usePlayerStore.getState().playQueue([magra('a5'), magra('b5')], 0);
    await assentar();
    vi.mocked(audioEngine.load).mockClear();
    usePlayerStore.getState().next();
    expect(carregadas()).toEqual([]); // ainda resolvendo: caminho completo, assíncrono
    await assentar();
    expect(carregadas()).toEqual(['local:b5']);
  });
});

describe('sem pré-carga, a resolução corre em paralelo', () => {
  it('cofre baixado e resolução remota começam sem esperar o cofre local responder', async () => {
    // O cofre local PENDURA: antes, o baixado e o `GET /catalogo` só começavam depois dele.
    vi.mocked(ensureLocalAudioUrl).mockImplementation(() => new Promise(() => undefined));
    usePlayerStore.getState().playQueue([magra('p1')], 0);
    await assentar();
    expect(ensureLocalAudioUrl).toHaveBeenCalledWith('local:p1');
    expect(ensureDownloadedAudioUrl).toHaveBeenCalledWith('local:p1');
    expect(garantirDetalhe).toHaveBeenCalledWith('local:p1');
    expect(carregadas()).toEqual([]); // ninguém pulou etapa: o load espera o cofre local
    vi.mocked(ensureLocalAudioUrl).mockImplementation(() => Promise.resolve(null));
  });

  it('faixa de catálogo não vai ao cofre local (só guarda `local:`), e toca da streamUrl', async () => {
    usePlayerStore.getState().playQueue([catalogo('cat1')], 0);
    await assentar();
    expect(ensureLocalAudioUrl).not.toHaveBeenCalled();
    expect(carregadas()).toEqual(['cat1']);
  });
});

describe('o que não é som espera o som', () => {
  it('letra, calibração, guardião e transcrição só rodam depois do primeiro som', async () => {
    usePlayerStore.getState().playQueue([catalogo('d1'), catalogo('d2')], 0);
    await assentar();
    await vi.advanceTimersByTimeAsync(1_000);
    await assentar();
    // Antes do som: nada disso disputou a thread com o play().
    expect(mocks.queueLyricsSync).not.toHaveBeenCalled();
    expect(mocks.prefetchLyrics).not.toHaveBeenCalled();
    expect(mocks.aquecerCalibracao).not.toHaveBeenCalled();
    expect(mocks.informarContexto).not.toHaveBeenCalled();

    timeupdate(1);
    await vi.advanceTimersByTimeAsync(200); // ociosidade
    await assentar();
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.queueLyricsSync).toHaveBeenCalledTimes(1);
    expect(mocks.prefetchLyrics).toHaveBeenCalledTimes(1);
    expect(mocks.aquecerCalibracao).toHaveBeenCalledTimes(1);
    expect(mocks.informarContexto).toHaveBeenCalledTimes(1);
  });

  it('se o som não sai, o lote roda assim mesmo no teto (a fila não depende da 1ª faixa)', async () => {
    usePlayerStore.getState().playQueue([catalogo('e1'), catalogo('e2')], 0);
    await assentar();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.queueLyricsSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500); // teto de 4 s + ociosidade
    await assentar();
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.queueLyricsSync).toHaveBeenCalledTimes(1);
  });

  it('numa sequência de "próxima" só a faixa que ficou paga o trabalho', async () => {
    usePlayerStore.getState().playQueue([catalogo('f1'), catalogo('f2'), catalogo('f3')], 0);
    await assentar();
    usePlayerStore.getState().next();
    await assentar();
    usePlayerStore.getState().next();
    await assentar();
    timeupdate(1);
    await vi.advanceTimersByTimeAsync(300);
    await assentar();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.queueLyricsSync).toHaveBeenCalledTimes(1);
    expect((mocks.queueLyricsSync.mock.calls[0]?.[0] as TrackDto).id).toBe('f3');
  });
});

describe('crossfade no instante exato, sem 60 Hz', () => {
  it('um temporizador único dispara a mistura a `crossfadeSeconds` do fim, sem nenhum timeupdate', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 4 });
    motor.posicaoInicial = 170; // 10 s do fim de 180 s
    usePlayerStore.getState().playQueue([catalogo('g1'), catalogo('g2')], 0);
    await assentar();
    motor.t0 = Date.now();
    emit_loaded();
    vi.mocked(audioEngine.load).mockClear();

    // 5,9 s depois (faltam 4,1 s): ainda não. Nenhum 'timeupdate' foi emitido —
    // quem decide é só o temporizador.
    await vi.advanceTimersByTimeAsync(5_900);
    expect(carregadas()).toEqual([]);
    // Em 6,0 s faltam exatamente 4 s.
    await vi.advanceTimersByTimeAsync(150);
    expect(carregadas()).toEqual(['g2']);
    expect(vi.mocked(audioEngine.load).mock.calls[0]?.[1]).toMatchObject({
      autoplay: true,
      crossfadeSeconds: 4,
    });
    expect(usePlayerStore.getState().currentTrack?.id).toBe('g2');
  });

  it('pausar cancela o disparo; retomar rearma com o "quanto falta" de agora', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 4 });
    motor.posicaoInicial = 170;
    usePlayerStore.getState().playQueue([catalogo('h1'), catalogo('h2')], 0);
    await assentar();
    motor.t0 = Date.now();
    emit_loaded();
    vi.mocked(audioEngine.load).mockClear();

    usePlayerStore.getState().pause();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(carregadas()).toEqual([]); // pausada: nada de misturar sozinha
  });

  it('seek para perto do fim remira o alvo', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 4 });
    motor.posicaoInicial = 10;
    usePlayerStore.getState().playQueue([catalogo('i1'), catalogo('i2')], 0);
    await assentar();
    motor.t0 = Date.now();
    emit_loaded();
    vi.mocked(audioEngine.load).mockClear();

    motor.posicaoInicial = 175; // buscou para 5 s do fim
    motor.t0 = Date.now();
    usePlayerStore.getState().seek(175);
    await vi.advanceTimersByTimeAsync(900);
    expect(carregadas()).toEqual([]);
    await vi.advanceTimersByTimeAsync(250); // 1,15 s: faltam 3,85 s <= 4
    expect(carregadas()).toEqual(['i2']);
  });

  it('com a tela apagada o temporizador não age (a troca antecipada é a dona)', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 4 });
    motor.posicaoInicial = 170;
    usePlayerStore.getState().playQueue([catalogo('j1'), catalogo('j2')], 0);
    await assentar();
    motor.t0 = Date.now();
    emit_loaded();
    vi.mocked(audioEngine.load).mockClear();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await vi.advanceTimersByTimeAsync(6_100);
    // Quem troca em segundo plano é `armHandoffTimer` (um disparo, mesmo alvo):
    // o do crossfade não duplica a carga.
    expect(carregadas().filter((id) => id === 'j2').length).toBeLessThanOrEqual(1);
  });
});

function emit_loaded(): void {
  emitir('loaded', { track: motor.atual, duration: 180 });
}

describe('retomada gravada no máximo 1x por janela — e sempre quando importa', () => {
  const RESUME = 'aurial:resume';
  function gravacoes(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((c) => c[0] === RESUME).length;
  }

  it('50 pulsos em 10 s: não grava no quadro do pulso e fica em 1 por janela de 5 s', async () => {
    usePlayerStore.getState().playQueue([catalogo('k1'), catalogo('k2')], 0);
    await assentar();
    const spy = vi.spyOn(Storage.prototype, 'setItem');

    for (let i = 0; i < 50; i++) {
      motor.posicaoInicial = 1;
      motor.t0 = Date.now();
      const antes = gravacoes(spy);
      timeupdate(1 + i * 0.2);
      // O quadro do pulso nunca paga a escrita: ela vai para a ociosidade.
      expect(gravacoes(spy)).toBe(antes);
      await vi.advanceTimersByTimeAsync(200);
    }
    const total = gravacoes(spy);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(3); // 10 s / 5 s (+ a primeira)
    spy.mockRestore();
  });

  it('pause, pagehide e visibilitychange gravam NA HORA, mesmo dentro da janela', async () => {
    usePlayerStore.getState().playQueue([catalogo('l1'), catalogo('l2')], 0);
    await assentar();
    timeupdate(10);
    await vi.advanceTimersByTimeAsync(300); // grava a de rotina
    const spy = vi.spyOn(Storage.prototype, 'setItem');

    timeupdate(11);
    usePlayerStore.getState().pause();
    expect(gravacoes(spy)).toBe(1);

    window.dispatchEvent(new Event('pagehide'));
    expect(gravacoes(spy)).toBe(2);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(gravacoes(spy)).toBe(3);
    const gravado = JSON.parse(window.localStorage.getItem(RESUME) ?? 'null') as {
      track: { id: string };
      progress: number;
    };
    expect(gravado.track.id).toBe('l1');
    expect(gravado.progress).toBeGreaterThanOrEqual(10);
    spy.mockRestore();
  });
});
