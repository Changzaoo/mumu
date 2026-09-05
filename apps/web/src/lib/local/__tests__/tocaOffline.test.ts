/**
 * RF6 — SEM INTERNET, A FAIXA BAIXADA TOCA. INCLUSIVE DEPOIS DE RECARREGAR.
 *
 * "Baixar" neste app é guardar os BYTES (Cache Storage / IndexedDB). O que o
 * elemento de áudio recebe, porém, não são bytes: é uma **alça**
 * (`URL.createObjectURL`) — um endereço `blob:` que só vale enquanto a página
 * viver e enquanto ninguém a soltar. Duas coisas a matam, e as duas são rotina:
 *
 *  1. **recarregar a página** (atualização de versão, o sistema descartando a
 *     aba, a pessoa puxando para recarregar): toda alça anterior morre junto;
 *  2. **o despejo por memória** (`alcasDeBlob`): a aba não pode segurar o
 *     acervo inteiro aberto, então alças pouco usadas são soltas de propósito.
 *
 * Guardar a alça como se fosse o endereço da faixa é o erro que transforma
 * "baixei para ouvir no metrô" em "não toca". Os bytes continuam aqui; só a
 * alça caducou, e recriá-la não custa rede nenhuma.
 *
 * A regra que estes testes prendem: **o local vem antes da rede, e a alça é
 * recriada sob demanda** — sem nunca sair atrás de um servidor que, offline,
 * não existe.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

/** Os bytes que o aparelho guardou — o que sobrevive a tudo. */
const cofreEmDisco = new Set<string>();
/** As alças abertas AGORA. Recarregar a página esvazia este mapa, só ele. */
const alcasAbertas = new Map<string, string>();

const ensureLocalAudioUrl = vi.fn((id: string): Promise<string | null> => {
  if (!cofreEmDisco.has(id)) return Promise.resolve(null);
  const alca = alcasAbertas.get(id) ?? `blob:recriada/${id}`;
  alcasAbertas.set(id, alca);
  return Promise.resolve(alca);
});

vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  // Síncrono e só sabe das alças JÁ abertas — é o resolvedor que o motor usa.
  localAudioUrl: vi.fn((id: string) => alcasAbertas.get(id) ?? null),
  // Pergunta ao REGISTRO, não ao mapa de alças. É esta a distinção que faz o
  // offline funcionar depois de uma recarga.
  hasLocalAudio: vi.fn((id: string) => cofreEmDisco.has(id)),
  ensureLocalAudioUrl: (id: string) => ensureLocalAudioUrl(id),
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

vi.mock('@/lib/audio/AudioEngine', () => {
  let tocando = false;
  let resolvedor: ((t: TrackDto) => string | null) | null = null;
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
    setLocalSourceResolver: vi.fn((r: (t: TrackDto) => string | null) => {
      resolvedor = r;
    }),
    /** O que o motor mandaria o `<audio>` tocar para esta faixa. */
    fonteDe: (t: TrackDto): string | null => resolvedor?.(t) ?? t.streamUrl ?? null,
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
const garantirDetalhe = vi.fn(() => Promise.resolve(false));
vi.mock('@/lib/local/detalheDaFaixa', () => ({
  garantirDetalhe: () => garantirDetalhe(),
  informarFila: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: vi.fn(() => Promise.resolve(null)),
  importerHostLabel: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }),
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

const ID = 'local:baixada';

/** A faixa como a curtida a guardou: com uma `streamUrl` que offline não vale. */
function faixaBaixada(): TrackDto {
  return makeTrack(ID, { title: 'Ouvida no metrô', streamUrl: 'https://cofre.example/blob/x' });
}

/** O endereço que o motor recebeu para tocar. */
function fonteCarregada(): string | null {
  const chamada = vi.mocked(audioEngine.load).mock.calls.at(-1);
  const track = chamada?.[0] as TrackDto | undefined;
  if (!track) return null;
  return (audioEngine as unknown as { fonteDe: (t: TrackDto) => string | null }).fonteDe(track);
}

let redeUsada: string[];
const initialState = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
  cofreEmDisco.clear();
  alcasAbertas.clear();
  redeUsada = [];
  // OFFLINE de verdade: a rede não existe, e usá-la é o defeito em teste.
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      redeUsada.push(String(url));
      return Promise.reject(new TypeError('Failed to fetch'));
    }),
  );
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.unstubAllGlobals();
});

describe('offline: a faixa baixada toca sem tocar na rede', () => {
  it('com a alça já aberta, toca do disco', async () => {
    cofreEmDisco.add(ID);
    alcasAbertas.set(ID, 'blob:viva/local:baixada');

    usePlayerStore.getState().playTrack(faixaBaixada(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    expect(fonteCarregada()).toBe('blob:viva/local:baixada');
    expect(redeUsada).toEqual([]);
  });

  it('DEPOIS DE RECARREGAR A PÁGINA: a alça morreu, os bytes não', async () => {
    // O estado exato de um app reaberto: o registro sabe que a faixa está
    // aqui, e não há alça nenhuma aberta — todas morreram com a página.
    cofreEmDisco.add(ID);
    expect(alcasAbertas.size).toBe(0);

    usePlayerStore.getState().playTrack(faixaBaixada(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    // A alça é recriada sob demanda, dos bytes que estavam aqui o tempo todo.
    expect(ensureLocalAudioUrl).toHaveBeenCalledWith(ID);
    expect(fonteCarregada()).toBe('blob:recriada/local:baixada');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    // E nada disso pode custar um pedido de rede — offline não há a quem pedir.
    expect(redeUsada).toEqual([]);
    expect(garantirDetalhe).not.toHaveBeenCalled();
  });

  it('a alça DESPEJADA por memória é reaberta do mesmo jeito', async () => {
    // `alcasDeBlob` solta alças pouco usadas de propósito: a aba não pode
    // segurar o acervo inteiro aberto. Voltar para uma faixa ouvida antes é
    // exatamente este caso, e ele não pode virar ida à rede.
    cofreEmDisco.add(ID);
    alcasAbertas.set(ID, 'blob:viva/local:baixada');
    alcasAbertas.delete(ID); // despejo

    usePlayerStore.getState().playTrack(faixaBaixada(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    expect(fonteCarregada()).toBe('blob:recriada/local:baixada');
    expect(redeUsada).toEqual([]);
  });

  it('faixa NÃO baixada, offline, falha honestamente — sem spinner eterno', async () => {
    // O oposto também é RF6: prometer o que não se tem é pior que avisar.
    usePlayerStore.getState().playTrack(faixaBaixada(), { source: 'library' });

    await vi.waitFor(() => expect(usePlayerStore.getState().isPlaying).toBe(false));
    expect(usePlayerStore.getState().isBuffering).toBe(false);
    expect(redeUsada).toEqual([]);
  });
});
