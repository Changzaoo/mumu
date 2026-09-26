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

  // Casos reais do acervo (2026-09-26), incluindo o que estava tocando.
  it.each([
    [
      'MC Ryan SP, Neguinho do Kaxeta, Vitinho Avassalador e MC PP da VS (DJ Marquinhos SB)',
      ['"Liberdade"'],
      'Liberdade',
      'MC Ryan SP',
    ],
    ['Luiz Melodia', ['"Pérola Negra"'], 'Pérola Negra', 'Luiz Melodia'],
    ['Stray Kids "Chk Chk Boom" Performance Video', ['Stray Kids'], 'Chk Chk Boom', 'Stray Kids'],
    ['Stray Kids "극과 극(N/S)" Video (Street Ver.)', ['Stray Kids'], '극과 극(N/S)', 'Stray Kids'],
    ['Lee Know "Youth"', ['Stray Kids'], 'Youth', 'Lee Know'],
    ['Caio Luccas "Mano De Gang" ft. TZ, Anezzi', ['Caio Luccas'], 'Mano De Gang', 'Anezzi'],
  ])('aspas decidem a música: %s', (titulo, artistas, esperado, artistaEsperado) => {
    const r = lerTituloDoAcervo(titulo, artistas);
    expect(r?.title).toBe(esperado);
    expect(r?.artists).toContain(artistaEsperado);
  });

  it('frase com número fora das aspas não vira artista', () => {
    expect(lerTituloDoAcervo('Saca da Twin 2 "O Poderoso Chatão"', ['MC Lele JP'])).toBeNull();
  });
});

describe('lerTituloDoAcervo — prévia de 2026-09-26', () => {
  it('título só com créditos de MC/DJ: a música estava no artista', () => {
    const r = lerTituloDoAcervo('MC 2Jhow (DJ Serpinha)', ['ESPIRRA O LANÇA']);
    expect(r?.title).toBe('ESPIRRA O LANÇA');
    expect(r?.artists).toEqual(expect.arrayContaining(['MC 2Jhow', 'DJ Serpinha']));
    expect(lerTituloDoAcervo('MC Kekel e MC Rita (KondZilla)', ['Amor de Verdade'])?.title).toBe(
      'Amor de Verdade',
    );
  });

  it('não parte "Tyler, The Creator" em dois', () => {
    const r = lerTituloDoAcervo('Ignant Shit', ['Tyler, The Creator']);
    expect(r === null || r.artists.includes('Tyler, The Creator')).toBe(true);
  });
});

describe('lerTituloDoAcervo — destroca não confunde música nem produtora', () => {
  it('"DJ Got Us Fallin\' in Love" é música, não crédito', () => {
    const r = lerTituloDoAcervo("DJ Got Us Fallin' in Love (feat. Pitbull)", ['USHER']);
    expect(r?.title).not.toBe('USHER');
  });
  it('produtora no artista não vira título', () => {
    const r = lerTituloDoAcervo('Alok, DJ Victor, MC Hariel, MC Marks', ['GR6 EXPLODE']);
    expect(r?.title).not.toBe('GR6 EXPLODE');
  });
  it('limpa sobra de divulgação nos nomes', () => {
    const r = lerTituloDoAcervo('MC GP e MC MENO K ( DJ TC e FEPACHE ) VIDEO', ['SENTA SENTA']);
    expect(r?.title).toBe('SENTA SENTA');
    expect(r?.artists).toEqual(expect.arrayContaining(['MC GP', 'MC MENO K']));
    expect(r?.artists.join(' ')).not.toMatch(/VIDEO/);
  });
});
