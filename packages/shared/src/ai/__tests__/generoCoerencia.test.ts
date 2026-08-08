/**
 * A REVISÃO DE GÊNERO REESCREVE CATEGORIA QUE JÁ ESTÁ GRAVADA — e ninguém
 * revisa o revisor.
 *
 * A suíte antiga (`src/__tests__/genero.test.ts`) prova que a 3ª passada salva
 * "Raridade". Estes testes vão pelo outro lado: o que acontece com um artista
 * que NÃO é o Anderson Freire. Todos os cenários abaixo foram medidos antes —
 * os três primeiros faziam estrago de verdade.
 */
import { describe, expect, it } from 'vitest';
import { revisarGeneros, type FaixaMinima } from '../generoCoerencia.js';

const f = (id: string, genre: string | null, artista: string): FaixaMinima => ({
  id,
  genre,
  artistas: [artista],
});
const varias = (n: number, prefixo: string, genero: string, artista: string): FaixaMinima[] =>
  Array.from({ length: n }, (_, i) => f(`${prefixo}${i}`, genero, artista));

describe('revisarGeneros — o dano que a maioria pode fazer', () => {
  it('2 faixas Gospel não arrastam 5 de outra coisa', () => {
    // O cenário que se temia: um artista com duas gospel no meio do repertório
    // teria a carreira inteira reclassificada. Não acontece — a apuração vê que
    // o dominante é o outro gênero e a 3ª passada nem começa.
    const mudancas = revisarGeneros([
      ...varias(2, 'g', 'Gospel', 'Brandão85'),
      ...varias(5, 't', 'Trap', 'Brandão85'),
    ]);
    expect(mudancas).toEqual([]);
  });

  it('EMPATE não é maioria — 2 e 2 não viram 4', () => {
    // A apuração tira a faixa em julgamento para ela não votar em si mesma, e
    // isso viciava a balança: 2 contra 2 virava 2 contra 1 para CADA faixa
    // sertaneja, uma de cada vez, e as duas eram convertidas para Gospel.
    const mudancas = revisarGeneros([
      ...varias(2, 'g', 'Gospel', 'Fulano'),
      ...varias(2, 's', 'Sertanejo', 'Fulano'),
    ]);
    expect(mudancas).toEqual([]);
  });

  it('nem 3 e 3 — o repertório inteiro de um artista misto virava Gospel', () => {
    const mudancas = revisarGeneros([
      ...varias(3, 'g', 'Gospel', 'Fulano'),
      ...varias(3, 'r', 'Rock', 'Fulano'),
    ]);
    expect(mudancas).toEqual([]);
  });

  it('maioria de verdade continua puxando', () => {
    // 3 de 5 é maioria contando a faixa julgada — e aí a regra age.
    const mudancas = revisarGeneros([
      ...varias(3, 'g', 'Gospel', 'Sarah Farias'),
      f('s1', 'Sertanejo', 'Sarah Farias'),
    ]);
    expect(mudancas.find((m) => m.id === 's1')?.para).toBe('Gospel');
  });
});

/**
 * A 2ª PASSADA EMPURRAVA DE VOLTA O QUE A 3ª TINHA ACABADO DE PUXAR.
 *
 * A fonte erra sempre na mesma direção — gospel brasileiro entra como sertanejo,
 * forró ou trap. Num cantor de louvor mal importado, com 2 faixas certas em
 * Gospel e 3 erradas em Sertanejo, o sertanejo era a MAIORIA: a regra do outlier
 * convertia as duas faixas certas e cimentava o erro, esvaziando a prateleira
 * Gospel de vez.
 */
describe('revisarGeneros — Gospel não sai por maioria', () => {
  it('não converte faixa Gospel para o gênero errado que domina', () => {
    const mudancas = revisarGeneros([
      ...varias(2, 'g', 'Gospel', 'Cantor Mal Importado'),
      ...varias(3, 's', 'Sertanejo', 'Cantor Mal Importado'),
    ]);
    expect(mudancas.filter((m) => m.de === 'Gospel')).toEqual([]);
  });

  it('mas o outlier comum continua sendo corrigido', () => {
    // Pop e Rock são escolha por faixa: com prova forte, a regra age.
    const mudancas = revisarGeneros([
      ...varias(4, 'p', 'Pop', 'Popstar'),
      f('r1', 'Rock', 'Popstar'),
    ]);
    expect(mudancas.find((m) => m.id === 'r1')).toMatchObject({
      para: 'Pop',
      motivo: 'discrepante',
    });
  });
});

/**
 * UMA MUDANÇA POR FAIXA — porque quem aplica escreve cada uma delas.
 *
 * Um rótulo torto que TAMBÉM destoa do artista saía daqui duas vezes:
 * "sertaneja → Sertanejo" e "Sertanejo → Gospel". São duas escritas na nuvem
 * para a mesma faixa (já derrubamos a cota do projeto assim) e, dependendo da
 * ordem em que forem aplicadas, a primeira grava por cima da segunda e a faixa
 * volta para o lugar errado.
 */
describe('revisarGeneros — nunca duas revisões da mesma faixa', () => {
  it('normalizar e reclassificar viram uma decisão só', () => {
    const mudancas = revisarGeneros([
      ...varias(3, 'g', 'Gospel', 'Aline Barros'),
      f('x', 'sertaneja', 'Aline Barros'),
    ]);
    const daFaixa = mudancas.filter((m) => m.id === 'x');
    expect(daFaixa).toHaveLength(1);
    // O `de` é o que está gravado HOJE — é por ele que quem aplica confere se
    // alguém mexeu na faixa no meio do caminho.
    expect(daFaixa[0]).toMatchObject({ de: 'sertaneja', para: 'Gospel' });
  });

  it('nenhuma faixa aparece duas vezes na lista', () => {
    const mudancas = revisarGeneros([
      ...varias(3, 'g', 'Gospel', 'Aline Barros'),
      f('x', 'sertaneja', 'Aline Barros'),
      f('y', 'Brasileira', 'Aline Barros'),
      f('z', 'eletronica', 'Outro'),
    ]);
    const ids = mudancas.map((m) => m.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});
