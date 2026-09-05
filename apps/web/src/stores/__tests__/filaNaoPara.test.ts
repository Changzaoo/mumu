/**
 * RF3/RF7 — A FILA NÃO PARA, E A FALHA É VISÍVEL E PULÁVEL.
 *
 * O cofre é MENOR que o acervo: a poda é regime normal, não acidente (risco 6
 * da fase 3). Uma faixa cuja cópia foi podada responde **403/404**, e isso é
 * estado ESPERADO. Numa playlist de vinte, duas ou três assim é rotina — e o
 * player não pode transformar rotina em silêncio.
 *
 * Existem dois jeitos de a fila morrer, e eles não se parecem:
 *
 *  1. **A faixa recusa em alto e bom som** (403 do cofre). Fácil de ver, e o
 *     erro certo é marcar, avisar UMA vez e pular.
 *  2. **A faixa não diz nada.** Um `/stream` que resolveu o cabeçalho e nunca
 *     manda byte não emite `error` nenhum — o elemento de áudio fica em
 *     `readyState 0` para sempre. Sem watchdog, é o spinner eterno: nenhuma
 *     mensagem, nenhum avanço, nada para o usuário fazer além de fechar o app.
 *
 * Este arquivo põe as duas na MESMA fila, uma atrás da outra, e exige o que
 * qualquer player sério faz: chegar na quarta faixa tocando.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

let posicaoDoPlayhead = 0;

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
    getPosition: vi.fn(() => posicaoDoPlayhead),
    getDuration: vi.fn(() => 180),
    // Zero é a assinatura da faixa que ESTAGNOU: nenhum byte chegou, e é isso
    // que separa "lenta" (ganha mais tempo) de "morta" (a fila anda).
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
    unlock: vi.fn(),
    currentTrack: null,
    analyser: null,
    get isPlaying(): boolean {
      return tocando;
    },
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

const avisos: string[] = [];
vi.mock('sonner', () => {
  const toast = Object.assign((msg: string) => void avisos.push(msg), {
    error: (msg: string) => void avisos.push(`ERRO: ${msg}`),
    success: vi.fn(),
    message: vi.fn(),
  });
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

/** Sem parecidas: força o caminho de "acabou mesmo", que é o que pára o player. */
vi.mock('@/lib/reco/radio', () => ({ construirRadio: () => [] }));

