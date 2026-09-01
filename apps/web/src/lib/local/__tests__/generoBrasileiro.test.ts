/**
 * OS CASOS RELATADOS, UM POR UM.
 *
 * "Não está sabendo categorizar funk brasileiro, trap, gospel, sertanejo. Trap
 * está indo parar em Lo-Fi, e trap indo parar em Sertanejo — esse é o pior."
 *
 * Eram três defeitos empilhados:
 *
 *  1. O catálogo da Apple devolve "Brasileira" — NACIONALIDADE, não gênero — e
 *     o app gravava isso cru. Sertanejo, trap, gospel e funk caíam no mesmo
 *     balde. E como o agente só procura faixa SEM gênero, o balde ainda trancava
 *     a faixa fora de qualquer classificação futura.
 *  2. O modelo classificava cada faixa isoladamente, sem olhar o artista. Duas
 *     centenas de faixas eram duas centenas de sorteios sem memória.
 *  3. Nada reexaminava o que já estava gravado errado.
 */
import { describe, expect, it } from 'vitest';
import { normalizarGenero, ehBaldeSemInformacao } from '@radinho/shared';
import {
  aceitarSugestao,
  generoDoArtista,
  herdarDoArtista,
  revisarGeneros,
  type FaixaMinima,
} from '@radinho/shared';

const faixa = (id: string, genre: string | null, ...artistas: string[]): FaixaMinima => ({
  id,
  genre,
  artistas: artistas.length ? artistas : ['Brandão85'],
});

describe('o rótulo do catálogo vira gênero de verdade', () => {
  it('"Brasileira" é nacionalidade — nunca vira categoria', () => {
    expect(ehBaldeSemInformacao('Brasileira')).toBe(true);
    expect(normalizarGenero('Brasileira')).toBeNull();
    expect(normalizarGenero('Brazilian')).toBeNull();
    expect(normalizarGenero('Mundial')).toBeNull();
  });

  it('os gêneros brasileiros de verdade são reconhecidos', () => {
    expect(normalizarGenero('Sertanejo')).toBe('Sertanejo');
    expect(normalizarGenero('Funk brasileiro')).toBe('Funk');
    expect(normalizarGenero('Funk Carioca')).toBe('Funk');
    expect(normalizarGenero('Cristã e Gospel')).toBe('Gospel');
    expect(normalizarGenero('Christian & Gospel')).toBe('Gospel');
    expect(normalizarGenero('Pagode')).toBe('Pagode');
    expect(normalizarGenero('Samba')).toBe('Samba');
    expect(normalizarGenero('Axé')).toBe('Axé');
    expect(normalizarGenero('Piseiro')).toBe('Forró');
  });

  it('acento, caixa e rótulo composto não atrapalham', () => {
    expect(normalizarGenero('eletronica')).toBe('Eletrônica');
    expect(normalizarGenero('Hip Hop/Rap')).toBe('Hip-Hop/Rap');
    expect(normalizarGenero('Sertanejo/Forró')).toBe('Sertanejo');
  });

  it('rótulo que não dá para traduzir vira null, nunca um palpite', () => {
    expect(normalizarGenero('Coisa Inventada')).toBeNull();
    expect(normalizarGenero('')).toBeNull();
    expect(normalizarGenero(null)).toBeNull();
  });
});

