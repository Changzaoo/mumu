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

const { mesmaGravacao, mesmoNomeEArtista, veredictoDe } =
  await import('./conteudoDaFaixa.worker.js');

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

describe('veredictoDe — identificação fraca condena, não absolve', () => {
  // 1.677 das 5.058 faixas do acervo estão sem duração. Exigi-la fazia o agente
  // desistir ANTES de consultar qualquer coisa, e foi isso — não o casamento —
  // que manteve 77% do acervo sem veredito.
  //
  // Sem a duração, artista e título iguais quase sempre são a mesma canção, mas
  // podem ser um remix com verso convidado. A assimetria abaixo é o preço de
  // usar essa identificação sem abrir mão da garantia.
  const explicita = { veredicto: 'explicito' as const, categorias: [], achados: ['caralho'] };
  const limpa = { veredicto: 'limpo' as const, categorias: [], achados: [] };

  it('com identificação CERTA, o veredito passa como está', () => {
    expect(veredictoDe(limpa, 'certa').veredicto).toBe('limpo');
    expect(veredictoDe(explicita, 'certa').veredicto).toBe('explicito');
  });

  it('com identificação FRACA, ainda CONDENA', () => {
    // Errar aqui custa uma música a menos numa fila.
    expect(veredictoDe(explicita, 'fraca').veredicto).toBe('explicito');
  });

  it('com identificação FRACA, NUNCA absolve', () => {
    // Chamar de `limpo` uma faixa cuja letra pode não ser dela a liberaria para
    // o rádio de louvor com base em palpite. Errar ali custa a pessoa.
    expect(veredictoDe(limpa, 'fraca').veredicto).toBe('desconhecido');
  });

  it('mesmoNomeEArtista ignora duração mas não perdoa artista', () => {
    const alvo = { titulo: 'Canção', artista: 'Fulano', duracaoS: 0 };
    expect(
      mesmoNomeEArtista(alvo, { titulo: 'Canção (Ao Vivo)', artista: 'FULANO', duracaoS: 0 }),
    ).toBe(true);
    expect(mesmoNomeEArtista(alvo, { titulo: 'Canção', artista: 'Outro', duracaoS: 0 })).toBe(
      false,
    );
  });
});