const registrar = vi.fn();
vi.mock('@/lib/local/faixasQueFalharam', () => ({
  registrar: (...args: unknown[]) => registrar(...args),
  marcarReparada: vi.fn(),
  anotarTentativaDeReparo: vi.fn(),
  emAberto: () => [],
  lista: () => [],
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

/** Faixa de catálogo (não `local:`): watchdog curto, sem reextração de cofre. */
function faixa(id: string): TrackDto {
  return makeTrack(id, { streamUrl: `https://cofre.example/blob/${id}?k=token` });
}

/** Ids que o cofre recusa com 403 — a cópia foi podada. */
const podadas = new Set<string>();

function idDaUrl(url: string): string {
  return /\/blob\/([^?]+)/.exec(url)?.[1] ?? '';
}

/** Qual faixa o motor recebeu por último. */
function ultimaCarregada(): string | undefined {
  return (vi.mocked(audioEngine.load).mock.calls.at(-1)?.[0] as TrackDto | undefined)?.id;
}

const initialState = usePlayerStore.getState();
initPlayerEngine();

/**
 * Zera a "sequência de mortes" entre os testes.
 *
 * O orçamento de pulos (`consecutiveDeadTracks`/`deadRunStartedAt`) vive no
 * módulo, e a ÚNICA coisa que o zera é som saindo de verdade — de propósito:
 * 'loaded' dispara até numa URL que vai falhar logo depois, e zerar ali fazia o
 * player varrer a fila inteira. Aqui isso significa que um teste herda a
 * sequência do anterior e começa perto do teto, o que é contaminação e não
 * comportamento. Um `timeupdate` com o playhead andando é exatamente a prova
 * que o player aceita.
 */
function zerarSequenciaDeMortes(): void {
  for (const handler of engineHandlers.get('timeupdate') ?? []) {
    // Posição baixa de propósito: a partir de 30s o portão de prévia dispara.
    handler({ position: 1, duration: 180 });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState(initialState, true);
  zerarSequenciaDeMortes();
  vi.clearAllMocks();
  avisos.length = 0;
  podadas.clear();
  posicaoDoPlayhead = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        status: podadas.has(idDaUrl(url)) ? 403 : 206,
        body: { cancel: () => Promise.resolve() },
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Deixa as promessas assentarem sem deixar os temporizadores falsos correrem. */
async function assentar(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('a fila atravessa faixa podada e faixa que estagna', () => {
  it('403 do cofre marca a faixa e avança — não vira spinner', async () => {
    podadas.add('q2');
    const fila = [faixa('q1'), faixa('q2'), faixa('q3')];
    usePlayerStore.getState().playQueue(fila, 1, { source: 'queue' });

    // A sonda (`Range: bytes=0-0`) volta 403 quase na hora; sem ela a
    // descoberta custaria ~4,5s esperando o elemento de áudio desistir — e o
    // avanço da fila é tão rápido que `q2` mal chega a ser o estado visível.
    await vi.waitFor(() => expect(ultimaCarregada()).toBe('q3'));
    await assentar();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    // RF7: a falha é VISÍVEL, não silenciosa.
    expect(avisos.join(' ')).toMatch(/indisponível/i);
    // E fica registrada, para o reparador saber o que buscar de novo.
    expect(registrar).toHaveBeenCalled();
  });

  it('faixa que estagna sem evento nenhum não segura a fila (watchdog)', async () => {
    const fila = [faixa('q1'), faixa('q2')];
    usePlayerStore.getState().playQueue(fila, 0, { source: 'queue' });

    await vi.waitFor(() => expect(ultimaCarregada()).toBe('q1'));
    await assentar();

    // q1 não emite `error`, não emite `loaded`, não bufferiza nada. Do ponto de
    // vista do app é uma faixa que simplesmente não responde — o caso em que o
    // spinner girava para sempre.
    expect(ultimaCarregada()).toBe('q1');

    await vi.advanceTimersByTimeAsync(19_000); // teto do catálogo: 18s
    await assentar();

    expect(ultimaCarregada()).toBe('q2');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('três ruins seguidas terminam na quarta TOCANDO', async () => {
    podadas.add('r2');
    podadas.add('r3');
    podadas.add('r4');
    const fila = [faixa('r1'), faixa('r2'), faixa('r3'), faixa('r4'), faixa('r5')];
    usePlayerStore.getState().playQueue(fila, 1, { source: 'queue' });

    await vi.waitFor(() => expect(ultimaCarregada()).toBe('r5'), { timeout: 5000 });
    expect(usePlayerStore.getState().currentTrack?.id).toBe('r5');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('o aviso sai UMA vez por sequência, não a cada pulo', async () => {
    podadas.add('s2');
    podadas.add('s3');
    podadas.add('s4');
    const fila = [faixa('s1'), faixa('s2'), faixa('s3'), faixa('s4'), faixa('s5')];
    usePlayerStore.getState().playQueue(fila, 1, { source: 'queue' });

    await vi.waitFor(() => expect(ultimaCarregada()).toBe('s5'), { timeout: 5000 });
    await assentar(); // o toast é importado sob demanda; deixa a promessa fechar

    // Três pulos, um aviso: uma pilha de reclamações sobre um problema que o
    // app está resolvendo sozinho é barulho, não informação.
    expect(avisos.filter((a) => /indisponível/i.test(a))).toHaveLength(1);
  });

  it('quando não há mais para onde ir, PARA — e o spinner some junto', async () => {
    // O oposto do defeito, e igualmente importante: desistir também tem que ser
    // um estado visível. Um player parado com o spinner girando é uma promessa
    // que ninguém vai cumprir — a pessoa espera para sempre por nada.
    podadas.add('u1');
    usePlayerStore.getState().playQueue([faixa('u1')], 0, { source: 'queue' });

    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    await assentar();

    expect(usePlayerStore.getState().isBuffering).toBe(false);
    expect(avisos.some((a) => a.startsWith('ERRO:'))).toBe(true);
  });

  it('travamento NO MEIO da faixa também derruba para a próxima', async () => {
    const fila = [faixa('t1'), faixa('t2')];
    usePlayerStore.getState().playQueue(fila, 0, { source: 'queue' });
    await vi.waitFor(() => expect(ultimaCarregada()).toBe('t1'));
    await assentar();

    // A faixa TOCOU (o playhead saiu do zero) e depois congelou: o elemento
    // emitiu 'waiting' e nunca mais voltou. Nenhum evento de erro existe aqui.
    posicaoDoPlayhead = 42;
    for (const handler of engineHandlers.get('loaded') ?? []) {
      handler({ track: fila[0], duration: 180 });
    }

    // Primeira checagem: o playhead ANDOU desde a última — faixa saudável, só
    // remarca. É o que impede o watchdog de matar música que está tocando.
    await vi.advanceTimersByTimeAsync(11_000);
    await assentar();
    expect(audioEngine.seek).not.toHaveBeenCalled();

    // Segunda: o playhead está no mesmo ponto. Primeiro strike cutuca o
    // elemento — buffer preso costuma destravar com um seek para onde já está.
    await vi.advanceTimersByTimeAsync(11_000);
    await assentar();
    expect(audioEngine.seek).toHaveBeenCalledWith(42);

    // Terceira: nem a cutucada resolveu. Aí sim a fonte é dada por perdida.
    await vi.advanceTimersByTimeAsync(11_000);
    await assentar();

    await vi.waitFor(() => expect(ultimaCarregada()).toBe('t2'));
  });
});
