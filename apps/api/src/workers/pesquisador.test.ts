/**
 * Agente pesquisador: as decisões puras — quem pesquisar, o que trazer.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({ env: {} }));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack: vi.fn() }));

const { escolherArtistas, faixaDoResultado, idiomaDaLetra, chaveDaMusica } =
  await import('./pesquisador.worker.js');

const r = (titulo: string, canal: string, duracaoSeg = 200) => ({
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  titulo,
  canal,
  duracaoSeg,
  capa: null,
});

describe('o que o pesquisador traz', () => {
  it('música do artista: título limpo', () => {
    expect(faixaDoResultado('Matuê', r('Matuê - Mantém (Clipe Oficial)', 'MatueVEVO'))).toEqual({
      title: 'Mantém',
      artists: ['Matuê'],
    });
  });

  it('de outro artista, versão mexida ou duração de short/mix: não', () => {
    expect(faixaDoResultado('Matuê', r('Teto - Paypal', 'Teto'))).toBeNull();
    expect(faixaDoResultado('Matuê', r('Matuê - Mantém (speed up)', 'Matuê'))).toBeNull();
    expect(faixaDoResultado('Matuê', r('Matuê - Mantém', 'Matuê', 40))).toBeNull();
    expect(faixaDoResultado('Matuê', r('Matuê - Show completo', 'Matuê', 3600))).toBeNull();
  });

  it('a mesma música em grafias diferentes tem a mesma chave', () => {
    expect(chaveDaMusica('Matuê', 'Mantém (Clipe Oficial)')).toBe(chaveDaMusica('MATUE', 'mantem'));
  });
});

describe('quem o pesquisador procura', () => {
  it('muito ouvido e pouco no acervo primeiro; quem já tem de sobra fica de fora', () => {
    const ouvidos = new Map([
      ['Matuê', 50],
      ['Teto', 30],
      ['Brandão85', 80],
    ]);
    const naBiblioteca = new Map([
      ['matue', 2],
      ['teto', 0],
      ['brandao85', 40],
    ]);
    expect(escolherArtistas(ouvidos, naBiblioteca, () => false, 2)).toEqual(['Matuê', 'Teto']);
  });

  it('artista descansando não é pesquisado', () => {
    const ouvidos = new Map([
      ['Matuê', 50],
      ['Teto', 30],
    ]);
    expect(escolherArtistas(ouvidos, new Map(), (n) => n === 'Matuê', 2)).toEqual(['Teto']);
  });
});

describe('idioma da letra', () => {
  it('pt e en', () => {
    expect(idiomaDaLetra('eu não sei o que você quer de mim')).toBe('pt');
    expect(idiomaDaLetra('i want you and the night is on my mind')).toBe('en');
  });
});
