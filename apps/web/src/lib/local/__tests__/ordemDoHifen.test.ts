/**
 * DE QUE LADO DO HÍFEN ESTÁ O ARTISTA.
 *
 * `cleanQuery` assumia SEMPRE "Artista - Título". Metade das postagens do acervo
 * é o contrário — "ÚLTIMA VEZ - Alee" —, e nessas o app gravava o nome do
 * ARTISTA no campo do título e o nome da MÚSICA no campo do artista. É o defeito
 * de "aparece o nome do artista onde deveria ser o nome da música".
 *
 * Inverter a suposição não conserta nada: só troca quem é a vítima. O texto
 * sozinho não diz a ordem — "Alee - ÚLTIMA VEZ" e "ÚLTIMA VEZ - Alee" são
 * indistinguíveis para qualquer regra que olhe só a string.
 *
 * O que decide é EVIDÊNCIA de fora: o canal que publicou. Se o lado direito é o
 * canal e o esquerdo não é, a ordem está invertida. Na dúvida — sem pista, ou
 * com os dois lados casando — fica a convenção antiga, que é a mais comum.
 *
 * A metade defensiva destes testes é a que importa: uma pista fraca não pode
 * autorizar a troca, senão o conserto vira um gerador novo do mesmo defeito.
 */
import { describe, expect, it } from 'vitest';
import { cleanQuery } from '@/lib/local/enrich';

describe('sem pista, vale a convenção "Artista - Título"', () => {
  it('mantém o comportamento de sempre', () => {
    expect(cleanQuery('Matuê - Máquina do Tempo')).toEqual({
      artist: 'Matuê',
      title: 'Máquina do Tempo',
    });
  });

  it('pista que não casa com lado nenhum não muda nada', () => {
    expect(cleanQuery('Matuê - Máquina do Tempo', 'Canal Aleatório XYZ')).toEqual({
      artist: 'Matuê',
      title: 'Máquina do Tempo',
    });
  });
});

describe('a pista corrige a ordem invertida', () => {
  it('"MÚSICA - Artista" publicado no canal do artista', () => {
    // O caso real: o campo do título recebia "Alee" e o do artista "ÚLTIMA VEZ".
    expect(cleanQuery('ÚLTIMA VEZ - Alee', 'Alee')).toEqual({
      artist: 'Alee',
      title: 'ÚLTIMA VEZ',
    });
  });

  it('a ordem normal com a mesma pista continua normal', () => {
    expect(cleanQuery('Alee - ÚLTIMA VEZ', 'Alee')).toEqual({
      artist: 'Alee',
      title: 'ÚLTIMA VEZ',
    });
  });

  it('canal com sufixo ainda casa ("Alee Oficial")', () => {
    expect(cleanQuery('ÚLTIMA VEZ - Alee', 'Alee Oficial')).toEqual({
      artist: 'Alee',
      title: 'ÚLTIMA VEZ',
    });
  });

  it('acento e caixa não atrapalham o desempate', () => {
    expect(cleanQuery('MAQUINA DO TEMPO - matue', 'Matuê')).toEqual({
      artist: 'matue',
      title: 'MAQUINA DO TEMPO',
    });
  });
});

describe('a pista fraca NÃO autoriza a troca', () => {
  it('pista curta demais não vale como prova', () => {
    // "AL" casaria por `includes` com meio acervo. Com piso de 3, não decide.
    expect(cleanQuery('ÚLTIMA VEZ - Alee', 'AL')).toEqual({
      artist: 'ÚLTIMA VEZ',
      title: 'Alee',
    });
  });

  it('pista que casa com OS DOIS lados mantém a convenção', () => {
    // Canal batizado com o nome da música: a evidência não separa os lados.
    expect(cleanQuery('Alee - Alee', 'Alee')).toEqual({ artist: 'Alee', title: 'Alee' });
  });

  it('pista vazia é ignorada', () => {
    expect(cleanQuery('ÚLTIMA VEZ - Alee', '')).toEqual({
      artist: 'ÚLTIMA VEZ',
      title: 'Alee',
    });
    expect(cleanQuery('ÚLTIMA VEZ - Alee', null)).toEqual({
      artist: 'ÚLTIMA VEZ',
      title: 'Alee',
    });
  });
});

describe('o desempate também vale fora do alfabeto latino', () => {
  it('coreano: canal do grupo à direita', () => {
    // Antes, `norm` zerava os dois lados e a pista nunca casava com nada.
    expect(cleanQuery('소리꾼 - 스트레이 키즈', '스트레이 키즈')).toEqual({
      artist: '스트레이 키즈',
      title: '소리꾼',
    });
  });

  it('cirílico idem', () => {
    expect(cleanQuery('Кукушка - Кино', 'Кино')).toEqual({
      artist: 'Кино',
      title: 'Кукушка',
    });
  });
});

describe('o que não é separação de crédito continua intacto', () => {
  it('hífen sem espaços não separa artista', () => {
    expect(cleanQuery('Spider-Man Theme', 'Canal')).toEqual({ title: 'Spider-Man Theme' });
  });

  it('título sem hífen nenhum', () => {
    expect(cleanQuery('Sozinho', 'Canal')).toEqual({ title: 'Sozinho' });
  });
});
