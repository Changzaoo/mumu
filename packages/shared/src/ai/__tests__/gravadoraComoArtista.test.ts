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
import { ehGravadora, promoverArtistaReal } from '../gravadoraComoArtista.js';

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
