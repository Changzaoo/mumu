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
import {
  artistasEspalhados,
  forcarGeneroReal,
  revisarGeneros,
  type FaixaMinima,
  type Genre,
} from '../generoCoerencia.js';

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

/**
 * O GÊNERO REAL DO ARTISTA — a discografia espalhada que a coerência interna não
 * alcança.
 *
 * O caso do Alee, medido em produção: 78 faixas em dez gêneros, nenhum passando
 * de 28%. Não há maioria para votar; a própria discografia é ruído. A prova de
 * que Alee é trap vem de FORA (a IA/o catálogo), entra por `veredicto`, e
 * `forcarGeneroReal` puxa a discografia inteira. As guardas abaixo são o que
 * impede isso de achatar um artista genuinamente eclético.
 */
describe('forcarGeneroReal — o gênero verdadeiro do artista', () => {
  const v = (nome: string, genero: Genre): ReadonlyMap<string, Genre> =>
    new Map([[nome, genero]]);

  it('artista espalhado sem maioria converge para o veredicto', () => {
    // Alee em pequeno: 4 gêneros empatados, dominante mal chega a 21%.
    const faixas = [
      ...varias(3, 't', 'Trap', 'Alee'),
      ...varias(3, 'p', 'Pop', 'Alee'),
      ...varias(3, 's', 'Sertanejo', 'Alee'),
      ...varias(3, 'f', 'Funk', 'Alee'),
      ...varias(2, 'x', 'Forró', 'Alee'),
    ];
    const revs = forcarGeneroReal(faixas, v('Alee', 'Trap'));
    // As 11 faixas que não eram Trap são puxadas; as 3 que já eram ficam quietas.
    expect(revs).toHaveLength(11);
    expect(revs.every((r) => r.para === 'Trap')).toBe(true);
    expect(revs.every((r) => r.motivo === 'genero-real-do-artista')).toBe(true);
  });

  it('no vazio de sinal, o veredicto decide até CONTRA o dominante interno', () => {
    // Dominante Sertanejo, mas só 33% — abaixo do limiar de sinal. Alee é trap.
    const faixas = [
      ...varias(4, 's', 'Sertanejo', 'Alee'),
      ...varias(3, 'p', 'Pop', 'Alee'),
      ...varias(3, 't', 'Trap', 'Alee'),
      ...varias(2, 'h', 'Hip-Hop/Rap', 'Alee'),
    ];
    const revs = forcarGeneroReal(faixas, v('Alee', 'Trap'));
    expect(revs).toHaveLength(9); // tudo que não era Trap
    expect(new Set(revs.map((r) => r.para))).toEqual(new Set(['Trap']));
  });

  it('maioria fraca que a 2ª passada não alcança (58%) é limpa quando o veredicto CONCORDA', () => {
    // Brandão85 medido em produção: dominante trap em 58%, longe dos 75% que o
    // `discrepante` exige. O veredicto concorda com o dominante e limpa a minoria.
    const faixas = [
      ...varias(7, 't', 'Trap', 'Brandão85'),
      ...varias(3, 'p', 'Pop', 'Brandão85'),
      ...varias(2, 's', 'Sertanejo', 'Brandão85'),
    ];
    const revs = forcarGeneroReal(faixas, v('Brandão85', 'Trap'));
    expect(revs).toHaveLength(5);
    expect(revs.every((r) => r.para === 'Trap')).toBe(true);
  });

  it('GUARDA — artista eclético legítimo (sem veredicto) NÃO é forçado', () => {
    // A IA respondeu ECLÉTICO, que o parser vira `null`: o nome nem entra no mapa
    // de veredictos, e a discografia diversa fica intacta.
    const faixas = [
      ...varias(3, 'm', 'MPB', 'Caetano'),
      ...varias(3, 'r', 'Rock', 'Caetano'),
      ...varias(3, 's', 'Samba', 'Caetano'),
    ];
    expect(forcarGeneroReal(faixas, new Map())).toEqual([]);
  });

  it('GUARDA — discografia coerente NÃO é achatada, mesmo com veredicto contrário', () => {
    // 8 de 9 Trap: a atribuição por faixa está funcionando. Forçar Pop aqui seria
    // criar o erro que o mecanismo existe para consertar.
    const faixas = [...varias(8, 't', 'Trap', 'Coerente'), f('p1', 'Pop', 'Coerente')];
    expect(forcarGeneroReal(faixas, v('Coerente', 'Pop'))).toEqual([]);
  });

  it('GUARDA — veredicto alucinado (gênero ausente da discografia) é recusado', () => {
    const faixas = [
      ...varias(3, 's', 'Sertanejo', 'X'),
      ...varias(3, 'p', 'Pop', 'X'),
      ...varias(3, 'f', 'Funk', 'X'),
    ];
    // Jazz não aparece em nenhuma faixa do artista: não se inventa gênero do nada.
    expect(forcarGeneroReal(faixas, v('X', 'Jazz'))).toEqual([]);
  });

  it('GUARDA — veredicto que contraria uma maioria interna razoável é recusado', () => {
    // Sertanejo de verdade em 67%: com sinal interno forte, uma opinião externa
    // que aponta outro gênero é mais provavelmente engano sobre o artista.
    const faixas = [
      ...varias(6, 's', 'Sertanejo', 'Sertanejo Real'),
      ...varias(2, 'p', 'Pop', 'Sertanejo Real'),
      f('t1', 'Trap', 'Sertanejo Real'),
    ];
    expect(forcarGeneroReal(faixas, v('Sertanejo Real', 'Trap'))).toEqual([]);
  });

  it('discografia pequena demais não é forçada — pode ser azar de amostra', () => {
    const faixas = [f('a', 'Pop', 'Novato'), f('b', 'Trap', 'Novato'), f('c', 'Funk', 'Novato')];
    expect(forcarGeneroReal(faixas, v('Novato', 'Trap'))).toEqual([]);
  });
});

