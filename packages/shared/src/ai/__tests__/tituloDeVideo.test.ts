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
 * O CAMPO DE ARTISTA É UMA FRASE, E A MESMA PESSOA CHEGA ESCRITA DE TRÊS JEITOS.
 *
 * A chave comparava a frase inteira, então nenhuma destas cópias se reconhecia —
 * e é esta função que decide se a mesma música importada duas vezes vira uma
 * entrada ou duas na biblioteca.
 */
describe('chaveDeIdentidade — o que precisa colidir e o que não pode', () => {
  it('"&" e "e" no nome da dupla são a MESMA dupla', () => {
    expect(chaveDeIdentidade('Evidências', 'Chitãozinho & Xororó')).toBe(
      chaveDeIdentidade('EVIDENCIAS (Official Video)', 'Chitãozinho e Xororó'),
    );
  });

  it('crédito de feat a mais num dos lados não separa a faixa dela mesma', () => {
    expect(chaveDeIdentidade('Ousado Amor', 'Isaias Saad')).toBe(
      chaveDeIdentidade('Ousado Amor', 'Isaias Saad feat. Gabriela Rocha'),
    );
  });

  it('o selo grudado no artista não cria uma segunda entrada', () => {
    // "MK MUSIC, Anderson Freire" é como a faixa nasce quando vem do canal da
    // gravadora — e ela não pode virar outra música por causa disso.
    expect(chaveDeIdentidade('Raridade', 'MK MUSIC, Anderson Freire')).toBe(
      chaveDeIdentidade('Raridade', 'Anderson Freire'),
    );
  });

  it('COVER continua sendo outra faixa — é a proteção que não pode cair junto', () => {
    expect(chaveDeIdentidade('Evidências', 'Chitãozinho & Xororó')).not.toBe(
      chaveDeIdentidade('Evidências', 'Lauana Prado'),
    );
  });

  /**
   * "AO VIVO" NÃO SEPARA, "REMIX" SEPARA — e a diferença é deliberada.
   *
   * "(Ao Vivo)" e "(Acústico)" são rótulo que o canal escreve, e o MESMO vídeo
   * sobe com e sem eles; se separassem, toda faixa reenviada com o rótulo viraria
   * uma cópia nova na biblioteca. Quem de fato separa gravação de gravação é a
   * DURAÇÃO, conferida em `duplicatas.ts` — uma versão ao vivo nunca cai dentro
   * dos três segundos de tolerância da versão de estúdio.
   *
   * "Remix" fica na chave porque remix é outra faixa, com outro tempo e outra
   * capa, e fundir os dois apagaria uma música que o usuário escolheu ter.
   */
  it('"Ao Vivo" colide (quem separa é a duração), "Remix" não colide', () => {
    expect(chaveDeIdentidade('Evidências (Ao Vivo)', 'Fulano')).toBe(
      chaveDeIdentidade('Evidências', 'Fulano'),
    );
    expect(chaveDeIdentidade('Cheguei (Remix)', 'Ludmilla')).not.toBe(
      chaveDeIdentidade('Cheguei', 'Ludmilla'),
    );
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

  it('APÓSTROFO não é aspa — dois deles destruíam o título e o artista', () => {
    // Virou título "Roses - Sweet Child O" e artista "Guns N Mine": o leitor
    // achava que o pedaço entre os dois apóstrofos era o nome da faixa.
    const r = lerTituloDeVideo("Guns N' Roses - Sweet Child O' Mine");
    expect(r.title).toBe("Sweet Child O' Mine");
    expect(r.artists).toEqual(["Guns N' Roses"]);
    // As aspas de verdade continuam mandando.
    expect(lerTituloDeVideo('Nirvana "Come As You Are" Official Video').title).toBe(
      'Come As You Are',
    );
  });

  it('"(Áudio Oficial)" ficava dentro do nome da música', () => {
    // A palavra começa com acento, e a borda de palavra do JavaScript é ASCII:
    // o padrão nunca casava. Metade dos títulos gospel e sertanejos da
    // biblioteca carregava esse rabo, e por causa dele a mesma faixa vinda de
    // outro canal não era reconhecida como a mesma.
    expect(lerTituloDeVideo('Legião Urbana - Tempo Perdido (Áudio Oficial)').title).toBe(
      'Tempo Perdido',
    );
    expect(lerTituloDeVideo('Anitta - Envolver - Áudio Oficial').title).toBe('Envolver');
    // "(Lyrics)" no plural também passava batido.
    expect(lerTituloDeVideo('Adele - Someone Like You (Lyrics)').title).toBe('Someone Like You');
    expect(lerTituloDeVideo('BTS - Dynamite (Official MV)').title).toBe('Dynamite');
    // Crédito de produção é do produtor, não do nome da faixa.
    expect(lerTituloDeVideo('MC Hariel - Chapa Quente (Prod. DJ Boy)').title).toBe('Chapa Quente');
  });

  it('o que vem depois do "|" não é continuação do título', () => {
    // Os pedaços eram remontados com " - " no meio: "Ele Vem - OFICIAL".
    expect(lerTituloDeVideo('Isaias Saad - Ele Vem (Ao Vivo) | OFICIAL').title).toBe('Ele Vem');
    expect(lerTituloDeVideo('Ludmilla - Cheguei | Videoclipe Oficial').title).toBe('Cheguei');
    // Mas o primeiro pedaço nunca sai: a banda LIVE se chama LIVE.
    expect(lerTituloDeVideo('LIVE - Lightning Crashes').artists).toEqual(['LIVE']);
  });

  it('parêntese aberto sozinho não fica na prateleira', () => {
    // A descrição do canal era comida de dentro do parêntese e o "(" sobrava.
    expect(lerTituloDeVideo('Hallelujah (Cover Version) - Lucas').title).toBe('Hallelujah');
  });

  it('a resolução some junto com o "HD" que vinha antes dela', () => {
    // "…BAR & VIOLÃO HD" era o que sobrava: com "640x360" ainda no fim, o "HD"
    // não era o último pedaço e escapava.
    expect(lerTituloDeVideo('05 SÁ RODRIX & GUARABYRA POT POURRI HD 640x360').title).toBe(
      'SÁ RODRIX & GUARABYRA POT POURRI',
    );
  });

  it('crédito de produção não gruda no último cantor da lista', () => {
    // Nascia um artista chamado "Neguinho do Kaxeta - (DJ Boy)".
    const r = lerTituloDeVideo('MC Ryan SP, Neguinho do Kaxeta - "Liberdade" (DJ Boy)');
    expect(r.artists).toEqual(['MC Ryan SP', 'Neguinho do Kaxeta']);
  });

  it('"AC/DC" é UMA banda, não duas', () => {
    // Viravam "AC" e "DC": duas prateleiras, duas fotos, dois votos de gênero,
    // e nenhum dos dois existe. A barra só separa com espaço dos dois lados.
    expect(lerTituloDeVideo('AC/DC - Highway to Hell').artists).toEqual(['AC/DC']);
    // "vs." é encontro de dois artistas, e continuava colado num nome só.
    expect(lerTituloDeVideo('Alok vs. Sevenn - BYOB').artists).toEqual(['Alok', 'Sevenn']);
  });

  it('o nome do canal entra limpo, como o de qualquer artista', () => {
    // Sem passar pela limpeza, "Matuê - Topic" e "Caetano Veloso Oficial"
    // viravam artistas PARALELOS do mesmo cantor — prateleira, foto e votação
    // de gênero divididas em duas.
    expect(lerTituloDeVideo('Bença', 'Matuê - Topic').artists).toEqual(['Matuê']);
    expect(lerTituloDeVideo('Sozinho', 'Caetano Veloso Oficial').artists).toEqual([
      'Caetano Veloso',
    ]);
  });
});

/**
 * O SELO ESTAVA DENTRO DO NOME DA MÚSICA, e ninguém tinha ido buscar.
 *
 * O canal nem sempre é a gravadora — muitas faixas vêm do canal do cantor com o
 * selo colado no título entre parênteses. Ele ficava lá: o cartão da prateleira
 * mostrava "Não Pare ( MK Music)", e a mesma faixa importada de outro canal, sem
 * o selo no nome, não casava com ela.
 */
describe('lerTituloDeVideo — o selo dentro do título', () => {
  it('sai do título e vira o campo que é dele', () => {
    expect(lerTituloDeVideo('Não Pare ( MK Music)')).toMatchObject({
      title: 'Não Pare',
      label: 'MK Music',
    });
    expect(lerTituloDeVideo('Raridade (MK Music)').title).toBe('Raridade');
    expect(lerTituloDeVideo('Deus Proverá [Som Livre]')).toMatchObject({
      title: 'Deus Proverá',
      label: 'Som Livre',
    });
  });

  it('só o parêntese do selo sai — o outro é parte do nome', () => {
    expect(lerTituloDeVideo('Prioridad (Prioridade em Espanhol) ( MK Music)').title).toBe(
      'Prioridad (Prioridade em Espanhol)',
    );
  });

  it('acha o selo mesmo no meio do ruído do canal', () => {
    expect(lerTituloDeVideo('Jó - COM LETRA (VideoLETRA® oficial MK Music)')).toMatchObject({
      title: 'Jó',
      label: 'MK Music',
    });
  });

  it('o canal continua tendo preferência', () => {
    expect(lerTituloDeVideo('Anderson Freire - Raridade', 'MK MUSIC').label).toBe('MK MUSIC');
  });
});

/**
 * "ft. Fulano" É GENTE, E ESTAVA SENDO GRAVADO COMO NOME DE MÚSICA.
 *
 * O canal do próprio artista publica sem separador nenhum, e o convidado vem
 * grudado no fim do nome do vídeo. O estrago é duplo: o convidado nunca entra no
 * cadastro (sem prateleira, sem foto, sem voto de gênero) e o título fica com um
 * pedaço a mais, então a mesma faixa vinda de outro canal não casa com ela.
 */
describe('lerTituloDeVideo — convidado no nome da música', () => {
  it('tira o convidado do título e o põe entre quem canta', () => {
    expect(lerTituloDeVideo('Ninguém Explica Deus ft. Gabriela Rocha')).toMatchObject({
      title: 'Ninguém Explica Deus',
      artists: ['Gabriela Rocha'],
    });
    expect(
      lerTituloDeVideo('Os Sonhos de Deus ft. Juninho Black, Lukão Carvalho, Eli Soares'),
    ).toMatchObject({
      title: 'Os Sonhos de Deus',
      artists: ['Juninho Black', 'Lukão Carvalho', 'Eli Soares'],
    });
    expect(lerTituloDeVideo('Ousado Amor part. Isaias Saad').title).toBe('Ousado Amor');
    expect(lerTituloDeVideo('Coração Blindado feat. Fernandinho').title).toBe('Coração Blindado');
  });

  it('funciona junto com o separador, sem perder quem já estava lá', () => {
    expect(
      lerTituloDeVideo('MC Cabelinho - Deu Onda part. Ludmilla (Áudio Oficial)'),
    ).toMatchObject({
      title: 'Deu Onda',
      artists: ['MC Cabelinho', 'Ludmilla'],
    });
  });

  it('"Parte" não é "part." — o nome da faixa fica inteiro', () => {
    expect(lerTituloDeVideo("Racionais MC's - Vida Loka - Parte II").title).toBe(
      'Vida Loka - Parte II',
    );
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
