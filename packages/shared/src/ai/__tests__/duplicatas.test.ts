/**
 * O QUE O DETECTOR NÃO PODE FUNDIR, E O QUANTO ELE PODE DEMORAR.
 *
 * A suíte antiga (`src/__tests__/duplicatas.test.ts`) cobre as regras de
 * decisão. Aqui ficam dois buracos que ela não via — e os dois foram medidos
 * antes de serem consertados.
 */
import { describe, expect, it } from 'vitest';
import { agruparDuplicatas, saoAMesma, type FaixaComparavel } from '../duplicatas.js';

function f(over: Partial<FaixaComparavel> & { id: string }): FaixaComparavel {
  return {
    title: 'Raridade',
    artists: ['Anderson Freire'],
    durationMs: 250_000,
    ...over,
  };
}

/**
 * O SELO CONFIRMAVA TUDO COM TUDO.
 *
 * Faixa importada do canal da gravadora nasce com "MK MUSIC" na lista de
 * artistas. Como bastava UM nome coincidir para o artista "confirmar", o selo
 * abria o portão entre faixas de cantores DIFERENTES — e a partir dali só o
 * título decidia. Duas gravações da mesma música, de duas pessoas, publicadas
 * pelo mesmo selo: o detector fundia, e uma delas era apagada sem ninguém ver.
 * É exatamente o caso que este módulo promete nunca fundir.
 */
describe('saoAMesma — o selo na lista de artistas não é prova de quem canta', () => {
  it('NÃO funde regravação de dois cantores do mesmo selo', () => {
    const a = f({ id: '1', artists: ['MK MUSIC', 'Anderson Freire'] });
    const b = f({ id: '2', artists: ['MK MUSIC', 'Isadora Pompeo'], durationMs: 251_000 });
    expect(saoAMesma(a, b)).toBeNull();
  });

  it('faixa creditada SÓ ao selo não sabe de nada e não contradiz ninguém', () => {
    // Sem cantor de nenhum dos lados, o título e a duração carregam sozinhos —
    // e a barra é a alta (0.97), como em qualquer faixa sem artista.
    const a = f({ id: '1', artists: ['MK MUSIC'], durationMs: 250_000 });
    const b = f({ id: '2', artists: ['MK MUSIC'], durationMs: 250_500 });
    expect(saoAMesma(a, b)).toContain('sem artista para conferir');
  });

  it('e o mesmo cantor com o selo junto continua sendo o mesmo cantor', () => {
    const a = f({ id: '1', artists: ['MK MUSIC', 'Anderson Freire'] });
    const b = f({ id: '2', artists: ['Anderson Freire'], durationMs: 251_000 });
    expect(saoAMesma(a, b)).not.toBeNull();
  });
});

/**
 * DEZESSEIS SEGUNDOS PARA 2.000 FAIXAS — e a biblioteca real tem 4.431.
 *
 * A varredura comparava todo mundo com todo mundo e relimpava o mesmo título
 * milhares de vezes. O worker roda isso em volta, o tempo todo, e ficava preso
 * nela. O orçamento aqui é folgado de propósito: o que ele trava é a ORDEM de
 * grandeza, não o número da máquina de quem rodar.
 */
describe('agruparDuplicatas — a varredura da biblioteca inteira', () => {
  const PALAVRAS = 'amor deus vida coracao ao vivo saudade noite chuva eu te amo sol mar'.split(
    ' ',
  );
  const biblioteca = (n: number): FaixaComparavel[] => {
    let s = 12_345;
    const rnd = (): number => (s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const palavra = (): string => PALAVRAS[Math.floor(rnd() * PALAVRAS.length)]!;
    return Array.from({ length: n }, (_, i) => ({
      id: String(i),
      title: `${palavra()} ${palavra()} ${palavra()} (Official Music Video)`,
      artists: [`Artista ${i % 300}`],
      durationMs: 120_000 + Math.floor(rnd() * 240_000),
    }));
  };

  it('2.000 faixas em menos de 2 segundos', () => {
    const t0 = Date.now();
    agruparDuplicatas(biblioteca(2_000));
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('e a biblioteca real, de 4.431, também', () => {
    const t0 = Date.now();
    agruparDuplicatas(biblioteca(4_431));
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('o atalho não perde duplicata nenhuma', () => {
    // O índice por palavra do título só descarta par que não tem UMA palavra em
    // comum — e sem palavra em comum a semelhança é zero de qualquer jeito.
    // Estas três estão no meio de mil faixas que não têm nada a ver com elas.
    const ruido = biblioteca(1_000).map((x) => ({ ...x, id: `r${x.id}` }));
    const grupos = agruparDuplicatas([
      ...ruido.slice(0, 500),
      f({ id: 'a', title: 'Evidências', addedAt: '2026-01-01T00:00:00Z' }),
      ...ruido.slice(500),
      f({ id: 'b', title: 'Evidências (Official Video)', durationMs: 251_000 }),
      f({ id: 'c', title: 'EVIDENCIAS [Clipe Oficial]', durationMs: 249_000 }),
    ]);
    const nosso = grupos.find((g) => [g.manter, ...g.remover].some((x) => x.id === 'a'));
    expect(nosso?.remover).toHaveLength(2);
    expect(nosso?.manter.id).toBe('a');
  });
});
