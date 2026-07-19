/**
 * Os dois recursos que existem para a faixa que NENHUM catálogo tem — o caso
 * real do acervo de rap/trap nacional independente, onde o iTunes devolveu
 * zero resultados em 4 de 4 faixas testadas ao vivo.
 */
import { describe, expect, it } from 'vitest';
import { guessArtistFromSiblings, youtubeThumbFor } from '@/lib/local/localLibrary';
import type { LibraryEntry } from '@/lib/local/localLibrary';

function entry(
  id: string,
  artist: string | null,
  opts: { album?: string; addedAt?: string } = {},
): LibraryEntry {
  return {
    track: {
      id,
      title: `Faixa ${id}`,
      durationMs: 1000,
      trackNumber: null,
      discNumber: null,
      explicit: false,
      playsCount: 0,
      coverUrl: null,
      dominantColor: null,
      loudnessLufs: null,
      album: opts.album ? { id: 'al', title: opts.album, slug: 'al', coverUrl: null } : null,
      artists: artist ? [{ id: `a-${artist}`, name: artist, slug: '', imageUrl: null }] : [],
      streamUrl: null,
      uploadedByUserId: null,
    },
    addedAt: opts.addedAt ?? '2026-07-19T12:00:00.000Z',
    sizeBytes: 1,
    mimeType: 'audio/mpeg',
  };
}

describe('youtubeThumbFor', () => {
  it('extrai o id de uma URL longa do YouTube', () => {
    expect(youtubeThumbFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });

  it('extrai o id do formato curto youtu.be', () => {
    expect(youtubeThumbFor('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });

  it('usa hqdefault, que sempre existe — maxresdefault falta em muitos vídeos', () => {
    expect(youtubeThumbFor('https://youtu.be/dQw4w9WgXcQ')).toContain('hqdefault');
  });

  it('devolve null para host que não é YouTube', () => {
    expect(youtubeThumbFor('https://soundcloud.com/artista/faixa')).toBeNull();
  });

  it('devolve null para URL inválida ou sem id', () => {
    expect(youtubeThumbFor('nao é url')).toBeNull();
    expect(youtubeThumbFor('https://www.youtube.com/watch?list=abc')).toBeNull();
  });
});

describe('guessArtistFromSiblings', () => {
  it('deduz o artista pelas irmãs do MESMO álbum', () => {
    const orfa = entry('1', null, { album: 'TRAPLIFE' });
    const todas = [
      orfa,
      entry('2', 'Brandão85', { album: 'TRAPLIFE' }),
      entry('3', 'Brandão85', { album: 'TRAPLIFE' }),
    ];
    expect(guessArtistFromSiblings(orfa, todas)).toBe('Brandão85');
  });

  it('sem álbum, usa as importadas no MESMO lote (janela de tempo)', () => {
    const orfa = entry('1', null, { addedAt: '2026-07-19T12:00:00.000Z' });
    const todas = [
      orfa,
      entry('2', 'Brandão85', { addedAt: '2026-07-19T12:01:00.000Z' }),
      entry('3', 'Brandão85', { addedAt: '2026-07-19T12:02:00.000Z' }),
    ];
    expect(guessArtistFromSiblings(orfa, todas)).toBe('Brandão85');
  });

  it('ignora faixa importada muito depois — outro lote, outro artista', () => {
    const orfa = entry('1', null, { addedAt: '2026-07-19T12:00:00.000Z' });
    const todas = [orfa, entry('2', 'Outro Artista', { addedAt: '2026-07-19T20:00:00.000Z' })];
    expect(guessArtistFromSiblings(orfa, todas)).toBeNull();
  });

  it('recusa palpite dividido — contaminaria a busca', () => {
    const orfa = entry('1', null, { album: 'Coletânea' });
    const todas = [
      orfa,
      entry('2', 'Artista A', { album: 'Coletânea' }),
      entry('3', 'Artista B', { album: 'Coletânea' }),
    ];
    expect(guessArtistFromSiblings(orfa, todas)).toBeNull();
  });

  it('ignora irmãs que também estão sem artista', () => {
    const orfa = entry('1', null, { album: 'X' });
    const todas = [
      orfa,
      entry('2', null, { album: 'X' }),
      entry('3', 'Desconhecido', { album: 'X' }),
    ];
    expect(guessArtistFromSiblings(orfa, todas)).toBeNull();
  });

  it('devolve null quando a faixa está sozinha', () => {
    const orfa = entry('1', null);
    expect(guessArtistFromSiblings(orfa, [orfa])).toBeNull();
  });
});
