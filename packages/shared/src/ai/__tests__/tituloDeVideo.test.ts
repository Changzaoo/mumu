/**
 * TÍTULOS REAIS, copiados do banco de produção em 07/08/2026.
 *
 * Cada caso aqui é um estrago que aconteceu de verdade na prateleira. O mais
 * grave é o primeiro: o nome da música tinha ido para o campo do artista e a
 * lista de cantores para o campo do título — e como três sistemas decidem
 * olhando esses campos (gênero por artista, foto da ficha e detecção de
 * duplicata), um campo trocado estragava os três de uma vez.
 */
import { describe, expect, it } from 'vitest';
import {
  chaveDeIdentidade,
  lerTituloDeVideo,
  limparNomeDeArtista,
  separarArtistasGrudados,
} from '../tituloDeVideo.js';

describe('lerTituloDeVideo — o que é música e o que é gente', () => {
  it('as aspas mandam: o nome da faixa estava indo para o campo do artista', () => {
    const r = lerTituloDeVideo(
      'MC Ryan SP, Neguinho do Kaxeta, Vitinho Avassalador e MC PP da VS - "Liberdade" (DJ Boy)',
    );
    expect(r.title).toBe('Liberdade');
    expect(r.artists).toContain('MC Ryan SP');
    expect(r.artists).toContain('Neguinho do Kaxeta');
    // O que NÃO pode voltar a acontecer:
    expect(r.title).not.toContain('MC Ryan');
  });

  it('separador clássico "Artista - Música"', () => {
    const r = lerTituloDeVideo('Matuê - Anos Luz (Official Music Video)');
    expect(r.title).toBe('Anos Luz');
    expect(r.artists).toEqual(['Matuê']);
  });

  it('tira o ruído sem comer o nome da música', () => {
    expect(lerTituloDeVideo('U2 - Sunday Bloody Sunday (Live From Red Rocks)').title).toBe(
      'Sunday Bloody Sunday',
    );
    expect(lerTituloDeVideo('Gabriela Rocha - Lugar Secreto [CLIPE OFICIAL]').title).toBe(
      'Lugar Secreto',
    );
    expect(lerTituloDeVideo('Jó - COM LETRA (VideoLETRA® oficial)').title).toBe('Jó');
  });

  it('número de faixa e resolução de vídeo somem', () => {
    const r = lerTituloDeVideo('05 SÁ RODRIX & GUARABYRA - POT POURRI HD 640x360');
    expect(r.title).toBe('POT POURRI');
    expect(r.artists).toEqual(['SÁ RODRIX', 'GUARABYRA']);
  });

  it('CANAL DE GRAVADORA não vira artista', () => {
    // O caso "Raridade": o canal é MK MUSIC e o cantor é o Anderson Freire.
    const r = lerTituloDeVideo('Anderson Freire - Raridade', 'MK MUSIC');
    expect(r.artists).toEqual(['Anderson Freire']);
    expect(r.label).toBe('MK MUSIC');
    expect(r.artists).not.toContain('MK MUSIC');
  });

  it('canal comum VIRA artista quando não há mais nada', () => {
    const r = lerTituloDeVideo('Lugar Secreto', 'Gabriela Rocha');
    expect(r.title).toBe('Lugar Secreto');
    expect(r.artists).toEqual(['Gabriela Rocha']);
  });

  it('o selo no lado do artista não é gravado como quem canta', () => {
    const r = lerTituloDeVideo('MK MUSIC - Raridade');
    expect(r.title).toBe('Raridade');
    expect(r.artists).toEqual([]);
    expect(r.label).toBe('MK MUSIC');
  });

  it('lista longa de artistas quebra certo', () => {
    const r = lerTituloDeVideo('Alok, DJ Victor, MC Hariel e MC Davi - "ILUSÃO"');
    expect(r.title).toBe('ILUSÃO');
    expect(r.artists).toEqual(['Alok', 'DJ Victor', 'MC Hariel', 'MC Davi']);
  });

  it('não inventa nada num título simples', () => {
    const r = lerTituloDeVideo('Evidências');
    expect(r.title).toBe('Evidências');
    expect(r.artists).toEqual([]);
  });
});

