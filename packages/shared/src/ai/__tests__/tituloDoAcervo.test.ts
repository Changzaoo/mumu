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
  it('participação depois do travessão sai do título', () => {
    const r = lerTituloDoAcervo('Pipoco - Part. Melody', ['Ana Castela']);
    expect(r).toEqual({ title: 'Pipoco', artists: ['Ana Castela', 'Melody'], label: null });
  });
  it('"featuring", "(with …)" e "participação especial" viram convidados', () => {
    expect(lerTituloDoAcervo('Starboy featuring Daft Punk', ['The Weeknd'])?.title).toBe('Starboy');
    expect(lerTituloDoAcervo('Starboy (with Daft Punk)', ['The Weeknd'])?.artists).toEqual([
      'The Weeknd',
      'Daft Punk',
    ]);
    expect(
      lerTituloDoAcervo('Pipoco (Participação Especial Melody)', ['Ana Castela'])?.artists,
    ).toEqual(['Ana Castela', 'Melody']);
  });
});

/**
 * ACERVO DE 12/11/2026 — o relato: "os títulos tão zoados, precisa saber
 * diferenciar o título e quem canta". Casos copiados da listagem pública.
 */
describe('lerTituloDoAcervo — acervo de 12/11/2026', () => {
  const ler = (t: string, a: string[]) => lerTituloDoAcervo(t, a);

  it('"(With Me Baby)" é parte do nome, não convidado', () => {
    expect(ler('Come Home (With Me Baby)', ['Dead or Alive'])).toBeNull();
    expect(ler('Quit Playing Games (With My Heart)', ['Backstreet Boys'])).toBeNull();
    expect(ler('Stairway to Heaven [With Jason Bonham]', ['Heart'])?.artists).toEqual([
      'Heart',
      'Jason Bonham',
    ]);
  });

  it('parêntese aninhado que é do nome fica inteiro', () => {
    expect(ler('Fire (Album Version (Explicit))', ['50 Cent'])).toBeNull();
    expect(ler("LYIN' (LIVE FROM COACHELLA (Weekend II) / Audio)", ['Justin Bieber'])?.title).toBe(
      "LYIN'",
    );
  });

  it('nunca devolve faixa sem artista nem inventa a música "Fepache"', () => {
    expect(ler('MC Paiva', ['Fepache'])).toBeNull();
    expect(ler('MC Meno K (DJ Japa NK)', ['EU JA SEI O QUE FAZER PRA ESQUECER DE VOCÊ'])).toEqual({
      title: 'EU JA SEI O QUE FAZER PRA ESQUECER DE VOCÊ',
      artists: ['MC Meno K', 'DJ Japa NK'],
      label: null,
    });
  });

  it('música entre aspas no campo do artista volta para o título', () => {
    expect(ler('WizKid -', ['"Essence" (Remix)'])).toMatchObject({
      title: 'Essence (Remix)',
      artists: ['WizKid'],
    });
  });

  it('"Desconhecido" e apelido de canal saem quando o título diz quem canta', () => {
    expect(ler('Rick Astley "Move Right Out"', ['Desconhecido'])).toMatchObject({
      title: 'Move Right Out',
      artists: ['Rick Astley'],
    });
    expect(ler('"I\'ll Follow the Sun" The Beatles', ['catman916'])).toMatchObject({
      title: "I'll Follow the Sun",
      artists: ['The Beatles'],
    });
    expect(ler('7 Seconds', ['Desconhecido', 'Neneh Cherry'])?.artists).toEqual(['Neneh Cherry']);
    // Sem ninguém nomeado, o marcador fica: melhor "Desconhecido" que vazio.
    expect(ler('Sunrise Avenue Fairytale Gone Bad Video Clip', ['Desconhecido'])?.artists).toEqual([
      'Desconhecido',
    ]);
  });

  it('canal que se descreve no nome do artista vira o artista', () => {
    expect(
      ler('Stray Kids 『Hollow』 Music Video', ['Stray Kids Japan Official YouTube']),
    ).toMatchObject({ title: 'Hollow', artists: ['Stray Kids'] });
  });

  it('hashtag e "EP" não são gente', () => {
    expect(ler('"DIÑERO" - #OBGLÉTRAP', ['JÉ'])).toMatchObject({
      title: 'DIÑERO',
      artists: ['JÉ'],
    });
    expect(ler('EP "CAINDO EM SI"', ['Derxan'])?.artists).toEqual(['Derxan']);
  });

  it('selo de qualidade, extensão de arquivo e comentário do canal saem', () => {
    expect(ler('Human Nature HQ', ['Michael Jackson'])?.title).toBe('Human Nature');
    expect(ler('Manboy *HQ*', ['Eric Saade'])?.title).toBe('Manboy');
    expect(ler('Gloria! *WITH LYRICS*', ['Van Morrison'])?.title).toBe('Gloria!');
    expect(ler('Coco Jambo videoclip', ['Mr. President'])?.title).toBe('Coco Jambo');
    expect(ler('Losing My Religion Legendado PT-BR', ['R.E.M.'])?.title).toBe('Losing My Religion');
    expect(ler('Go your own way Live 1979 (360p).avi', ['Fleetwood Mac'])?.title).toBe(
      'Go your own way Live 1979',
    );
    expect(ler('Viver Tranquilo (Deejhay RB) Video', ['MC Tuto'])?.title).toBe(
      'Viver Tranquilo (Deejhay RB)',
    );
    expect(
      ler("Triple Lavada (Letra) || si saben cómo soy, ¿pa' qué me invitan? 🤠", ['Marinosaurio'])
        ?.title,
    ).toBe('Triple Lavada');
  });

  it('asterisco de censura é do nome', () => {
    expect(ler('POPPIN’ MY S***', ['Justin Bieber', 'Hurricane Chris'])).toBeNull();
    expect(ler('F* F* M*', ['Filipe Ret', 'Dallass'])).toBeNull();
    expect(ler('Video Games', ['Lana Del Rey'])).toBeNull();
  });
});
