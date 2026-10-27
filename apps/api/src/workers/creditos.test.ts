/**
 * Créditos profundos: as decisões puras — qual gravação é a nossa, que papel
 * cada relação vira, como fontes se fundem, o que o Discogs entrega.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  env: { MUNDO_USER_AGENT: 'teste', DISCOGS_TOKEN: undefined },
}));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: {} }));

const f = await import('./creditos.fontes.js');

describe('nomes e papéis', () => {
  it('um crédito "A & B" vira duas pessoas com chave de identidade; gravadora não se parte', () => {
    expect(f.creditosDoNome('PRODUTOR', 'Pharrell Williams & Chad Hugo', 'musicbrainz')).toEqual([
      expect.objectContaining({ nome: 'Pharrell Williams', chave: 'pharrellwilliams' }),
      expect.objectContaining({ nome: 'Chad Hugo', chave: 'chadhugo' }),
    ]);
    expect(f.creditosDoNome('GRAVADORA', 'Som Livre', 'acervo')).toEqual([
      expect.objectContaining({ nome: 'Som Livre', papel: 'GRAVADORA' }),
    ]);
    expect(f.creditosDoNome('COMPOSITOR', '', 'acervo')).toEqual([]);
  });

  it('relações do MusicBrainz e papéis do Discogs viram o mesmo vocabulário', () => {
    expect(f.papelDaRelacaoMB('producer')).toBe('PRODUTOR');
    expect(f.papelDaRelacaoMB('mix')).toBe('MIXAGEM');
    expect(f.papelDaRelacaoMB('lyricist')).toBe('LETRISTA');
    expect(f.papelDaRelacaoMB('vocal')).toBe('INTERPRETE');
    expect(f.papelDaRelacaoMB('samples from artist')).toBeNull();
    expect(f.papelDoDiscogs('Written-By')).toBe('COMPOSITOR');
    expect(f.papelDoDiscogs('Executive-Producer')).toBe('PRODUTOR');
    expect(f.papelDoDiscogs('Mastered By')).toBe('MASTERIZACAO');
    expect(f.papelDoDiscogs('Management')).toBe('EMPRESARIO');
    expect(f.papelDoDiscogs('Design')).toBeNull();
    expect(f.papelDaEmpresaDiscogs('Published By')).toBe('EDITORA');
    expect(f.papelDoSeloMB('Imprint')).toBe('SELO');
    expect(f.papelDoSeloMB('Original Production')).toBe('GRAVADORA');
    expect(f.papelDoSeloMB('Publisher')).toBe('EDITORA');
    expect(f.papelDoSeloMB(undefined)).toBe('GRAVADORA');
    expect(f.nomeDoDiscogs('Mano Brown (2)')).toBe('Mano Brown');
  });
});

describe('qual gravação é a nossa', () => {
  it('título e artista precisam casar; sufixo de versão passa; artista errado não', () => {
    const candidatas = [
      { id: 'a', title: 'Mantém', score: 100, 'artist-credit': [{ name: 'Matuê' }] },
      {
        id: 'b',
        title: 'Mantém (Ao Vivo)',
        score: 90,
        'artist-credit': [{ artist: { name: 'Matuê' } }],
      },
      { id: 'c', title: 'Mantém', score: 95, 'artist-credit': [{ name: 'Teto' }] },
    ];
    expect(f.escolherGravacaoMB('Mantém', 'Matuê', candidatas)?.id).toBe('a');
    expect(f.escolherGravacaoMB('Mantém', 'Teto', candidatas)?.id).toBe('c');
    expect(f.escolherGravacaoMB('Outra', 'Matuê', candidatas)).toBeNull();
    expect(f.escolherGravacaoMB('Mantém', 'Anitta', candidatas)).toBeNull();
  });
});

describe('fundir fontes', () => {
  it('mesmo papel e mesma pessoa viram um crédito, com as fontes somadas', () => {
    const fundidos = f.fundirCreditos([
      { papel: 'PRODUTOR', nome: 'WIU', chave: 'wiu', fonte: 'discogs' },
      { papel: 'PRODUTOR', nome: 'Wiu', chave: 'wiu', fonte: 'musicbrainz' },
      { papel: 'COMPOSITOR', nome: 'Wiu', chave: 'wiu', fonte: 'acervo' },
    ]);
    expect(fundidos).toHaveLength(2);
    const produtor = fundidos.find((c) => c.papel === 'PRODUTOR');
    expect(produtor?.nome).toBe('Wiu');
    expect(produtor?.fonte).toBe('musicbrainz');
    expect(produtor?.dados?.fontes).toEqual(['discogs', 'musicbrainz']);
  });

  it('o acervo entra sem rede: compositor da tag e gravadora', () => {
    expect(
      f.creditosDoAcervo({ composer: 'Caetano Veloso, Gilberto Gil', label: 'Philips' }),
    ).toEqual([
      expect.objectContaining({ papel: 'COMPOSITOR', nome: 'Caetano Veloso', fonte: 'acervo' }),
      expect.objectContaining({ papel: 'COMPOSITOR', nome: 'Gilberto Gil' }),
      expect.objectContaining({ papel: 'GRAVADORA', nome: 'Philips' }),
    ]);
  });
});

describe('créditos do Discogs', () => {
  it('faixa primeiro, disco completa o que falta; selo e editora entram', () => {
    const creditos = f.creditosDoDiscogs(
      {
        id: 1,
        extraartists: [
          { name: 'Rick Rubin', role: 'Producer' },
          { name: 'Bob Ludwig', role: 'Mastered By' },
        ],
        labels: [{ name: 'Def Jam Recordings', id: 7 }],
        companies: [{ name: 'Universal Music Publishing', entity_type_name: 'Published By' }],
        tracklist: [
          { title: 'Intro', extraartists: [{ name: 'Alguém (2)', role: 'Producer' }] },
          {
            title: 'Fight the Power',
            extraartists: [
              { name: 'The Bomb Squad', role: 'Producer' },
              { name: 'Chuck D', role: 'Written-By' },
            ],
          },
        ],
      },
      'Fight the Power',
    );
    const por = (papel: string) => creditos.filter((c) => c.papel === papel).map((c) => c.nome);
    // O produtor da FAIXA vence o do disco; a masterização do disco vale.
    expect(por('PRODUTOR')).toEqual(['The Bomb Squad']);
    expect(por('COMPOSITOR')).toEqual(['Chuck D']);
    expect(por('MASTERIZACAO')).toEqual(['Bob Ludwig']);
    expect(por('GRAVADORA')).toEqual(['Def Jam Recordings']);
    expect(por('EDITORA')).toEqual(['Universal Music Publishing']);
  });
});
