/**
 * A CONTINUAÇÃO OFFLINE RESPEITA A FILA DA PESSOA — e não dá play sozinha.
 *
 * Dois defeitos na hora em que a rede cai (ou o app abre sem ela):
 *
 *  1. A continuação SUBSTITUÍA tudo o que vinha depois da faixa atual. Uma
 *     playlist baixada com UMA faixa não baixada no meio virava uma lista de
 *     "parecidas" da biblioteca inteira: as baixadas da própria playlist saíam
 *     da ordem (ou da fila). A regra é seguir a fila pelas baixadas.
 *  2. Abrindo o app já sem rede, a faixa restaurada vem PAUSADA. Se ela não
 *     estava no aparelho, a continuação chamava `next()` — play sem gesto
 *     nenhum, que o navegador recusa, e a faixa que a pessoa ia retomar sumia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

const noAparelho = new Set<string>();

const estado = {
  currentTrack: null as TrackDto | null,
  queue: [] as TrackDto[],
  queueIndex: -1,
  isPlaying: false,
  setUpNext: vi.fn((tracks: TrackDto[]) => {
    estado.queue = [...estado.queue.slice(0, estado.queueIndex + 1), ...tracks];
  }),
  next: vi.fn(),
};

vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: {
    getState: () => estado,
    subscribe: () => () => undefined,
  },
}));
vi.mock('@/lib/local/localLibrary', () => ({
  hasLocalAudio: (id: string) => noAparelho.has(id),
  list: () => [],
}));
vi.mock('@/lib/local/localHistory', () => ({ listForCurrentUser: () => [] }));
vi.mock('@/lib/local/localLikes', () => ({ list: () => [] }));
vi.mock('@/features/downloads/registry', () => ({
  getDownloads: () =>
    [...noAparelho].map((id) => ({ track: makeTrack(id), downloadedAt: '', sizeBytes: 0 })),
}));
vi.mock('@/features/downloads/downloadManager', () => ({
  hasDownloadedAudio: (id: string) => noAparelho.has(id),
}));
vi.mock('@/lib/reco/semanticMixes', () => ({ similarTo: () => [] }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { emendarNaFila, initContinuidadeOffline } from '@/lib/offline/continuidadeOffline';

const ids = (tracks: readonly TrackDto[]): string[] => tracks.map((t) => t.id);

describe('emendarNaFila', () => {
  it('a fila da pessoa vem primeiro, só com o que toca sem rede, na ordem dela', () => {
    const resto = [makeTrack('b'), makeTrack('c'), makeTrack('d')];
    const continuacao = [makeTrack('x'), makeTrack('d'), makeTrack('y')];
    const tocaSemRede = (id: string): boolean => id !== 'b';

    expect(ids(emendarNaFila(resto, continuacao, tocaSemRede))).toEqual(['c', 'd', 'x', 'y']);
  });
});

describe('queda de rede com o app aberto', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    noAparelho.clear();
    estado.setUpNext.mockClear();
    estado.next.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('não joga fora as baixadas da fila, e não dá play numa faixa pausada', async () => {
    for (const id of ['c', 'd', 'x']) noAparelho.add(id);
    // App aberto já sem rede: a faixa restaurada (a) não está no aparelho e
    // veio PAUSADA; a fila tinha uma não baixada (b) no meio.
    estado.currentTrack = makeTrack('a');
    estado.queue = [makeTrack('a'), makeTrack('b'), makeTrack('c'), makeTrack('d')];
    estado.queueIndex = 0;
    estado.isPlaying = false;

    initContinuidadeOffline();
    await vi.waitFor(() => expect(estado.setUpNext).toHaveBeenCalled());

    const aSeguir = ids(estado.setUpNext.mock.calls[0]?.[0] ?? []);
    expect(aSeguir.slice(0, 2)).toEqual(['c', 'd']); // a ordem da playlist
    expect(aSeguir).toContain('x'); // a continuação entra depois
    expect(aSeguir).not.toContain('b');
    expect(estado.next).not.toHaveBeenCalled();
  });
});
