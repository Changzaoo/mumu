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
/** Uma faixa com selo — para os testes do voto por fonte. */
const fs = (id: string, genre: string | null, artista: string, label: string): FaixaMinima => ({
  id,
  genre,
  artistas: [artista],
  label,
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

/**
 * O GÊNERO QUE VEM DA FONTE — quando o artista sozinho não tem como votar.
 *
 * Medido em produção: o Midian Lima entrou com TRÊS faixas e as três erradas
 * (Funk, Reggaeton, Sertanejo). Não há faixa certa dele para a regra de artista
 * puxar as outras. Mas todas saíram do MK Music, um selo gospel, e o catálogo do
 * selo é a prova que faltava. A barra é alta para NÃO deixar uma gravadora
 * grande, que lança de tudo, arrastar faixa nenhuma.
 */
describe('revisarGeneros — o selo vota quando o artista não pode', () => {
  it('selo gospel puxa a faixa órfã que entrou como Funk', () => {
    // MK Music: 5 gospel de artistas variados + a faixa do Midian Lima em Funk.
    const mudancas = revisarGeneros([
      fs('g1', 'Gospel', 'Elaine Martins', 'MK Music'),
      fs('g2', 'Gospel', 'Sarah Farias', 'MK Music'),
      fs('g3', 'Gospel', 'Anderson Freire', 'MK Music'),
      fs('g4', 'Gospel', 'Paulo Neto', 'MK Music'),
      fs('g5', 'Gospel', 'Samuel Messias', 'MK Music'),
      fs('naoPare', 'Funk', 'Midian Lima', 'MK Music'),
    ]);
    expect(mudancas.find((m) => m.id === 'naoPare')).toMatchObject({
      para: 'Gospel',
      motivo: 'genero-do-selo',
    });
  });

  it('gravadora grande e diversa NÃO vota — sem maioria, sem conversão', () => {
    // Universal lança de tudo: pop, rock, hip-hop. Nenhuma maioria de dois
    // terços se forma, então a faixa de sertanejo dela fica onde está.
    const mudancas = revisarGeneros([
      fs('u1', 'Pop', 'Artista A', 'Universal Music'),
      fs('u2', 'Rock', 'Artista B', 'Universal Music'),
      fs('u3', 'Hip-Hop/Rap', 'Artista C', 'Universal Music'),
      fs('u4', 'Pop', 'Artista D', 'Universal Music'),
      fs('sert', 'Sertanejo', 'Artista E', 'Universal Music'),
    ]);
    expect(mudancas.find((m) => m.id === 'sert')).toBeUndefined();
  });

  it('poucas faixas do selo não bastam — abaixo de 4 votos não vota', () => {
    // Dois gospel não provam que o selo é gospel; pode ser coincidência.
    const mudancas = revisarGeneros([
      fs('g1', 'Gospel', 'A', 'Selo Novo'),
      fs('g2', 'Gospel', 'B', 'Selo Novo'),
      fs('rock', 'Rock', 'C', 'Selo Novo'),
    ]);
    expect(mudancas.find((m) => m.id === 'rock')).toBeUndefined();
  });

  it('faixa sem selo não é tocada por esta passada', () => {
    const mudancas = revisarGeneros([
      fs('g1', 'Gospel', 'A', 'MK Music'),
      fs('g2', 'Gospel', 'B', 'MK Music'),
      fs('g3', 'Gospel', 'C', 'MK Music'),
      fs('g4', 'Gospel', 'D', 'MK Music'),
      f('semSelo', 'Funk', 'E'),
    ]);
    expect(mudancas.find((m) => m.id === 'semSelo')).toBeUndefined();
  });
});

/**
 * O GÊNERO SE HERDA DE QUEM PARTICIPA, não só de quem encabeça.
 *
 * "Ninguém Explica Deus" (Preto no Branco ft. Gabriela Rocha) ficava em MPB: o
 * principal, Preto no Branco, tinha uma faixa gospel só na biblioteca — abaixo
 * dos dois votos — e a regra ignorava a convidada, que tem seis, todas gospel.
 * Quem divide o microfone numa música de louvor está cantando louvor.
 */
describe('revisarGeneros — o gênero de carreira vem de qualquer creditado', () => {
  const faixaCom = (id: string, genre: string | null, artistas: string[]): FaixaMinima => ({
    id,
    genre,
    artistas,
  });

  it('a convidada gospel puxa a faixa que o principal sozinho não puxava', () => {
    const mudancas = revisarGeneros([
      // Gabriela Rocha: seis faixas, todas gospel.
      ...varias(6, 'gr', 'Gospel', 'Gabriela Rocha'),
      // Preto no Branco: uma gospel só — sozinho, não alcança.
      f('pnb1', 'Gospel', 'Preto no Branco'),
      // A faixa em julgamento credita os dois; a convidada é quem prova.
      faixaCom('ninguem', 'MPB', ['Preto no Branco', 'Gabriela Rocha']),
    ]);
    expect(mudancas.find((m) => m.id === 'ninguem')).toMatchObject({
      para: 'Gospel',
      motivo: 'genero-do-artista',
    });
  });

  it('um convidado gospel fraco (só 1 faixa) NÃO arrasta — a barra continua de pé', () => {
    const mudancas = revisarGeneros([
      f('g1', 'Gospel', 'Convidado Gospel'),
      faixaCom('funk', 'Funk', ['MC Qualquer', 'Convidado Gospel']),
    ]);
    expect(mudancas.find((m) => m.id === 'funk')).toBeUndefined();
  });
});
