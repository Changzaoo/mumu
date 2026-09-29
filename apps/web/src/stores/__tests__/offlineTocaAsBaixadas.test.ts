/**
 * SEM INTERNET, TUDO O QUE ESTÁ BAIXADO TOCA.
 *
 * O relato: a pessoa saiu com o celular sem internet e as músicas que ela
 * tinha BAIXADO não continuaram tocando. A regra do produto é simples — a fila
 * continua pelas baixadas, pula as não baixadas sem travar — e cada teste abaixo
 * é um jeito diferente de o player descumpri-la:
 *
 *  1. `onLine === false` e uma faixa não baixada na frente: o player PARAVA
 *     ("queda geral"), com músicas baixadas logo depois.
 *  2. `onLine === true` MENTINDO (o normal no Android sem sinal): a faixa da
 *     rede travava no meio e o player esperava a rede PARA SEMPRE no mesmo
 *     ponto — nunca chegava na baixada seguinte.
 *  3. Idem, faixa que nem começa: pulava para a próxima DA REDE (mais um
 *     watchdog de silêncio cada) em vez de ir direto para a baixada.
 *  4. O fim natural de uma baixada mirava a seguinte da rede sem rede.
 *  5. Faixa baixada que o motor mandou para a rede (alça fechada no crossfade
 *     ou na troca com a tela apagada) era declarada morta sem tentar o disco.
 *  6. Descobrir a fonte na rede sem teto: a carga ficava "preparando" para
 *     sempre, antes de qualquer watchdog existir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    iniciarEm: vi.fn(),
    getPosition: vi.fn(() => posicaoDoPlayhead),
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

/** Detalhe do acervo que nunca responde (rede morta que não erra). */
const detalhePendurado = { ativo: false };

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
  duracaoDiverge: vi.fn(() => false),
}));