describe('artistasEspalhados — quem vale perguntar à evidência externa', () => {
  it('aponta o espalhado e ignora o coerente, o pequeno e o de dois gêneros', () => {
    const espalhados = artistasEspalhados([
      // Alee: espalhado de verdade (5 gêneros, dominante ~21%).
      ...varias(3, 'at', 'Trap', 'Alee'),
      ...varias(3, 'ap', 'Pop', 'Alee'),
      ...varias(3, 'as', 'Sertanejo', 'Alee'),
      ...varias(3, 'af', 'Funk', 'Alee'),
      ...varias(2, 'ax', 'Forró', 'Alee'),
      // Coerente: 8 de 9 Trap — maioria forte, a 2ª passada cuida do outlier.
      ...varias(8, 'ct', 'Trap', 'Coerente'),
      f('cp', 'Pop', 'Coerente'),
      // Pouco: só 3 faixas — amostra fraca demais.
      ...varias(3, 'po', 'Pop', 'Pouco'),
      // DoisGeneros: 4 e 4, mas só dois gêneros — isso é escolha, não ruído.
      ...varias(4, 'da', 'Rock', 'DoisGeneros'),
      ...varias(4, 'db', 'Pop', 'DoisGeneros'),
    ]);
    const nomes = espalhados.map((e) => e.artista);
    expect(nomes).toContain('Alee');
    expect(nomes).not.toContain('Coerente');
    expect(nomes).not.toContain('Pouco');
    expect(nomes).not.toContain('DoisGeneros');
  });

  it('vem ordenado do mais espalhado (menor maioria) para o menos', () => {
    const espalhados = artistasEspalhados([
      // Muito espalhado: dominante ~25%.
      ...varias(2, 'ma', 'Trap', 'Muito'),
      ...varias(2, 'mb', 'Pop', 'Muito'),
      ...varias(2, 'mc', 'Funk', 'Muito'),
      ...varias(2, 'md', 'Sertanejo', 'Muito'),
      // Menos espalhado: dominante ~57%.
      ...varias(4, 'pa', 'Trap', 'Menos'),
      ...varias(2, 'pb', 'Pop', 'Menos'),
      f('pc', 'Funk', 'Menos'),
    ]);
    expect(espalhados[0]?.artista).toBe('Muito');
  });
});
