/**
 * O casamento de álbum é ESTRITO: título igual, artista igual, duração como
 * prova. Errar aqui põe uma música no disco errado — pior do que deixá-la
 * solta, que é o estado de hoje.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  candidatosDoDeezer,
  candidatosDoItunes,
  escolherCandidato,
  procurarAlbum,
  type Candidato,
} from './albuns.js';

const cand = (
  c: Partial<Candidato> & { title: string; artist: string; album: string },
): Candidato => ({
  durationMs: null,
  trackNumber: null,
  discNumber: null,
  trackCount: null,
  releaseYear: null,
  coverUrl: null,
  ...c,
});

describe('escolherCandidato', () => {
  it('título e artista batem, sem duração: aceita; prefere o disco ao single', () => {
    const r = escolherCandidato({ title: 'Toxic', artists: ['Britney Spears'] }, [
      cand({ title: 'Toxic', artist: 'Britney Spears', album: 'Toxic - Single', trackCount: 1 }),
      cand({
        title: 'Toxic',
        artist: 'Britney Spears',
        album: 'In the Zone',
        trackCount: 13,
        trackNumber: 6,
      }),
    ]);
    expect(r?.album).toBe('In the Zone');
  });

  it('artista diferente não serve, por mais que o título bata', () => {
    const r = escolherCandidato({ title: 'Carolina', artists: ['Seu Jorge'] }, [
      cand({ title: 'Carolina', artist: 'Ninho', album: 'Destin' }),
    ]);
    expect(r).toBeNull();
  });

  it('duração muito diferente é outra gravação: rejeita', () => {
    const r = escolherCandidato({ title: 'Mantém', artists: ['Matuê'], durationMs: 206_000 }, [
      cand({ title: 'Mantém', artist: 'Matuê', album: 'Ao Vivo', durationMs: 290_000 }),
    ]);
    expect(r).toBeNull();
  });

  it('com duração, vence a gravação mais próxima; dentro de 5 s, vence o disco', () => {
    const r = escolherCandidato(
      { title: 'Evidências', artists: ['Chitãozinho & Xororó'], durationMs: 270_000 },
      [
        cand({
          title: 'Evidências',
          artist: 'Chitãozinho & Xororó',
          album: 'Evidências - Single',
          durationMs: 271_000,
          trackCount: 1,
        }),
        cand({
          title: 'Evidências',
          artist: 'Chitãozinho & Xororó',
          album: 'Cowboy do Asfalto',
          durationMs: 268_000,
          trackCount: 12,
        }),
        cand({
          title: 'Evidências',
          artist: 'Chitãozinho & Xororó',
          album: 'Ao Vivo',
          durationMs: 258_000,
          trackCount: 20,
        }),
      ],
    );
    expect(r?.album).toBe('Cowboy do Asfalto');
  });

  it('ruído de vídeo no título e convidado não impedem o casamento', () => {
    const r = escolherCandidato(
      { title: 'Lancha do Bololô (Clipe Oficial) feat. MC IG', artists: ['MC Luuky'] },
      [
        cand({
          title: 'Lancha do Bololô',
          artist: 'MC Luuky',
          album: 'Lancha do Bololô',
          trackNumber: 1,
        }),
      ],
    );
    expect(r?.album).toBe('Lancha do Bololô');
  });

  it('nome de artista curto não casa por "contém"', () => {
    const r = escolherCandidato({ title: 'Go', artists: ['AL'] }, [
      cand({ title: 'Go', artist: 'Alok', album: 'X' }),
    ]);
    expect(r).toBeNull();
  });
});

describe('capa própria da música', () => {
  it('a arte do single com o nome da faixa é a capa dela; sem single, null', async () => {
    const { capaDoSingleEntre, miniaturaDoVideo } = await import('./albuns.js');
    const faixa = { title: 'Toxic', artists: ['Britney Spears'] };
    expect(
      capaDoSingleEntre(faixa, [
        cand({
          title: 'Toxic',
          artist: 'Britney Spears',
          album: 'In the Zone',
          coverUrl: 'album.jpg',
          trackCount: 13,
        }),
        cand({
          title: 'Toxic',
          artist: 'Britney Spears',
          album: 'Toxic',
          coverUrl: 'single.jpg',
          trackCount: 1,
        }),
      ]),
    ).toBe('single.jpg');
    expect(
      capaDoSingleEntre(faixa, [
        cand({
          title: 'Toxic',
          artist: 'Britney Spears',
          album: 'In the Zone',
          coverUrl: 'album.jpg',
          trackCount: 13,
        }),
      ]),
    ).toBeNull();
    expect(miniaturaDoVideo('https://www.youtube.com/watch?v=LOZuxwVk7TU')).toBe(
      'https://i.ytimg.com/vi/LOZuxwVk7TU/hqdefault.jpg',
    );
    expect(miniaturaDoVideo('https://youtu.be/LOZuxwVk7TU')).toBe(
      'https://i.ytimg.com/vi/LOZuxwVk7TU/hqdefault.jpg',
    );
    expect(miniaturaDoVideo('https://soundcloud.com/x/y')).toBeNull();
    expect(miniaturaDoVideo(null)).toBeNull();
  });
});

describe('leitores das fontes', () => {
  it('Deezer: duração em segundos vira ms; álbum e capa vêm da busca', () => {
    const c = candidatosDoDeezer({
      data: [
        {
          id: 7,
          title: 'Toxic',
          duration: 198,
          artist: { name: 'Britney Spears' },
          album: { id: 9, title: 'In the Zone', cover_xl: 'x.jpg' },
        },
      ],
    });
    expect(c[0]).toMatchObject({
      durationMs: 198_000,
      album: 'In the Zone',
      coverUrl: 'x.jpg',
      deezerTrackId: 7,
      deezerAlbumId: 9,
    });
  });

  it('iTunes: número, disco, total e ano vêm na própria busca; capa sobe para 600px', () => {
    const c = candidatosDoItunes({
      results: [
        {
          trackName: 'Toxic',
          artistName: 'Britney Spears',
          collectionName: 'In the Zone',
          trackNumber: 6,
          discNumber: 1,
          trackCount: 13,
          releaseDate: '2003-11-12T08:00:00Z',
          artworkUrl100: 'https://x/100x100bb.jpg',
          trackTimeMillis: 198_000,
        },
      ],
    });
    expect(c[0]).toMatchObject({
      trackNumber: 6,
      discNumber: 1,
      trackCount: 13,
      releaseYear: 2003,
      coverUrl: 'https://x/600x600bb.jpg',
    });
  });
});

describe('procurarAlbum', () => {
  it('Deezer acha: completa número/disco com /track e total com /album', async () => {
    const chamadas: string[] = [];
    const fetchFalso = vi.fn(async (url: string) => {
      chamadas.push(url);
      const corpo = url.includes('/search')
        ? {
            data: [
              {
                id: 7,
                title: 'Toxic',
                duration: 198,
                artist: { name: 'Britney Spears' },
                album: { id: 9, title: 'In the Zone', cover_xl: 'x.jpg' },
              },
            ],
          }
        : url.includes('/track/7')
          ? {
              track_position: 6,
              disk_number: 1,
              release_date: '2003-11-12',
              album: { id: 9, title: 'In the Zone', cover_xl: 'x.jpg' },
            }
          : { nb_tracks: 13, release_date: '2003-11-12' };
      return { ok: true, status: 200, json: async () => corpo };
    });
    const r = await procurarAlbum(
      { title: 'Toxic', artists: ['Britney Spears'], durationMs: 199_000 },
      { fetch: fetchFalso },
    );
    expect(r).toEqual({
      album: 'In the Zone',
      trackNumber: 6,
      discNumber: 1,
      trackCount: 13,
      releaseYear: 2003,
      coverUrl: 'x.jpg',
      capaDoSingle: null,
      fonte: 'deezer',
    });
    expect(chamadas.some((u) => u.includes('itunes'))).toBe(false);
  });

  it('Deezer sem casamento: cai no iTunes; nada em lugar nenhum: null, sem lançar', async () => {
    const fetchFalso = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('itunes')
          ? {
              results: [
                {
                  trackName: 'Ring of Fire',
                  artistName: 'Johnny Cash',
                  collectionName: 'Ring of Fire: The Best of Johnny Cash',
                  trackNumber: 1,
                  trackCount: 12,
                },
              ],
            }
          : { data: [] },
    }));
    const r = await procurarAlbum(
      { title: 'Ring of Fire', artists: ['Johnny Cash'] },
      { fetch: fetchFalso },
    );
    expect(r).toMatchObject({ album: 'Ring of Fire: The Best of Johnny Cash', fonte: 'itunes' });

    const vazio = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(
      procurarAlbum({ title: 'X', artists: ['Y'] }, { fetch: vazio }),
    ).resolves.toBeNull();

    const caiu = vi.fn(async () => {
      throw new Error('rede');
    });
    await expect(
      procurarAlbum({ title: 'X', artists: ['Y'] }, { fetch: caiu }),
    ).resolves.toBeNull();
  });
});
