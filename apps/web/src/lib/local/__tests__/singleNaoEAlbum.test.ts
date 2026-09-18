/**
 * SINGLE NÃO É ÁLBUM.
 *
 * A estante enchia de "álbuns" de uma faixa só: a regra antiga promovia a
 * álbum completo qualquer faixa cujo nome de álbum diferisse do nome dela — e é
 * o que todo single faz ("Tudo Ok" no álbum "Tudo Ok - Single", ou no nome do
 * projeto). Aqui se fixa o que conta como álbum de verdade.
 *
 * E, do outro lado, a ficha de um artista tem que reunir as grafias do mesmo
 * nome: "DJ Kennedi" e "Kennedi" são uma pessoa só.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibraryModule from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

type LocalLibrary = typeof LocalLibraryModule;

vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

interface Ficha {
  titulo: string;
  album: string;
  artista?: string;
  trackNumber?: number | null;
}

function entrada(id: string, ficha: Ficha): LibraryEntry {
  const artista = ficha.artista ?? 'Fulano';
  return {
    track: makeTrack(id, {
      title: ficha.titulo,
      trackNumber: ficha.trackNumber ?? null,
      album: { id: `album:${id}`, title: ficha.album, slug: '', coverUrl: null },
      artists: [{ id: `artist:${id}`, name: artista, slug: '', imageUrl: null }],
    }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
  };
}

async function montar(entradas: LibraryEntry[]): Promise<LocalLibrary> {
  window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
  vi.resetModules();
  return import('@/lib/local/localLibrary');
}

describe('álbum de verdade x single', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('faixa solta com nome de álbum diferente é single, não álbum', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'Tudo Ok', album: 'Tudo Ok (Deluxe)' }),
    ]);
    expect(lib.albumGroups()).toHaveLength(0);
    expect(lib.singles().map((t) => t.title)).toEqual(['Tudo Ok']);
  });

  it('"- Single" no título nunca é álbum, nem com duas faixas', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'Tudo Ok', album: 'Tudo Ok - Single' }),
      entrada('local:2', { titulo: 'Tudo Ok (ao vivo)', album: 'Tudo Ok - Single' }),
    ]);
    expect(lib.albumGroups()).toHaveLength(0);
  });

  it('duas faixas do mesmo lançamento são um álbum', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'Abertura', album: 'O Disco' }),
      entrada('local:2', { titulo: 'Segunda', album: 'O Disco' }),
    ]);
    const albuns = lib.albumGroups();
    expect(albuns).toHaveLength(1);
    expect(albuns[0]?.tracks).toHaveLength(2);
  });

  it('faixa numerada a partir da segunda veio de um disco, mesmo sozinha', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'A Quarta', album: 'O Disco', trackNumber: 4 }),
    ]);
    expect(lib.albumGroups().map((a) => a.title)).toEqual(['O Disco']);
  });
});

describe('uma ficha por artista', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('"DJ Kennedi" e "Kennedi" são o mesmo artista, com a grafia mais usada', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'Uma', album: 'A', artista: 'DJ Kennedi' }),
      entrada('local:2', { titulo: 'Duas', album: 'B', artista: 'DJ Kennedi' }),
      entrada('local:3', { titulo: 'Três', album: 'C', artista: 'Kennedi' }),
    ]);
    const artistas = lib.artists();
    expect(artistas).toHaveLength(1);
    expect(artistas[0]?.name).toBe('DJ Kennedi');
    expect(artistas[0]?.trackCount).toBe(3);
  });

  it('a ficha traz as faixas das duas grafias, entrando por qualquer uma', async () => {
    const lib = await montar([
      entrada('local:1', { titulo: 'Uma', album: 'A', artista: 'MC Brandão' }),
      entrada('local:2', { titulo: 'Duas', album: 'B', artista: 'Brandao' }),
    ]);
    expect(lib.artistTracks('MC Brandão')).toHaveLength(2);
    expect(lib.artistTracks('Brandão')).toHaveLength(2);
  });
});
