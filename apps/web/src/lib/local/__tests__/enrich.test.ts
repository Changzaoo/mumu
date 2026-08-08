import { beforeEach, describe, expect, it, vi } from 'vitest';
import { titleExact, identifyByTitle, parseTrackFileName } from '@/lib/local/enrich';
import { searchSongs, type AppleSong } from '@/lib/catalog/itunes';
import type * as itunes from '@/lib/catalog/itunes';
import { aiIdentifyTrack } from '@/lib/ai/ai';

// `appleArtwork` é lógica pura (reescrita da URL) — o mock usa a real, senão o
// teste de capa hi-res estaria conferindo o mock, não o comportamento.
vi.mock('@/lib/catalog/itunes', async (importOriginal) => ({
  ...(await importOriginal<typeof itunes>()),
  searchSongs: vi.fn(),
}));
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
      label: null,
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
      label: null,
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

/**
 * O ÁLBUM QUE APARECIA PELA METADE.
 *
 * Relato: "as músicas do Matuê do álbum XTRANHO não aparecem no catálogo". Elas
 * apareciam — sem ÁLBUM, então a página do XTRANHO mostrava uma faixa só.
 *
 * A causa foi uma assimetria: o app limpava os parênteses do NOSSO título antes
 * de comparar com o iTunes, mas não do título que o iTunes devolve. Sobrava um
 * "(feat. Fulano & Beltrano)" inteiro do outro lado, e a tolerância de 18
 * caracteres — calibrada para "ao vivo" e "remaster" — recusava.
 *
 * E recusar custava mais que o álbum: sem confirmação do catálogo a faixa fica
 * sem capa, sem álbum E sem gênero, e aí o classificador chuta. Foi assim que
 * "FACAS E MACHADOS", um trap do Matuê, foi parar em Sertanejo.
 */
describe('o mesmo título com lista de convidados', () => {
  // Medidos na biblioteca real, no acervo em produção.
  it('faixa com participação longa casa — era o caso que recusava', () => {
    expect(titleExact('ÍCONE FASHION (feat. Kouth & Pabllo Vittar)', 'ÍCONE FASHION')).toBe(true);
    expect(titleExact('FACAS E MACHADOS (feat. FAB GODAMN & Okie)', 'FACAS E MACHADOS')).toBe(true);
  });

  it('o que já casava continua casando', () => {
    expect(titleExact('OS MELHORES', 'OS MELHORES')).toBe(true);
    expect(titleExact('PENSAMENTOS PERIGOSOS (feat. LPT Zlatan)', 'PENSAMENTOS PERIGOSOS')).toBe(
      true,
    );
  });

  it('limpa os dois lados — tanto faz de que lado vem a participação', () => {
    expect(titleExact('MEU CEMITÉRIO', 'MEU CEMITÉRIO (feat. Alguém)')).toBe(true);
  });

  it('dois sufixos empilhados também', () => {
    expect(titleExact('Faixa (feat. X) [Remix]', 'Faixa')).toBe(true);
  });

  // ── e o que NÃO pode passar a casar ─────────────────────────────────────
  it('música diferente continua sendo música diferente', () => {
    expect(titleExact('ÍCONE FASHION', 'FACAS E MACHADOS')).toBe(false);
    expect(titleExact('Faixa Dois (feat. X)', 'Faixa')).toBe(false);
    expect(titleExact('Warzone', 'Warzone Freestyle')).toBe(false);
  });

  it('título vazio nunca casa com nada', () => {
    expect(titleExact('', 'Faixa')).toBe(false);
    expect(titleExact('(feat. X)', 'Faixa')).toBe(false);
  });
});

/**
 * SUFIXO SOLTO: "Faixa Ao Vivo" é a mesma música; "Faixa Dois" não é.
 *
 * A régua antiga era "cabe em 18 caracteres", e contar caracteres não distingue
 * versão de outra música: "Faixa Dois" casava com "Faixa" (12 de sobra) e
 * "Warzone Freestyle" com "Warzone" (9). Cada casamento desses dava à faixa o
 * álbum, a capa e o gênero de uma música que não é ela.
 */
describe('sufixo de versão versus outra música', () => {
  it('marcador de versão conhecido casa', () => {
    expect(titleExact('Só Os Loucos Ao Vivo', 'Só Os Loucos')).toBe(true);
    expect(titleExact('Warzone Remix', 'Warzone')).toBe(true);
    expect(titleExact('Quase Sem Querer Acústico', 'Quase Sem Querer')).toBe(true);
    expect(titleExact('Song Remastered 2011', 'Song')).toBe(true);
  });

  it('sobra desconhecida é OUTRA MÚSICA — recusa', () => {
    expect(titleExact('Faixa Dois', 'Faixa')).toBe(false);
    expect(titleExact('Warzone Freestyle', 'Warzone')).toBe(false);
    expect(titleExact('Amor Bandido', 'Amor')).toBe(false);
  });
});
