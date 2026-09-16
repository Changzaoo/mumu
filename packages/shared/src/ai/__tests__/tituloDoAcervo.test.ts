/**
 * TÍTULOS REAIS DO ACERVO, copiados de produção em 16/09/2026.
 *
 * O relato: "essa faixa está com o nome do artista no título e coisa além do
 * nome da música". No acervo o artista já foi curado, então é ele que decide
 * qual pedaço é a música — e quando não dá para decidir, nada muda.
 */
import { describe, expect, it } from 'vitest';
import { lerTituloDoAcervo } from '../tituloDeVideo.js';

describe('lerTituloDoAcervo', () => {
  it('tira convidado, divulgação e numeração do título (o caso relatado)', () => {
    expect(
      lerTituloDoAcervo('Lente Transparente ft. Victor WAO (Áudio Oficial) #Faixa08', [
        'TZ da Coronel',
      ]),
    ).toEqual({
      title: 'Lente Transparente',
      artists: ['TZ da Coronel', 'Victor WAO'],
      label: null,
    });
  });

  it('não confunde o convidado do ft. com crédito de DJ solto', () => {
    expect(
      lerTituloDoAcervo('Luneta ft. MC Marks (Áudio Oficial) #Faixa13', ['Tz da Coronel']),
    ).toMatchObject({ title: 'Luneta', artists: ['Tz da Coronel', 'MC Marks'] });
  });

  it('"Música - Dj X": o DJ vai para os artistas, não vira o título', () => {
    expect(lerTituloDoAcervo('Deus é por Nós - Dj Muka', ['MC Marks'])).toMatchObject({
      title: 'Deus é por Nós',
      artists: ['MC Marks', 'Dj Muka'],
    });
  });

  it('sufixo de gravação depois do separador sai', () => {
    expect(
      lerTituloDoAcervo('Primeira Essência - Ministração ao vivo', ['Felipe Rodrigues']),
    ).toMatchObject({ title: 'Primeira Essência' });
    expect(
      lerTituloDoAcervo('The Final Countdown - Live at Wacken Open Air 2017', ['Europe']),
    ).toMatchObject({ title: 'The Final Countdown' });
  });

  it('separador dentro de parêntese não divide o título', () => {
    expect(lerTituloDoAcervo('Star (2009 - Remaster)', ['Erasure'])).toMatchObject({
      title: 'Star',
    });
  });

  it('o selo do parêntese de divulgação vai para o campo de gravadora', () => {
    expect(
      lerTituloDoAcervo('Inveja o Progresso (Vídeo Clipe Sete Sete Records) DJ Nenê MPC', [
        'Mc Kevin',
      ]),
    ).toEqual({
      title: 'Inveja o Progresso',
      artists: ['Mc Kevin', 'DJ Nenê MPC'],
      label: 'Sete Sete Records',
    });
    expect(lerTituloDoAcervo('Detalhes (GR6 Explode)', ["DJ Kaio Mix, Du'L"])).toMatchObject({
      title: 'Detalhes',
      label: 'GR6 Explode',
    });
  });

  it('"Official Music Video" não inventa uma gravadora chamada Music', () => {
    expect(lerTituloDoAcervo('Runnin (Official Music Video)', ['21 Savage'])).toMatchObject({
      title: 'Runnin',
      label: null,
    });
  });

  it('artista na frente do separador sai do título', () => {
    expect(lerTituloDoAcervo('The Beatles - Revolution', ['The Beatles'])).toMatchObject({
      title: 'Revolution',
    });
  });

  it('música entre aspas com o nome do grupo em volta', () => {
    expect(lerTituloDoAcervo('Stray Kids "CREED" Video', ['Stray Kids'])).toMatchObject({
      title: 'CREED',
    });
  });

  it('destroca campos trocados: lista de MCs no título, música no artista', () => {
    expect(
      lerTituloDoAcervo(
        'MC Cebezinho, MC Ryan SP, MC PP da VS, MC Magal e Salvador (DJ Boy e DJ Oreia)',
        ['"Outfit Valioso"'],
      ),
    ).toMatchObject({
      title: 'Outfit Valioso',
      artists: [
        'MC Cebezinho',
        'MC Ryan SP',
        'MC PP da VS',
        'MC Magal',
        'Salvador',
        'DJ Boy',
        'DJ Oreia',
      ],
    });
  });

  it('ambíguo fica como está', () => {
    expect(lerTituloDoAcervo('Flor da pele - Revelação', ['Fagner e Zeca Baleiro'])).toBeNull();
    expect(lerTituloDoAcervo('Garota de Ipanema', ['Tom Jobim'])).toBeNull();
  });

  it('sem nome de música conhecido, não inventa', () => {
    const r = lerTituloDoAcervo('DON JUAN, BOLADIN 211, DJ KAIOKEN E DJ FELIPE MAIA', [
      'MC Don Juan, Boladin211',
    ]);
    expect(r?.title ?? 'DON JUAN, BOLADIN 211, DJ KAIOKEN E DJ FELIPE MAIA').toBe(
      'DON JUAN, BOLADIN 211, DJ KAIOKEN E DJ FELIPE MAIA',
    );
  });
});
