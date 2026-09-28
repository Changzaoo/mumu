/**
 * O ÁLBUM ACABA, A MÚSICA NÃO — e o que vem depois faz sentido.
 *
 * "Quando o álbum tiver tocado a última música deve continuar a tocar músicas
 * parecidas, dando prioridade às músicas que o usuário gosta ou que sejam mais
 * parecidas com o gênero que ele está escutando."
 *
 * Este arquivo prova DUAS coisas com o motor de verdade (`construirRadio` +
 * `reordenarPeloGosto` + `sinaisDoAparelho` reais, só a biblioteca e os sinais
 * de conta são simulados):
 *
 *  1. A fila de fato CONTINUA depois da última faixa de um contexto `album` —
 *     `garantirContinuacao` (playerStore.ts) não trata playlist como o único
 *     caso: sem playlist correspondente, ela cai no rádio de parecidas, que
 *     vale para qualquer contexto (álbum incluso).
 *  2. A ORDEM da extensão honra o pedido: a faixa CURTIDA entra na frente das
 *     candidatas igualmente compatíveis (mesmo gênero) que não foram curtidas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

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
    currentTrack: null,
    isPlaying: false,
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, { error: () => undefined });
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

// Sem playlists da pessoa: força o caminho 2 (rádio de parecidas) de
// `garantirContinuacao`, que é o que atende contexto `album`.
vi.mock('@/lib/local/localPlaylists', () => ({
  list: () => [],
  get: () => null,
  resolveTracks: () => [],
}));

const f = (id: string, artista: string, genre = 'Rock'): TrackDto =>
  makeTrack(id, { genre, artists: [{ id: artista, name: artista, slug: '', imageUrl: null }] });

// O ÁLBUM: duas faixas de "Artista X".
const album = [f('alb1', 'Artista X'), f('alb2', 'Artista X')];
// O RESTO DA BIBLIOTECA — candidatas à continuação, todas do mesmo gênero
// (Rock) e sem restrição de conteúdo sensível, então nenhuma precisa de
// veredicto de conteúdo para entrar (ver `radio.ts`).
const curtida = f('curtida1', 'Artista Y');
const semCurtida = f('comum1', 'Artista Z');
const biblioteca = [...album, curtida, semCurtida];

vi.mock('@/lib/local/localLibrary', () => ({
  artistTracks: (nome: string) =>
    biblioteca.filter((t) => t.artists?.[0]?.name?.toLowerCase() === nome.toLowerCase()),
  genreTracks: (g: string) => biblioteca.filter((t) => t.genre === g),
  list: () => biblioteca.map((track) => ({ track })),
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

// Sem vetores de embedding: o caminho semântico devolve pouco e o heurístico
// assume — o caminho que roda na esmagadora maioria dos aparelhos.
vi.mock('@/lib/reco/semanticMixes', () => ({ similarTo: () => [] }));

// `garantirContinuacao` (playerStore.ts) só chega em `radio.ts` por `import()`
// dinâmico, em runtime — nenhum import ESTÁTICO deste arquivo de teste toca
// nele antes disso. Sem registrar o módulo explicitamente (mesmo que só para
// devolver o original), esse primeiro `import()` dinâmico correndo ao mesmo
// tempo que os outros três da mesma `Promise.all` nunca resolve neste
// ambiente de teste (vite-node) — e a continuação nunca emenda. É uma
// característica do runtime de teste, não do código: em produção o bundle já
// está todo resolvido antes de qualquer `import()` acontecer.
vi.mock('@/lib/reco/radio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reco/radio')>();
  return { ...actual };
});

// A CONTA não tem histórico (isola o sinal de curtida do de afinidade
// aprendida) mas TEM uma curtida — exatamente o pedido do dono do produto:
// "dando prioridade às músicas que o usuário gosta".
vi.mock('@/lib/local/localHistory', () => ({
  list: () => [],
  listForCurrentUser: () => [],
}));
vi.mock('@/lib/local/localLikes', () => ({ list: () => [curtida] }));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';

// A continuação é assíncrona (quatro `import()` dinâmicos em paralelo,
// ver playerStore.ts). O orçamento é generoso de propósito — bem abaixo do
// `testTimeout` de 30s do `vitest.config.ts` — porque a falha real (a fila não
// emendar) e uma máquina momentaneamente lenta não podem parecer a mesma
// coisa.
const assentar = async (): Promise<void> => {
  const prazo = Date.now() + 5_000;
  while (Date.now() < prazo) {
    if (usePlayerStore.getState().queue.length > album.length) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

const inicial = usePlayerStore.getState();
initPlayerEngine();

beforeEach(() => {
  usePlayerStore.setState(inicial, true);
  window.localStorage.clear();
});

describe('fim de álbum', () => {
  it('a fila CONTINUA depois da última faixa do álbum (contexto `album`)', async () => {
    usePlayerStore.getState().playQueue(album, 1, { source: 'album', sourceId: 'al1' });
    await assentar();

    expect(usePlayerStore.getState().queue.length).toBeGreaterThan(album.length);
  });

  it('a faixa CURTIDA entra à frente da candidata igualmente compatível, não curtida', async () => {
    usePlayerStore.getState().playQueue(album, 1, { source: 'album', sourceId: 'al1' });
    await assentar();

    const emendadas = usePlayerStore.getState().queue.slice(album.length);
    const ids = emendadas.map((t) => t.id);
    expect(ids).toContain('curtida1');
    expect(ids).toContain('comum1');
    expect(ids.indexOf('curtida1')).toBeLessThan(ids.indexOf('comum1'));
  });

  it('o contexto continua sendo o mesmo álbum — a emenda não troca o "tocando de"', async () => {
    usePlayerStore.getState().playQueue(album, 1, { source: 'album', sourceId: 'al1' });
    await assentar();

    expect(usePlayerStore.getState().context).toEqual({ source: 'album', sourceId: 'al1' });
  });
});
