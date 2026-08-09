/**
 * O CASO REAL: "Raridade", do Anderson Freire, estava em SERTANEJO.
 *
 * A faixa foi importada do canal da gravadora, então o artista gravado virou
 * "MK MUSIC". Com isso, onze faixas de cantores diferentes passaram a votar
 * juntas na coerência por artista — nenhuma maioria se forma, o gênero errado da
 * fonte sobrevive, e a prateleira Gospel aparece vazia de músicas que estavam
 * lá dentro. A foto do artista, pelo mesmo motivo, virava o logo do selo.
 *
 * Estes testes usam os nomes exatos que estão no banco de produção.
 */
import { describe, expect, it } from 'vitest';
import {
  acharGravadora,
  ehGravadora,
  ehSelo,
  promoverArtistaReal,
} from '../gravadoraComoArtista.js';

describe('ehGravadora', () => {
  it('reconhece os selos que apareceram na biblioteca', () => {
    expect(ehGravadora('MK MUSIC')).toBe(true);
    expect(ehGravadora('mk music')).toBe(true);
    expect(ehGravadora('MK Music Oficial')).toBe(true);
    expect(ehGravadora('Som Livre')).toBe(true);
    expect(ehGravadora('30PRAUM')).toBe(true);
  });

  it('NÃO confunde artista com selo', () => {
    // O risco de errar para este lado é tirar o crédito de quem cantou.
    expect(ehGravadora('Anderson Freire')).toBe(false);
    expect(ehGravadora('Gabriela Rocha')).toBe(false);
    expect(ehGravadora('Matuê')).toBe(false);
    expect(ehGravadora('Preto no Branco')).toBe(false);
    // Palavras que aparecem DENTRO de nomes de selo, sozinhas, não bastam.
    expect(ehGravadora('Music')).toBe(false);
    expect(ehGravadora('Storm')).toBe(false);
    expect(ehGravadora('')).toBe(false);
  });

  it('o sufixo do canal também vem COLADO', () => {
    // O canal do selo do Matuê se chama "Pineapple StormTV", sem espaço. Como a
    // regra exigia espaço antes do "TV", o selo não era reconhecido e ia parar
    // no campo de quem canta.
    expect(ehGravadora('Pineapple StormTV')).toBe(true);
    // E continua não bastando terminar em "tv": o resto tem que ser um selo.
    expect(ehGravadora('Kurtv')).toBe(false);
  });
});

/**
 * `ehSelo` é o reconhecimento AMPLO, para filtrar quem não canta de uma lista já
 * separada. Vai além da lista fechada de `ehGravadora` porque, ali, o outro nome
 * da lista continua sendo o artista — dá para confiar no token de selo.
 */
describe('ehSelo', () => {
  it('pega o selo pelo token que nome de gente não carrega', () => {
    expect(ehSelo('Rocket Music Brazil')).toBe(true);
    expect(ehSelo('Make The Girls Dance Records')).toBe(true);
    expect(ehSelo('Cat Music')).toBe(true);
    expect(ehSelo('Universal Music Brasil')).toBe(true);
    expect(ehSelo('YG Entertainment')).toBe(true);
    // O que `ehGravadora` já pegava continua valendo.
    expect(ehSelo('MK MUSIC')).toBe(true);
  });

  it('NÃO classifica quem canta como selo', () => {
    expect(ehSelo('Ton Carfi')).toBe(false);
    expect(ehSelo('HUGEL')).toBe(false);
    expect(ehSelo('Costi')).toBe(false);
    expect(ehSelo('S A G U N A')).toBe(false);
    expect(ehSelo('Chris Beats Zn')).toBe(false);
    // "Music" sozinho é ambíguo demais — precisa de uma palavra antes do token.
    expect(ehSelo('Music')).toBe(false);
    expect(ehSelo('')).toBe(false);
  });
});

/**
 * O SELO VEM DENTRO DO NOME DO VÍDEO, não só no nome do canal — "Não Pare
 * ( MK Music)", "Deus Proverá [Som Livre]". Sem alguém para achá-lo ali, ele
 * ficava colado no nome da música na prateleira.
 */
describe('acharGravadora', () => {
  it('acha o selo no meio do título, com a pontuação que estiver no caminho', () => {
    expect(acharGravadora('Não Pare ( MK Music)')).toBe('MK Music');
    expect(acharGravadora('Deus Proverá [Som Livre]')).toBe('Som Livre');
    expect(acharGravadora('Jó - COM LETRA (VideoLETRA® oficial MK Music)')).toBe('MK Music');
  });

  it('devolve o selo como o canal escreveu', () => {
    expect(acharGravadora('MK MUSIC - Raridade')).toBe('MK MUSIC');
  });

  it('não acha o que não está lá', () => {
    expect(acharGravadora('Anderson Freire - Raridade')).toBeNull();
    expect(acharGravadora('')).toBeNull();
  });
});

describe('promoverArtistaReal', () => {
  it('devolve o crédito a quem canta — o caso "Raridade"', () => {
    const corrigido = promoverArtistaReal([{ name: 'MK MUSIC' }, { name: 'Anderson Freire' }]);
    expect(corrigido?.[0]?.name).toBe('Anderson Freire');
    // O selo continua na lista: a informação é verdadeira, só não é o artista.
    expect(corrigido?.[1]?.name).toBe('MK MUSIC');
  });

  it('funciona com o selo no meio de uma lista maior', () => {
    const corrigido = promoverArtistaReal([
      { name: 'MK MUSIC' },
      { name: 'Midian Lima' },
      { name: 'Convidado' },
    ]);
    expect(corrigido?.map((a) => a.name)).toEqual(['Midian Lima', 'MK MUSIC', 'Convidado']);
  });

  it('não mexe no que já está certo', () => {
    expect(promoverArtistaReal([{ name: 'Gabriela Rocha' }])).toBeNull();
    expect(promoverArtistaReal([{ name: 'Matuê' }, { name: 'Teto' }])).toBeNull();
  });

  it('não mexe quando o selo é o ÚNICO crédito', () => {
    // Sem alternativa, tirar o selo deixaria a faixa sem artista nenhum.
    expect(promoverArtistaReal([{ name: 'MK MUSIC' }])).toBeNull();
    expect(promoverArtistaReal([{ name: 'MK MUSIC' }, { name: 'Som Livre' }])).toBeNull();
  });

  it('preserva os demais campos do artista, não só o nome', () => {
    const corrigido = promoverArtistaReal([
      { name: 'MK MUSIC', id: 'a1' },
      { name: 'Sarah Farias', id: 'a2' },
    ]);
    expect(corrigido?.[0]).toEqual({ name: 'Sarah Farias', id: 'a2' });
  });
});
