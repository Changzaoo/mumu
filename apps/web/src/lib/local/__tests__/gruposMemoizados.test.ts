/**
 * O CUSTO DOS GRUPOS NO BOOT DA HOME — memoizado por versão do acervo, e cada
 * faixa passando uma vez só pelo trabalho caro.
 *
 * Medido no moto g34 emulado (5,7 mil faixas): `ensureGroups` 333 ms,
 * `collapseForDisplay` 230 ms, `dedupeParts` 131 ms. O resultado dos grupos não
 * muda; aqui se fixa só QUANTO se trabalha para chegar a ele.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

const chamadas = vi.hoisted(() => ({ canonico: 0 }));
vi.mock('@/lib/local/duplicadas', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/local/duplicadas')>();
  return {
    ...real,
    tituloCanonico: (t: string) => {
      chamadas.canonico += 1;
      return real.tituloCanonico(t);
    },
  };
});
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

const N = 40;

function entrada(i: number): LibraryEntry {
  return {
    track: makeTrack(`t${i}`, {
      title: `Música número ${i}`,
      genre: i % 2 ? 'Rock' : 'Pop',
      artists: [{ id: `a${i % 5}`, name: `Artista ${i % 5}`, slug: '', imageUrl: null }],
      album: { id: `al${i % 4}`, title: `Álbum ${i % 4}`, slug: '', coverUrl: null },
    }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
  };
}

async function montar() {
  window.localStorage.setItem(
    'aurial:library',
    JSON.stringify(Array.from({ length: N }, (_, i) => entrada(i))),
  );
  vi.resetModules();
  return import('@/lib/local/localLibrary');
}

describe('grupos da biblioteca', () => {
  beforeEach(() => {
    window.localStorage.clear();
    chamadas.canonico = 0;
  });

  it('álbuns + artistas + gêneros colapsam a biblioteca UMA vez, e cada faixa é normalizada uma vez só', async () => {
    const lib = await montar();
    chamadas.canonico = 0;

    lib.albumGroups();
    lib.artists();
    lib.genreGroups();
    // Antes: 2 vezes por faixa (1ª e 3ª passada do colapso) = 2·N.
    expect(chamadas.canonico).toBeLessThanOrEqual(N);
  });

  it('consultar de novo não refaz nada (memoizado até a biblioteca mudar)', async () => {
    const lib = await montar();
    const a = lib.genreGroups();
    chamadas.canonico = 0;
    expect(lib.genreGroups()).toBe(a);
    expect(lib.artists()).toBe(lib.artists());
    expect(lib.albumGroups()).toBe(lib.albumGroups());
    expect(chamadas.canonico).toBe(0);
  });

  it('o resultado é o de sempre: gêneros por tamanho, artistas por faixas', async () => {
    const lib = await montar();
    expect(lib.genreGroups().map((g) => [g.genre, g.tracks.length])).toEqual([
      ['Pop', 20],
      ['Rock', 20],
    ]);
    expect(lib.artists()).toHaveLength(5);
    expect(lib.artists()[0]!.trackCount).toBe(8);
  });
});