describe('chaveDeIdentidade — é ela que faz duas cópias se reconhecerem', () => {
  it('a MESMA música com nomes de vídeo diferentes tem a mesma chave', () => {
    // A duplicata que passava batido: mesma faixa, dois canais, dois nomes.
    const a = chaveDeIdentidade('BENÇA (Official Music Video)', 'Matuê');
    const b = chaveDeIdentidade('BENÇA', 'Matuê');
    const c = chaveDeIdentidade('Bença [CLIPE OFICIAL]', 'MATUÊ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('músicas DIFERENTES não colidem', () => {
    expect(chaveDeIdentidade('Anos Luz', 'Matuê')).not.toBe(chaveDeIdentidade('BENÇA', 'Matuê'));
  });

  it('a mesma música de artistas diferentes não colide', () => {
    // Regravação e cover continuam sendo faixas distintas.
    expect(chaveDeIdentidade('Raridade', 'Anderson Freire')).not.toBe(
      chaveDeIdentidade('Raridade', 'Outro Cantor'),
    );
  });

  it('funciona sem artista, para o caso de a atribuição ainda estar vazia', () => {
    expect(chaveDeIdentidade('BENÇA (Official Video)')).toBe(chaveDeIdentidade('bença'));
  });
});

/**
 * REGRESSÕES PEGAS EM PRODUÇÃO, na primeira volta da curadoria com o leitor
 * ligado. As três estragaram títulos de verdade antes de eu ver o log.
 *
 * A causa das duas primeiras é a mesma: a regra "Artista - Música" assume que o
 * lado DIREITO é a música. Quando o canal põe descrição ali, o nome da faixa é
 * jogado fora — e o resultado tem cara de título, então nada reclama.
 */
describe('lerTituloDeVideo — regressões vistas em produção', () => {
  it('descrição depois do separador não rouba o lugar do título', () => {
    // Virou "Bg Prevod" (= "legendas em búlgaro").
    expect(lerTituloDeVideo('Simply The Best - Bg Prevod').title).toBe('Simply The Best');
  });

  it('"sound-a-like / as made famous by" não vira o nome da música', () => {
    const r = lerTituloDeVideo(
      'How Will I Know (Who You Are) - Sound-A-Like As Made Famous By: Jessica Folcker',
    );
    expect(r.title).toBe('How Will I Know (Who You Are)');
  });

  it('NÚMERO que faz parte do nome não é confundido com número de faixa', () => {
    // Virou "lil crips".
    expect(lerTituloDeVideo('10 lil crips').title).toBe('10 lil crips');
    expect(lerTituloDeVideo('7 Days').title).toBe('7 Days');
    expect(lerTituloDeVideo('99 Problemas').title).toBe('99 Problemas');
  });

  it('mas numeração de disco continua saindo', () => {
    // Zero à esquerda ou separador logo depois: é numeração, não nome.
    expect(lerTituloDeVideo('05 SÁ RODRIX & GUARABYRA - POT POURRI').title).toBe('POT POURRI');
    expect(lerTituloDeVideo('12 - Evidências').title).toBe('Evidências');
    expect(lerTituloDeVideo('3. Sozinho').title).toBe('Sozinho');
  });
});

/**
 * O DADO ESTAVA GRUDADO UM NÍVEL ABAIXO DO QUE A REGRA ENXERGAVA.
 *
 * O conserto da gravadora-como-artista procurava o selo no PRIMEIRO item de
 * `artists` e promovia o próximo. Só que no banco existe UM item cujo nome é a
 * lista inteira — `[{name:"MK MUSIC, Elaine Martins"}]` — então não havia
 * "próximo" para promover, a regra devolvia "nada a fazer", e a prateleira
 * Gospel continuou vazia mesmo com o conserto no ar e sem nenhum erro no log.
 */
describe('separarArtistasGrudados', () => {
  it('separa quando o selo está grudado no cantor', () => {
    // "Oficial" é marca de canal e sai junto — ver `limparNomeDeArtista`.
    expect(separarArtistasGrudados(['MK MUSIC, Elaine Martins Oficial'])).toEqual([
      'MK MUSIC',
      'Elaine Martins',
    ]);
    expect(separarArtistasGrudados(['MK MUSIC, Anderson Freire'])).toEqual([
      'MK MUSIC',
      'Anderson Freire',
    ]);
  });

  it('NÃO quebra dupla/grupo real que tem separador no nome', () => {
    // O risco de separar por separar: virariam dois artistas inexistentes.
    expect(separarArtistasGrudados(['Simon & Garfunkel'])).toBeNull();
    expect(separarArtistasGrudados(['Tyler, The Creator'])).toBeNull();
    expect(separarArtistasGrudados(['Chitãozinho & Xororó'])).toBeNull();
  });

  it('não mexe no que já veio separado nem em nome simples', () => {
    expect(separarArtistasGrudados(['Matuê', 'Teto'])).toBeNull();
    expect(separarArtistasGrudados(['Gabriela Rocha'])).toBeNull();
    expect(separarArtistasGrudados([])).toBeNull();
  });
});

/**
 * "Oficial" é o canal dizendo que é o canal certo — não faz parte do nome de
 * ninguém. Entrando no cadastro, ele criava um artista PARALELO do mesmo
 * cantor: "Gabriela Rocha" e "Gabriela Rocha Oficial" viram duas prateleiras,
 * duas fotos e duas discografias — e a votação de gênero, que depende das
 * faixas de uma pessoa estarem juntas, se divide junto.
 */
describe('limparNomeDeArtista', () => {
  it('tira a marca de canal do fim do nome', () => {
    expect(limparNomeDeArtista('Elaine Martins Oficial')).toBe('Elaine Martins');
    expect(limparNomeDeArtista('Midian Lima Oficial')).toBe('Midian Lima');
    expect(limparNomeDeArtista('Sarah Farias - Oficial')).toBe('Sarah Farias');
    expect(limparNomeDeArtista('Gabriela Rocha Official')).toBe('Gabriela Rocha');
    expect(limparNomeDeArtista('Anderson Freire - Topic')).toBe('Anderson Freire');
  });

  it('não mexe em nome que não tem a marca', () => {
    expect(limparNomeDeArtista('Anderson Freire')).toBe('Anderson Freire');
    expect(limparNomeDeArtista('Matuê')).toBe('Matuê');
  });

  it('só corta no FIM e como palavra inteira', () => {
    // Cortar no meio inventaria nome que não existe.
    expect(limparNomeDeArtista('Oficial da Casa')).toBe('Oficial da Casa');
    expect(limparNomeDeArtista('Officialize')).toBe('Officialize');
  });

  it('a separação de artistas já entrega os nomes limpos', () => {
    expect(separarArtistasGrudados(['MK MUSIC, Elaine Martins Oficial'])).toEqual([
      'MK MUSIC',
      'Elaine Martins',
    ]);
  });
});
