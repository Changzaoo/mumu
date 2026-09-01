/**
 * A PORTA ENTRE IDENTIFICAÇÃO E PALPITE.
 *
 * A busca de letras devolve "a mais parecida". Aceitar isso significaria, em
 * algum momento, atribuir a letra de um funk a um louvor — e o sistema inteiro
 * de proteção passaria a produzir exatamente o erro que veio impedir.
 *
 * Estes testes travam as três exigências. Nenhuma delas é dispensável.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({ env: { CLASSIFICAR_CONTEUDO: true } }));
vi.mock('../core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack: vi.fn() }));

const { mesmaGravacao } = await import('./conteudoDaFaixa.worker.js');

const alvo = { titulo: 'Coração Valente', artista: 'Ministério Vida', duracaoS: 210 };

describe('mesmaGravacao', () => {
  it('aceita a mesma gravação escrita de outro jeito', () => {
    // Acento, caixa e pontuação não mudam qual música é.
    expect(
      mesmaGravacao(alvo, {
        titulo: 'coracao valente',
        artista: 'MINISTERIO VIDA',
        duracaoS: 210,
      }),
    ).toBe(true);
  });

  it('aceita sufixo de versão — mesma canção, mesma letra', () => {
    // "Ao Vivo", "Remaster", "Clipe Oficial" são a mesma letra. Sem isto, cada
    // grafia vira uma faixa que o sistema não consegue identificar — e não
    // saber é o que trava o filtro.
    expect(
      mesmaGravacao(alvo, {
        titulo: 'Coração Valente (Ao Vivo)',
        artista: 'Ministério Vida',
        duracaoS: 212,
      }),
    ).toBe(true);
  });

  it('RECUSA artista diferente, por mais que o título bata', () => {
    // O caso perigoso: mesma canção, outro intérprete, outra letra possível.
    expect(
      mesmaGravacao(alvo, { titulo: 'Coração Valente', artista: 'MC Outro', duracaoS: 210 }),
    ).toBe(false);
  });

  it('RECUSA título diferente do mesmo artista', () => {
    expect(
      mesmaGravacao(alvo, { titulo: 'Outra Canção', artista: 'Ministério Vida', duracaoS: 210 }),
    ).toBe(false);
  });

  it('RECUSA duração fora da tolerância — versões têm letras diferentes', () => {
    // Estúdio e ao vivo do mesmo artista com o mesmo nome existem, e a letra
    // pode divergir. Três segundos separam corte e arredondamento de outra
    // gravação.
    expect(
      mesmaGravacao(alvo, {
        titulo: 'Coração Valente',
        artista: 'Ministério Vida',
        duracaoS: 260,
      }),
    ).toBe(false);
  });

  it('tolera diferença de arredondamento entre fontes', () => {
    expect(
      mesmaGravacao(alvo, { titulo: 'Coração Valente', artista: 'Ministério Vida', duracaoS: 213 }),
    ).toBe(true);
  });

  it('duração ausente na resposta nunca casa', () => {
    expect(
      mesmaGravacao(alvo, { titulo: 'Coração Valente', artista: 'Ministério Vida', duracaoS: -1 }),
    ).toBe(false);
  });
});