/** Faixas BAIXADAS (bytes no aparelho) e as que já têm alça aberta. */
const baixadas = new Set<string>();
const alcasAbertas = new Set<string>();
vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn((id: string) => (alcasAbertas.has(id) ? `blob:${id}` : null)),
  hasDownloadedAudio: vi.fn((id: string) => baixadas.has(id)),
  ensureDownloadedAudioUrl: vi.fn((id: string) => {
    if (!baixadas.has(id)) return Promise.resolve(null);
    alcasAbertas.add(id);
    return Promise.resolve(`blob:${id}`);
  }),
  rebaixarAoFalhar: vi.fn(),
}));
vi.mock('@/lib/local/detalheDaFaixa', () => ({
  garantirDetalhe: vi.fn(() =>
    detalhePendurado.ativo ? new Promise<boolean>(() => undefined) : Promise.resolve(false),
  ),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
  aquecerFontes: vi.fn(() => Promise.resolve()),
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
import { audioEngine } from '@/lib/audio/AudioEngine';
import { esquecerVeredito } from '@/lib/offline/redeMorta';
import { makeTrack } from '@/test/factories';

/** Faixa de fora do acervo local (catálogo/compartilhada): só tem a URL dela. */
function faixa(id: string): TrackDto {
  return makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3` });
}

function carregadas(): string[] {
  return vi.mocked(audioEngine.load).mock.calls.map((c) => (c[0] as TrackDto).id);
}

function emit(event: string, payload: unknown): void {
  for (const handler of engineHandlers.get(event) ?? []) handler(payload);
}

async function assentar(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A rede do navegador: `declarada` é o `onLine`; `chega` é a verdade. */
function rede(declarada: boolean, chega: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(declarada);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      chega
        ? Promise.resolve({ status: 200, body: { cancel: () => Promise.resolve() } })
        : Promise.reject(new TypeError('Failed to fetch')),
    ),
  );
}

const initialState = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState(initialState, true);
  // Zera a sequência de mortes herdada do teste anterior (só som a zera).
  emit('timeupdate', { position: 1, duration: 180 });
  vi.clearAllMocks();
  avisos.length = 0;
  baixadas.clear();
  alcasAbertas.clear();
  detalhePendurado.ativo = false;
  posicaoDoPlayhead = 0;
  esquecerVeredito();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sem internet, a fila segue pelas baixadas', () => {
  it('onLine=false: pula as não baixadas e toca a baixada — não para', async () => {
    rede(false, false);
    baixadas.add('c');
    usePlayerStore.getState().playQueue([faixa('a'), faixa('b'), faixa('c')], 0);

    await vi.waitFor(() => expect(carregadas()).toContain('c'));
    await assentar();

    // Nenhuma tentativa de rede no caminho: nem `a` nem `b` foram ao motor.
    expect(carregadas()).toEqual(['c']);
    const s = usePlayerStore.getState();
    expect(s.currentTrack?.id).toBe('c');
    expect(s.isPlaying).toBe(true);
    expect(avisos.some((a) => a.startsWith('ERRO:'))).toBe(false);
  });

  it('onLine=false e NADA baixado adiante: para com aviso claro', async () => {
    rede(false, false);
    usePlayerStore.getState().playQueue([faixa('a'), faixa('b')], 0);

    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    await assentar();
    expect(avisos.join(' ')).toMatch(/Sem conexão/);
  });

  it('onLine MENTINDO: faixa da rede que trava no meio cede a vez à baixada', async () => {
    rede(true, false);
    baixadas.add('c');
    const fila = [faixa('a'), faixa('b'), faixa('c')];
    usePlayerStore.getState().playQueue(fila, 0);
    await vi.waitFor(() => expect(carregadas()).toEqual(['a']));

    // `a` tocou da rede e congelou quando o sinal sumiu.
    posicaoDoPlayhead = 42;
    emit('loaded', { track: fila[0], duration: 180 });
    await vi.advanceTimersByTimeAsync(11_000); // playhead andou: saudável
    await vi.advanceTimersByTimeAsync(11_000); // parou: cutuca
    await vi.advanceTimersByTimeAsync(11_000); // continua parado: sem fonte
    await assentar();

    // Antes: 'esperandoRede' para sempre em `a`. Agora a sonda desmente o
    // `onLine` e a fila vai direto para a baixada, sem passar por `b`.
    expect(usePlayerStore.getState().currentTrack?.id).toBe('c');
    expect(carregadas()).not.toContain('b');
  });

  it('onLine MENTINDO: faixa que nem começa vai direto para a baixada', async () => {
    rede(true, false);
    baixadas.add('c');
    const fila = [faixa('a'), faixa('b'), faixa('c')];
    usePlayerStore.getState().playQueue(fila, 0);
    await vi.waitFor(() => expect(carregadas()).toEqual(['a']));

    emit('error', { message: 'rede', track: fila[0], kind: 'load' });
    await vi.waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('c'));
    expect(carregadas()).not.toContain('b');
  });

  it('rede VIVA: a fila segue normalmente, sem pular a não baixada', async () => {
    rede(true, true);
    baixadas.add('c');
    const fila = [faixa('a'), faixa('b'), faixa('c')];
    usePlayerStore.getState().playQueue(fila, 0);
    await vi.waitFor(() => expect(carregadas()).toEqual(['a']));

    emit('error', { message: 'fonte morta', track: fila[0], kind: 'load' });
    await vi.waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('b'));
  });

  it('fim natural de uma baixada, sem rede: a seguinte é a próxima baixada', async () => {
    rede(false, false);
    baixadas.add('a');
    baixadas.add('c');
    const fila = [faixa('a'), faixa('b'), faixa('c')];
    usePlayerStore.getState().playQueue(fila, 0);
    await vi.waitFor(() => expect(carregadas()).toEqual(['a']));

    emit('ended', {});
    await vi.waitFor(() => expect(carregadas()).toEqual(['a', 'c']));
    expect(usePlayerStore.getState().currentTrack?.id).toBe('c');
  });

  it('baixada mandada para a rede (alça fechada) volta para o disco em vez de morrer', async () => {
    rede(false, false);
    baixadas.add('c');
    const fila = [faixa('c'), faixa('d')];
    usePlayerStore.getState().playQueue(fila, 0);
    await vi.waitFor(() => expect(carregadas()).toEqual(['c']));

    // O motor recebeu `c` por um caminho que não abriu a alça (crossfade,
    // troca antecipada) e a URL da rede falhou.
    alcasAbertas.delete('c');
    emit('error', { message: 'net::ERR_INTERNET_DISCONNECTED', track: fila[0], kind: 'load' });
    await assentar();

    expect(carregadas()).toEqual(['c', 'c']); // recarregada — agora do disco
    expect(alcasAbertas.has('c')).toBe(true);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('c');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('descobrir a fonte na rede tem teto: carga pendurada não segura a fila', async () => {
    rede(true, false);
    detalhePendurado.ativo = true;
    baixadas.add('local:c');
    const fila = [makeTrack('local:a', { streamUrl: null }), faixa('local:c')];
    usePlayerStore.getState().playQueue(fila, 0);
    await assentar();
    expect(carregadas()).toEqual([]); // preso buscando o detalhe no acervo

    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('local:c'));
    expect(carregadas()).toEqual(['local:c']);
  });
});