describe('o artista vota antes do modelo', () => {
  const discografiaTrap = [
    faixa('1', 'Trap'),
    faixa('2', 'Trap'),
    faixa('3', 'Trap'),
    faixa('4', 'Trap'),
  ];

  it('faixa nova de artista com gênero firme nasce categorizada, sem consultar ninguém', () => {
    const voto = generoDoArtista(discografiaTrap, 'Brandão85', 'nova');
    expect(herdarDoArtista(voto)).toBe('Trap');
  });

  // ── O PIOR CASO RELATADO ────────────────────────────────────────────────
  it('TRAP INDO PARAR EM SERTANEJO é vetado pelo resto da discografia', () => {
    const voto = generoDoArtista(discografiaTrap, 'Brandão85', 'nova');
    expect(aceitarSugestao('Sertanejo', voto)).toBeNull();
  });

  it('TRAP INDO PARAR EM LO-FI também é vetado', () => {
    const voto = generoDoArtista(discografiaTrap, 'Brandão85', 'nova');
    expect(aceitarSugestao('Lo-Fi', voto)).toBeNull();
  });

  it('mas o veto exige maioria FORTE — artista que muda de estilo não fica travado', () => {
    // Duas faixas só: sinal fraco demais para contrariar quem ouviu a música.
    const poucas = [faixa('1', 'Trap'), faixa('2', 'Trap')];
    const voto = generoDoArtista(poucas, 'Brandão85', 'nova');
    expect(aceitarSugestao('Gospel', voto)).toBe('Gospel');
  });

  it('artista sem histórico nenhum: a resposta do modelo vale', () => {
    expect(aceitarSugestao('Funk', generoDoArtista([], 'Novato', 'x'))).toBe('Funk');
  });

  it('a própria faixa não vota em si mesma', () => {
    // Sem o `exceto`, uma faixa errada se sustentaria sozinha e nunca cairia.
    const uma = [faixa('1', 'Sertanejo')];
    expect(generoDoArtista(uma, 'Brandão85', '1').total).toBe(0);
  });

  it('rótulo fora da taxonomia não vota — "Brasileira" não decide nada', () => {
    const baldes = [faixa('1', 'Brasileira'), faixa('2', 'Brasileira'), faixa('3', 'Brasileira')];
    expect(generoDoArtista(baldes, 'Brandão85', 'nova').total).toBe(0);
  });

  it('a sugestão do modelo também é normalizada antes de gravar', () => {
    expect(aceitarSugestao('funk carioca', generoDoArtista([], 'X', 'y'))).toBe('Funk');
    expect(aceitarSugestao('Brasileira', generoDoArtista([], 'X', 'y'))).toBeNull();
  });
});

describe('revisão do que já está gravado errado', () => {
  it('esvazia o balde "Brasileira" e devolve a faixa para a fila', () => {
    const mudancas = revisarGeneros([faixa('1', 'Brasileira')]);
    expect(mudancas).toEqual([{ id: '1', de: 'Brasileira', para: null, motivo: 'balde' }]);
  });

  it('conserta o trap solitário no meio do sertanejo — sem consultar o modelo', () => {
    const mudancas = revisarGeneros([
      faixa('1', 'Trap'),
      faixa('2', 'Trap'),
      faixa('3', 'Trap'),
      faixa('4', 'Sertanejo'), // o erro relatado
    ]);
    expect(mudancas).toEqual([{ id: '4', de: 'Sertanejo', para: 'Trap', motivo: 'discrepante' }]);
  });

  it('padroniza a escrita sem mudar o significado', () => {
    expect(revisarGeneros([faixa('1', 'eletronica')])).toEqual([
      { id: '1', de: 'eletronica', para: 'Eletrônica', motivo: 'normalizado' },
    ]);
  });

  it('o balde some ANTES da apuração — não pode contar como voto', () => {
    // Três "Brasileira" + um Trap não podem virar "o artista é Brasileira".
    const mudancas = revisarGeneros([
      faixa('1', 'Brasileira'),
      faixa('2', 'Brasileira'),
      faixa('3', 'Brasileira'),
      faixa('4', 'Trap'),
    ]);
    expect(mudancas.filter((m) => m.motivo === 'discrepante')).toEqual([]);
    expect(mudancas.every((m) => m.motivo === 'balde')).toBe(true);
  });

  it('biblioteca coerente não gera mudança nenhuma', () => {
    expect(revisarGeneros([faixa('1', 'Trap'), faixa('2', 'Trap')])).toEqual([]);
  });

  it('artistas diferentes não contaminam um ao outro', () => {
    const mudancas = revisarGeneros([
      faixa('1', 'Trap', 'Brandão85'),
      faixa('2', 'Trap', 'Brandão85'),
      faixa('3', 'Trap', 'Brandão85'),
      faixa('4', 'Gospel', 'Outro Artista'),
    ]);
    expect(mudancas).toEqual([]);
  });
});
