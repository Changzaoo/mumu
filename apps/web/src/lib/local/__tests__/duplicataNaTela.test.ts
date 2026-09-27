/**
 * A MESMA MÚSICA NÃO APARECE VÁRIAS VEZES NA TELA.
 *
 * Medido no acervo em 2026-09-26: "You Can Do It" do Ice Cube aparecia 7 vezes,
 * "ESTRESSE" do Alee 6. Escapavam da junção porque ela exigia durações quase
 * iguais — a cópia com duração desconhecida (0 s) e a do clipe (com vinheta)
 * nunca encontravam a do álbum. Isto trava a junção SÓ na exibição: nada é
 * apagado do registro.
 */
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibrary from '@/lib/local/localLibrary';

vi.mock('@/lib/local/importerHelper', () => ({
  uploadTrackBlob: vi.fn(async () => null),
  buildStreamUrl: vi.fn(async () => null),
  deleteTrackBlob: vi.fn(),
  fetchArtistCatalog: vi.fn(async () => []),
  fetchCover: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => null),
  fetchPlaylistEntries: vi.fn(async () => ({ title: '', entries: [] })),
  fetchTrackMeta: vi.fn(async () => null),
  helperSupportsMetaTeam: vi.fn(async () => false),
  importerHostLabel: vi.fn(() => null),
  importViaHelper: vi.fn(),
}));
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
  subscribeCatalogo: () => () => undefined,
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));

const ARTISTA = { id: 'a', name: 'Ice Cube', slug: 'ice-cube', imageUrl: null };

function faixa(id: string, title: string, segundos: number): LibraryEntry {
  return {
    track: makeTrack(id, { title, durationMs: segundos * 1000, artists: [ARTISTA] }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
  };
}

async function montar(entradas: LibraryEntry[]): Promise<typeof LocalLibrary> {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
  return await import('@/lib/local/localLibrary');
}

describe('duplicata na tela', () => {
  it('junta as cópias com duração desconhecida e as do clipe', async () => {
    const lib = await montar([
      faixa('local:1', 'You Can Do It', 259),
      faixa('local:2', 'You Can Do It', 0),
      faixa('local:3', 'You Can Do It', 256),
      faixa('local:4', 'You Can Do It', 245),
      faixa('local:5', 'You Can Do It', 0),
    ]);
    const titulos = lib.artistTracks('Ice Cube').map((t) => t.title);
    expect(titulos).toEqual(['You Can Do It']);
  });

  it('quem representa o grupo tem duração (nada de "0:00")', async () => {
    const lib = await montar([faixa('local:1', 'ESTRESSE', 0), faixa('local:2', 'ESTRESSE', 165)]);
    const [unica] = lib.artistTracks('Ice Cube');
    expect(unica?.durationMs).toBe(165_000);
  });

  it('remix e ao vivo continuam separados — a marca está no título', async () => {
    const lib = await montar([
      faixa('local:1', 'What Can I Do?', 260),
      faixa('local:2', 'What Can I Do? (Westside Remix)', 264),
      faixa('local:3', 'What Can I Do? (Ao Vivo)', 0),
    ]);
    expect(lib.artistTracks('Ice Cube')).toHaveLength(3);
  });

  it('mesma música com gravação muito diferente (mais de 60 s) continua separada', async () => {
    const lib = await montar([
      faixa('local:1', 'It Was A Good Day', 260),
      faixa('local:2', 'It Was A Good Day', 420),
    ]);
    expect(lib.artistTracks('Ice Cube')).toHaveLength(2);
  });

  it('só na tela: o registro continua com todas as cópias', async () => {
    const lib = await montar([
      faixa('local:1', 'You Can Do It', 259),
      faixa('local:2', 'You Can Do It', 0),
    ]);
    expect(lib.list()).toHaveLength(2);
  });
});

describe('o álbum de uma faixa', () => {
  const doAlbum = (id: string, title: string, trackNumber: number | null): LibraryEntry => ({
    ...faixa(id, title, 200 + trackNumber!),
    track: {
      ...faixa(id, title, 200).track,
      trackNumber,
      album: { id: 'al', slug: '', title: 'The Predator', coverUrl: null },
    } as LibraryEntry['track'],
  });

  it('devolve o álbum na ORDEM DO DISCO, não na ordem em que entrou', async () => {
    const lib = await montar([
      doAlbum('local:3', 'Wicked', 3),
      doAlbum('local:1', 'The First Day of School', 1),
      doAlbum('local:2', 'When Will They Shoot?', 2),
    ]);
    const escolhida = lib.list().find((e) => e.track.id === 'local:2')!.track;
    const album = lib.faixasDoAlbumDe(escolhida);
    expect(album?.tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3]);
  });

  it('faixa avulsa (sem álbum) não tem álbum para tocar', async () => {
    const lib = await montar([faixa('local:1', 'You Can Do It', 259)]);
    expect(lib.faixasDoAlbumDe(lib.list()[0]!.track)).toBeNull();
  });
});
