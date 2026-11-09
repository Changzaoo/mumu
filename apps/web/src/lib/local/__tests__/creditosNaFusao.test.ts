/**
 * A MÚSICA NÃO SOME DA PÁGINA DO ARTISTA QUANDO DUAS CÓPIAS SE FUNDEM.
 *
 * A tela funde cópias da mesma música (`collapseForDisplay`) e mostra uma só.
 * As cópias, porém, chegam com créditos diferentes: a do clipe diz só "Mc IG",
 * a do álbum diz "MC IG, MC Ryan SP, MC PH, DJ Oreia". A fusão ficava com os
 * créditos de UMA delas, e a música desaparecia da página de todo artista que
 * só a outra citava — medido no acervo em 09/11/2026: 22 músicas distintas
 * sumidas de artistas que tinham várias.
 *
 * O que estes testes não podem deixar passar é o contrário: um artista novo
 * aparecendo numa música que não é dele, ou "Desconhecido" ao lado de um nome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibraryModule from '@/lib/local/localLibrary';

type LocalLibrary = typeof LocalLibraryModule;

vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

function faixa(id: string, title: string, artistas: string[], durationMs: number): TrackDto {
  return {
    id,
    title,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: artistas.map((name) => ({ id: `a:${name}`, name, slug: '', imageUrl: null })),
    streamUrl: null,
    uploadedByUserId: null,
  } as TrackDto;
}

const entrada = (track: TrackDto, addedAt = '2026-01-01T00:00:00.000Z'): LibraryEntry =>
  ({ track, addedAt, sizeBytes: 1000, mimeType: 'audio/mpeg' }) as LibraryEntry;

describe('créditos sobrevivem à fusão de cópias', () => {
  // Mesmo cuidado de acervoDoApp.test: a gravação do registro é adiada e,
  // sem relógio congelado, cairia no meio do teste seguinte.
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function montar(entradas: LibraryEntry[]): Promise<LocalLibrary> {
    window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
    vi.resetModules();
    return import('@/lib/local/localLibrary');
  }

  it('a música aparece na página de TODOS os artistas das duas cópias', async () => {
    const lib = await montar([
      // A cópia mais antiga (vence o desempate) tem o crédito curto.
      entrada(
        faixa('local:clipe', 'Esquadrilha da Fumaça', ['Mc IG'], 270_000),
        '2026-01-01T00:00:00.000Z',
      ),
      entrada(
        faixa(
          'local:album',
          'ESQUADRILHA DA FUMAÇA',
          ['MC IG', 'MC Ryan SP', 'MC PH', 'DJ Oreia'],
          271_000,
        ),
        '2026-02-01T00:00:00.000Z',
      ),
    ]);

    for (const artista of ['Mc IG', 'MC Ryan SP', 'MC PH', 'DJ Oreia']) {
      const titulos = lib.artistTracks(artista).map((t) => t.title.toLowerCase());
      expect(titulos, artista).toContain('esquadrilha da fumaça');
    }
    // Continua UMA música na tela, não duas.
    expect(lib.artistTracks('Mc IG')).toHaveLength(1);
  });

  it('o mesmo artista escrito de outro jeito não vira crédito duplicado', async () => {
    const lib = await montar([
      entrada(faixa('local:a', 'Larga o Oitão', ['MC Ryan SP', 'DJ GH'], 168_000)),
      entrada(
        faixa('local:b', 'Larga o Oitão', ['Mc Ryan SP'], 168_500),
        '2026-03-01T00:00:00.000Z',
      ),
    ]);
    const [unica] = lib.artistTracks('MC Ryan SP');
    expect(unica?.artists.map((a) => a.name)).toEqual(['MC Ryan SP', 'DJ GH']);
  });

  it('"Desconhecido" nunca entra ao lado de um nome real', async () => {
    const lib = await montar([
      entrada(faixa('local:a', 'Treat You Better', ['Shawn Mendes'], 257_000)),
      entrada(
        faixa('local:b', 'Treat You Better', ['Desconhecido'], 257_000),
        '2026-03-01T00:00:00.000Z',
      ),
    ]);
    const [unica] = lib.artistTracks('Shawn Mendes');
    expect(unica?.artists.map((a) => a.name)).toEqual(['Shawn Mendes']);
  });

  it('músicas diferentes do mesmo artista continuam TODAS na página', async () => {
    const titulos = ['Mercy', 'Treat You Better', 'Stitches', 'Wonder', 'In My Blood'];
    const lib = await montar(
      titulos.map((t, i) => entrada(faixa(`local:${i}`, t, ['Shawn Mendes'], 200_000 + i * 1000))),
    );
    expect(
      lib
        .artistTracks('Shawn Mendes')
        .map((t) => t.title)
        .sort(),
    ).toEqual([...titulos].sort());
  });
});
