/**
 * RENOMEAR E TROCAR A CAPA — sem levar o registro junto.
 *
 * A lista de playlists mora no localStorage, e foi ali que quatro mil faixas se
 * perderam quando a chave passou de 5 MB: `setItem` falha POR INTEIRO, não
 * grava "o que coube". Guardar a capa como data URL dentro do registro traria o
 * mesmo estrago de volta — por isso `coverUrl` guarda URL, e os bytes vão para
 * o cofre de capas (IndexedDB).
 *
 * Estes testes travam as três coisas que, se quebrarem, tiram trabalho do
 * usuário: renomear para vazio, capa que não vence a herdada, e capa que
 * inflaria o registro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type * as LocalPlaylists from '@/lib/local/localPlaylists';

vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/offline/audioCache', () => ({
  putCover: vi.fn(async () => undefined),
  getCoverBlob: vi.fn(async () => null),
  deleteCover: vi.fn(async () => undefined),
}));

async function montar(): Promise<typeof LocalPlaylists> {
  vi.resetModules();
  window.localStorage.clear();
  return import('@/lib/local/localPlaylists');
}

describe('renomear a lista', () => {
  beforeEach(() => window.localStorage.clear());

  it('troca o nome e mantém as faixas', async () => {
    const pl = await montar();
    const lista = pl.create('Sem nome ainda', [makeTrack('local:a'), makeTrack('local:b')]);

    expect(pl.rename(lista.id, 'Trap BR')).toBe(true);

    const depois = pl.get(lista.id);
    expect(depois?.title).toBe('Trap BR');
    expect(depois?.trackIds).toHaveLength(2);
  });

  it('RECUSA nome em branco em vez de gravar uma lista sem nome', async () => {
    const pl = await montar();
    const lista = pl.create('Trap BR');

    expect(pl.rename(lista.id, '   ')).toBe(false);
    expect(pl.get(lista.id)?.title).toBe('Trap BR');
  });

  it('tira o espaço sobrando das pontas', async () => {
    const pl = await montar();
    const lista = pl.create('x');
    pl.rename(lista.id, '  Só as Braba  ');
    expect(pl.get(lista.id)?.title).toBe('Só as Braba');
  });

  it('não inventa lista que não existe', async () => {
    const pl = await montar();
    expect(pl.rename('local-list:nao-existe', 'Qualquer')).toBe(false);
  });
});

describe('capa da lista', () => {
  beforeEach(() => window.localStorage.clear());

  it('a capa escolhida VENCE a herdada da primeira faixa', async () => {
    const pl = await montar();
    const comCapa = { ...makeTrack('local:a'), coverUrl: 'https://x/da-faixa.jpg' };
    const lista = pl.create('Minha lista', [comCapa]);

    // Sem escolha: herda a da faixa.
    expect(pl.toPlaylistDto(pl.get(lista.id)!).coverUrl).toBe('https://x/da-faixa.jpg');

    pl.setCover(lista.id, 'https://x/escolhida.jpg');
    expect(pl.toPlaylistDto(pl.get(lista.id)!).coverUrl).toBe('https://x/escolhida.jpg');
  });

  it('tirar a capa volta a herdar, não deixa a lista cinza', async () => {
    const pl = await montar();
    const comCapa = { ...makeTrack('local:a'), coverUrl: 'https://x/da-faixa.jpg' };
    const lista = pl.create('Minha lista', [comCapa]);

    pl.setCover(lista.id, 'https://x/escolhida.jpg');
    pl.setCover(lista.id, null);

    expect(pl.get(lista.id)?.coverUrl).toBeNull();
    expect(pl.toPlaylistDto(pl.get(lista.id)!).coverUrl).toBe('https://x/da-faixa.jpg');
  });

  it('o registro guarda URL, NUNCA os bytes da imagem', async () => {
    const pl = await montar();
    const lista = pl.create('Minha lista');
    pl.setCover(lista.id, 'https://x/escolhida.jpg');

    const bruto = window.localStorage.getItem('aurial:local-playlists') ?? '';
    // Uma data URL aqui é o caminho de volta para o estouro de 5 MB.
    expect(bruto).not.toContain('data:image');
    expect(bruto.length).toBeLessThan(2000);
  });
});
