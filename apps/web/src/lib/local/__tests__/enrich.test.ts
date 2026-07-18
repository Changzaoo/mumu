import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identifyByTitle, parseTrackFileName } from '@/lib/local/enrich';
import { searchSongs, type AppleSong } from '@/lib/catalog/itunes';
import { aiIdentifyTrack } from '@/lib/ai/ai';

vi.mock('@/lib/catalog/itunes', () => ({ searchSongs: vi.fn() }));
vi.mock('@/lib/ai/ai', () => ({ aiIdentifyTrack: vi.fn(), aiSplitArtists: vi.fn() }));

const mockSearch = vi.mocked(searchSongs);
const mockAi = vi.mocked(aiIdentifyTrack);

const song = (id: number, trackName: string, artistName: string): AppleSong => ({
  trackId: id,
  trackName,
  artistName,
  artistId: id,
  collectionName: 'Um Álbum',
  collectionId: id,
  artworkUrl100: 'https://is1.mzstatic.com/image/100x100bb.jpg',
  previewUrl: 'https://audio.itunes.apple.com/p.m4a',
  trackTimeMillis: 200000,
  trackExplicitness: 'notExplicit',
  primaryGenreName: 'Rock',
});

beforeEach(() => {
  vi.resetAllMocks();
  mockAi.mockResolvedValue(null);
});

describe('parseTrackFileName — nome de arquivo', () => {
  it('separa "Artista - Título"', () => {
    expect(parseTrackFileName('Matuê - Máquina do Tempo.mp3')).toEqual({
      artist: 'Matuê',
      title: 'Máquina do Tempo',
    });
  });

  it('descarta o número de faixa antes do título', () => {
    expect(parseTrackFileName('01 - Sozinho.mp3')).toEqual({ artist: null, title: 'Sozinho' });
  });

  it('limpa o ruído de título de YouTube', () => {
    expect(parseTrackFileName('Anitta - Envolver (Official Video).mp3')).toEqual({
      artist: 'Anitta',
      title: 'Envolver',
    });
  });

  it('sem pista de artista devolve null — nunca inventa "Desconhecido" aqui', () => {
    expect(parseTrackFileName('audio (1).m4a')).toEqual({ artist: null, title: 'audio (1)' });
  });

  it('hífen colado NÃO separa artista (Spider-Man não é o artista "Spider")', () => {
    expect(parseTrackFileName('Spider-Man Theme.mp3')).toEqual({
      artist: null,
      title: 'Spider-Man Theme',
    });
  });

  it('troca underline por espaço', () => {
    expect(parseTrackFileName('Djavan_-_Oceano.mp3')).toEqual({
      artist: 'Djavan',
      title: 'Oceano',
    });
  });
});

describe('identifyByTitle — lente de TÍTULO (só sem crédito a proteger)', () => {
  it('adota o artista quando o catálogo é unânime no título exato', async () => {
    mockSearch.mockResolvedValue([
      song(1, 'Máquina do Tempo', 'Matuê'),
      song(2, 'Máquina do Tempo', 'Matuê'), // outra edição, mesmo artista
      song(3, 'Outra Música', 'Outro Artista'), // título não bate → ignorado
    ]);
    const meta = await identifyByTitle('Máquina do Tempo');
    expect(meta?.artist).toBe('Matuê');
    expect(meta?.album).toBe('Um Álbum');
    expect(meta?.genre).toBe('Rock');
    expect(meta?.coverUrl).toContain('600x600bb');
  });

  it('título disputado sem segundo parecer da IA NÃO vira crédito', async () => {
    mockSearch.mockResolvedValue([song(1, 'Amor', 'Artista A'), song(2, 'Amor', 'Artista B')]);
    expect(await identifyByTitle('Amor')).toBeNull();
  });

  it('a IA desempata, mas só entre os candidatos do catálogo', async () => {
    mockSearch.mockResolvedValue([
      song(1, 'Warzone', 'The Wanted'),
      song(2, 'Warzone', 'Brandão85'),
    ]);
    mockAi.mockResolvedValue({
      title: 'Warzone',
      artists: ['Brandão85'],
      album: null,
      genre: null,
    });
    expect((await identifyByTitle('Warzone'))?.artist).toBe('Brandão85');
  });

  it('a IA NÃO pode introduzir um artista que o catálogo não lista', async () => {
    mockSearch.mockResolvedValue([song(1, 'Warzone', 'The Wanted'), song(2, 'Warzone', 'Fulano')]);
    mockAi.mockResolvedValue({
      title: 'Warzone',
      artists: ['Um Artista Inventado'],
      album: null,
      genre: null,
    });
    expect(await identifyByTitle('Warzone')).toBeNull();
  });

  it('título que só bate por pedaço não é match', async () => {
    mockSearch.mockResolvedValue([song(1, 'Máquina do Tempo Perdido', 'Outro')]);
    expect(await identifyByTitle('Máquina do Tempo')).toBeNull();
  });

  it('título genérico demais nem chega a procurar', async () => {
    expect(await identifyByTitle('01')).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('catálogo fora do ar devolve null em vez de lançar', async () => {
    mockSearch.mockRejectedValue(new Error('rede'));
    await expect(identifyByTitle('Máquina do Tempo')).resolves.toBeNull();
  });
});
