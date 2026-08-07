import { describe, expect, it } from 'vitest';
import { dominantLabel, parseLabel } from '@/lib/catalog/label';

describe('parseLabel', () => {
  it('tira o símbolo de fonograma e o ano', () => {
    expect(parseLabel('℗ 2019 Sony Music Entertainment')).toBe('Sony Music Entertainment');
    expect(parseLabel('© 2004 Universal Music')).toBe('Universal Music');
    expect(parseLabel('(P) 1998 EMI')).toBe('EMI');
  });

  it('remove sufixo societário e pontuação final', () => {
    expect(parseLabel('℗ 2020 Warner Records Inc.')).toBe('Warner Records');
    expect(parseLabel('℗ 2016 Som Livre Ltda')).toBe('Som Livre');
  });

  it('fica com o selo quando a frase é de licenciamento', () => {
    expect(parseLabel('℗ 2021 Artist LLC, under exclusive license to Republic Records')).toBe(
      'Republic Records',
    );
    expect(parseLabel('℗ 2015 Distributed by Believe Digital')).toBe('Believe Digital');
  });

  it('fica com a nota original quando a reedição gruda duas', () => {
    expect(parseLabel('℗ 1975 Queen Productions Ltd./(P) 2011 Queen Productions Ltd.')).toBe(
      'Queen Productions',
    );
  });

  it('casos reais do iTunes', () => {
    expect(
      parseLabel(
        '℗ 2020 Miracle Recordings Ltd, under exclusive licence to Universal International Music B.V.',
      ),
    ).toBe('Universal International Music');
    expect(
      parseLabel(
        '℗ 2006 The copyright in this sound recording is owned by Queen Productions Ltd under exclusive licence to Parlophone Records Ltd',
      ),
    ).toBe('Parlophone Records');
  });

  it('devolve null quando não sobra nome', () => {
    expect(parseLabel('℗ 2019')).toBeNull();
    expect(parseLabel('')).toBeNull();
    expect(parseLabel(null)).toBeNull();
    expect(parseLabel(undefined)).toBeNull();
  });
});

describe('dominantLabel', () => {
  it('devolve a gravadora mais frequente', () => {
    expect(dominantLabel(['Sony', 'Universal', 'Sony', null, 'Sony'])).toBe('Sony');
  });

  it('ignora caixa diferente ao contar, mas preserva o texto original', () => {
    expect(dominantLabel(['Som Livre', 'sony', 'SOM LIVRE'])).toBe('Som Livre');
  });

  it('desempata pela primeira que apareceu', () => {
    expect(dominantLabel(['Universal', 'Sony'])).toBe('Universal');
  });

  it('devolve null sem nenhuma gravadora', () => {
    expect(dominantLabel([null, undefined, '', '   '])).toBeNull();
  });
});

/**
 * FRASES REAIS, tiradas da API em 07/08/2026 para Matuê, Teto, WIU e Brandão85.
 *
 * A distribuidora assina o fonograma e o SELO vem depois de "sob licença
 * exclusiva de". Sem esse corte, a prateleira de trap do 30PRAUM aparecia como
 * "Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM
 * Agenciamento e Produção" — errado, feio, e em 3 dos 8 álbuns consultados.
 */
describe('parseLabel — licença exclusiva em português', () => {
  it('tira o selo de trás da distribuidora', () => {
    expect(
      parseLabel(
        '℗ 2022 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM Agenciamento e Produção.',
      ),
    ).toBe('30PRAUM');
    expect(
      parseLabel(
        '℗ 2021 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM Agenciamento e Produção ltda.',
      ),
    ).toBe('30PRAUM');
    expect(
      parseLabel('℗ 2019 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM.'),
    ).toBe('30PRAUM');
  });

  it('não estraga o caso simples', () => {
    expect(parseLabel('℗ 2024 30PRAUM')).toBe('30PRAUM');
    expect(parseLabel('℗ 2018 30PRAUM')).toBe('30PRAUM');
  });

  it('PRESERVA selo cujo nome tem "Produções" de verdade', () => {
    // O primeiro selo do Brandão85. Cortar "Produções" por atacado o apagaria.
    expect(parseLabel('℗ 2022 Hash Produções')).toBe('Hash Produções');
  });

  it('artista que lança por conta própria continua aparecendo', () => {
    expect(parseLabel('℗ 2017 Matuê')).toBe('Matuê');
    expect(parseLabel('℗ 2024 LUDMILLA')).toBe('LUDMILLA');
  });

  it('a gravadora dominante do artista sai certa mesmo com formas misturadas', () => {
    const doTeto = [
      parseLabel('℗ 2025 30PRAUM'),
      parseLabel(
        '℗ 2021 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM Agenciamento e Produção ltda.',
      ),
      parseLabel(
        '℗ 2023 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM Agenciamento e Produção ltda.',
      ),
    ];
    // Antes as três formas eram três "gravadoras" diferentes e a moda era lixo.
    expect(dominantLabel(doTeto)).toBe('30PRAUM');
  });
});
