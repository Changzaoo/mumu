/**
 * O QUE É TÍTULO, O QUE É ARTISTA, O QUE É GRAVADORA.
 *
 * Toda faixa importada por link nasce do nome de um vídeo, e nome de vídeo não
 * é metadata: é uma frase livre que o canal escreveu para atrair clique. Sem
 * alguém para separar as partes, o que sobra é isto — casos reais da biblioteca:
 *
 *   título:  "MC Ryan SP, Neguinho do Kaxeta, Vitinho Avassalador e MC PP..."
 *   artista: "Liberdade"                              ← TROCADOS
 *
 *   título:  "Alok, DJ Victor, MC Hariel, MC Marks..."
 *   artista: "GR6 EXPLODE"                            ← canal, não artista
 *
 *   título:  "05 SÁ RODRIX & GUARABYRA POT POURRI DVD BAR & VIOLÃO HD 640x360"
 *                                                     ← faixa, ruído, resolução
 *
 * E o estrago não para na tela. Três sistemas decidem olhando esses campos:
 *
 *  - a COERÊNCIA DE GÊNERO vota pela discografia do artista. Com o canal no
 *    lugar do artista, faixas de cantores diferentes votam juntas e nenhuma
 *    maioria se forma — foi assim que o Gospel apareceu vazio.
 *  - a FOTO da ficha é buscada pelo nome do artista — e trouxe logotipo de
 *    gravadora no lugar de rosto.
 *  - a DUPLICATA usa o artista como PORTÃO: `if (!mesmoArtista) return null`.
 *    Com artistas podres, duas cópias da mesma música nunca chegam a ser
 *    comparadas. É por isso que nem título idêntico era detectado.
 *
 * Este módulo é função pura: recebe o nome do vídeo e o nome do canal, devolve
 * as partes separadas. Nada de rede, nada de IA — a IA entra depois, e entra
 * melhor, porque recebe campos já separados em vez de uma frase inteira.
 */
import { acharGravadora, ehGravadora, ehSelo } from './gravadoraComoArtista.js';

/**
 * Ruído que canal põe no nome do vídeo e que não é parte de nada.
 *
 * A lista cresce com o que aparece de verdade. Cada padrão aqui já produziu uma
 * duplicata que passou batido ou um título feio na prateleira.
 */
const RUIDO_PALAVRAS = [
  'official music video',
  'official video',
  'official audio',
  'official lyric video',
  'lyric video',
  'videoclipe oficial',
  'clipe oficial',
  'video oficial',
  'vídeo oficial',
  'audio oficial',
  'áudio oficial',
  'video clipe',
  'lyric',
  'letra',
  'com letra',
  'legendado',
  'traducao',
  'tradução',
  'legendas',
  'ao vivo',
  'live',
  'acustico',
  'acústico',
  'remaster',
  'remastered',
  'hd',
  'full hd',
  '4k',
  'shorts',
  'visualizer',
  'videoletra',
  // Descrição do canal que vinha DEPOIS do separador e era confundida com o
  // nome da música: "Simply The Best - Bg Prevod" virava "Bg Prevod", e
  // "How Will I Know - Sound-A-Like As Made Famous By: X" perdia a música
  // inteira. Retirados ANTES da divisão, o separador some junto e o título
  // certo fica.
  'bg prevod',
  'prevod',
  'sound-a-like',
  'sound a like',
  'as made famous by',
  'made famous by',
  'karaoke version',
  'karaoke',
  'cover version',
  'subtitles',
  'sub espanol',
  'sub español',
  // "(Lyrics)" no plural passava batido: a regra pedia a palavra inteira e
  // "lyric" não é palavra inteira dentro de "lyrics".
  'lyrics',
];

/**
 * Ruído que SÓ é ruído dentro de parênteses.
 *
 * "Oficial", "Vídeo", "Prod" são palavras que aparecem em nome de música de
 * verdade ("Corpo Oficial", "Vídeo Game"). Entre parênteses, não: ali é sempre
 * o canal se anunciando ou creditando quem produziu. Manter a lista separada é
 * o que permite tirar "(Áudio Oficial)" sem arriscar comer a última palavra de
 * um título.
 */
const RUIDO_SO_ENTRE_PARENTESES = [
  'oficial',
  'official',
  'videoclipe',
  'video clipe',
  'video',
  'audio',
  'mv',
  'prod',
];

/**
 * DESCRIÇÃO DO CANAL — come daqui até o fim da frase.
 *
 * Estas não são palavras soltas, são o começo de uma explicação que o canal
 * grudou no nome ("...- Sound-A-Like As Made Famous By: Jessica Folcker").
 * Retirar só a expressão deixava o rabo (": Jessica Folcker"), e o rabo virava
 * o título depois da divisão pelo separador — que é justamente o estrago.
 */
const DESCRICAO_DO_CANAL =
  /\s*[-–—|]?\s*\b(?:sound[- ]a[- ]like|(?:as )?made famous by|bg prevod|prevod|karaoke(?: version)?|cover version|subtitles?|sub espa[nñ]ol)\b.*$/i;

/** Separadores que o YouTube usa entre artista e música. */
const SEPARADOR = /\s+[-–—]\s+|\s+[|｜]\s+/;

export interface PartesDoVideo {
  /** O nome da música, já sem ruído. */
  title: string;
  /** Quem canta, na ordem em que apareceu. Pode vir vazio. */
  artists: string[];
  /** Selo detectado no texto ou no canal, quando houver. */
  label: string | null;
}

/** Tira acentos e caixa para comparar — não para exibir. */
function chave(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A mesma normaliza\u00e7\u00e3o, exposta para montar o conjunto de nomes conhecidos. */
export function chaveDeArtista(nome: string): string {
  return chave(nome);
}

/**
 * As palavras de ruído JÁ NORMALIZADAS, para conferir sem tropeçar em acento.
 *
 * `\b` do JavaScript é ASCII: em `\báudio oficial\b` a borda antes do "á" nunca
 * fecha, então "(Áudio Oficial)" — que é metade dos títulos gospel e sertanejos
 * da biblioteca — sobrevivia inteiro dentro do nome da música. Comparando sobre
 * a chave sem acento o problema deixa de existir.
 */
const RUIDO_NA_CHAVE = new RegExp(
  ` (?:${[...RUIDO_PALAVRAS, ...RUIDO_SO_ENTRE_PARENTESES].map((p) => chave(p)).join('|')}) `,
);

/** O pedaço inteiro é ruído e nada mais? */
const SO_RUIDO = new RegExp(
  `^(?:${[...RUIDO_PALAVRAS, ...RUIDO_SO_ENTRE_PARENTESES].map((p) => chave(p)).join('|')})$`,
);

/** `(qualquer coisa)`, `[idem]`, `（idem）` — com o conteúdo na mão. */
const PARENTESES = /[([（]([^)\]）]*)[)\]）]/g;

/**
 * Decide parêntese por parêntese, em vez de casar um padrão gigante.
 *
 * Dois motivos: o selo entre parênteses ("Não Pare ( MK Music)") só é
 * reconhecível consultando a lista de gravadoras, e o conteúdo precisa ser
 * julgado INTEIRO — em "Prioridad (Prioridade em Espanhol) ( MK Music)" o
 * primeiro parêntese é parte do nome da faixa e só o segundo é selo.
 */
function limparParenteses(texto: string): string {
  return texto.replace(PARENTESES, (todo, dentro: string) => {
    if (ehGravadora(dentro)) return ' ';
    return RUIDO_NA_CHAVE.test(` ${chave(dentro)} `) ? ' ' : todo;
  });
}

/** Remove o ruído de um pedaço de texto, preservando acentos e caixa. */
function limpar(texto: string): string {
  return (
    // A descrição vem PRIMEIRO: ela leva o separador junto, e sem separador a
    // divisão "Artista - Música" nem chega a acontecer no lado errado.
    limparParenteses(texto.replace(DESCRICAO_DO_CANAL, ' '))
      // Resolução de vídeo colada ("640x360"), marca registrada, hashtags.
      // Vêm ANTES do ruído solto: com "640x360" ainda no fim da frase, o "HD"
      // que estava logo antes não era o último pedaço e escapava da limpeza —
      // "…BAR & VIOLÃO HD" era o que sobrava na prateleira.
      .replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/g, ' ')
      .replace(/[®™©]/g, ' ')
      .replace(/#\w+/g, ' ')
      // Ruído solto, sem parênteses, no fim da frase.
      .replace(
        new RegExp(String.raw`\s+[-–—|]?\s*\b(?:${RUIDO_PALAVRAS.join('|')})\b\s*$`, 'i'),
        ' ',
      )
      // Número de FAIXA no começo — e o corte é estreito de propósito.
      //
      // A regra era `^\d{1,2}\s*[-.]?\s+`, que engolia qualquer número solto na
      // frente: "10 lil crips" virava "lil crips". Número faz parte do nome de
      // música com frequência ("7 Days", "99 Problemas", "10 lil crips").
      //
      // Numeração de disco tem forma reconhecível: zero à esquerda ("05 ") ou
      // um separador logo depois ("12 - ", "3. "). Sem uma das duas marcas, o
      // número fica — errar deixando é invisível, errar tirando apaga o nome.
      .replace(/^\s*(?:0\d|\d{1,2}\s*[-.])\s*/, '')
      // Sobras de pontuação e espaço. O parêntese ABERTO que ficou sozinho
      // entra aqui: quando a descrição do canal é comida a partir de dentro de
      // um parêntese ("Hallelujah (Cover Version) - Lucas"), o que sobrava na
      // prateleira era "Hallelujah (".
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—,;|)\]}]+|[\s\-–—,;|([{]+$/g, '')
      .trim()
  );
}

/**
 * Quebra uma lista de nomes: "A, B e C", "A & B", "A feat. B", "A x B".
 *
 * O `e`/`and` só separa cercado de espaços — senão "Anderson" e "Rondinelly"
 * perderiam pedaços no meio da palavra.
 */
export function separarNomes(texto: string): string[] {
  return (
    texto
      // A barra exige espaço dos dois lados. Sem isso "AC/DC" virava DOIS
      // artistas — "AC" e "DC" — cada um com sua prateleira, sua foto e seu
      // voto de gênero, e nenhum deles existe.
      //
      // "vs" e "x" EXIGEM espaço dos DOIS lados (`\s+…\s+`, não `\s*`): o time de
      // funk "MC PP da VS" terminava com "VS", e como o antigo `\bvs\b` fechava
      // borda no fim da string, o nome era decepado para "MC PP da" — um artista
      // que não existe. Com espaço obrigatório depois, um "VS" no fim não é mais
      // confundido com o "vs" de "Alok vs. Sevenn".
      .split(
        /\s*(?:,|&|\+|\bfeat\.?\b|\bft\.?\b|\bcom\b|\be\b|\band\b)\s*|\s+(?:vs\.?|x)\s+|\s+\/\s+/i,
      )
      .map((n) => limparNomeDeArtista(n))
      .filter((n) => n.length > 1 && n.length < 60)
  );
}

/**
 * "Oficial" NÃO É PARTE DO NOME — é o canal dizendo que é o canal certo.
 *
 * O nome do canal vira o nome do artista, e canal se chama "Elaine Martins
 * Oficial", "Midian Lima Oficial", "Sarah Farias - Oficial", "FulanoVEVO". O
 * sufixo entrava no cadastro e criava um artista PARALELO do mesmo cantor:
 * "Gabriela Rocha" e "Gabriela Rocha Oficial" viram duas prateleiras, duas
 * fotos e duas discografias. De quebra quebram a votação de gênero, que só
 * funciona com as faixas de uma pessoa juntas.
 *
 * Só sai no FIM e como palavra inteira: existe nome com "Oficial" no meio, e
 * cortar ali inventaria um artista que não existe.
 */
export function limparNomeDeArtista(nome: string): string {
  return (
    nome
      .trim()
      .replace(/\s*[-–—|]?\s*\b(?:oficial|official|vevo|topic|ao vivo)\b\s*$/i, '')
      .replace(/\s*[-–—|,]\s*$/, '')
      // Pontuação que sobra na frente quando o nome vem de uma lista quebrada
      // ("feat. Ludmilla" deixava ". Ludmilla", e a pessoa era cadastrada assim).
      .replace(/^[\s\-–—|,.:;]+/, '')
      .trim()
  );
}

/**
 * UM CAMPO DE ARTISTA QUE, NA VERDADE, TRAZ VÁRIOS.
 *
 * No banco, `artists` costuma ter UM item cujo nome é a lista inteira:
 *
 *   [{ name: "MK MUSIC, Elaine Martins Oficial" }]   ← um item, dois nomes
 *
 * Isso derrotava silenciosamente o conserto da gravadora-como-artista: aquela
 * regra procura o selo no PRIMEIRO item e promove o próximo — e como só existe
 * um item, ela não tinha o que promover e devolvia "nada a fazer". A prateleira
 * Gospel continuou vazia mesmo com o conserto no ar, porque o dado estava
 * grudado num nível abaixo do que a regra enxergava.
 *
 * Devolve `null` quando não há nada a separar, para quem chama distinguir
 * "já estava certo" de "separei".
 */
/**
 * Artigo que marca a 2ª parte como CONTINUAÇÃO do nome, não um novo artista.
 *
 * "Tyler, The Creator" é UM artista, e a vírgula ali é parte do nome. O sinal é
 * o pedaço depois da vírgula começar com artigo seguido de mais palavra —
 * "The Creator", "Os Paralamas". Sem a palavra depois, "The" sozinho não conta.
 */
const ARTIGO_DE_CONTINUACAO = /^(?:the|a|o|os|as|la|los|le|les)\s+\S/i;

/** Marcadores de convidado — separam quem canta, e nunca protegem grupo. */
const CONVIDADO_EM_LISTA = /\s*\b(?:feat|ft|part|participacao|participação)\b\.?\s*:?\s+/i;

/**
 * QUEBRA UMA STRING EM NOMES, RESPEITANDO O QUE É BANDA DE VERDADE.
 *
 * Separa só por VÍRGULA e por feat/ft/part — os cortes que numa lista de
 * artistas quase sempre querem dizer "e mais um". Nunca separa por "&", "/", "e",
 * "x" nem "vs".
 *
 * O SINAL DECISIVO É O "&". Existe banda com VÍRGULA no nome — "Earth, Wind &
 * Fire", "Crosby, Stills, Nash & Young", "Blood, Sweat & Tears" — e nelas o "&"
 * conectando os últimos elementos é o padrão clássico de nome de banda: as
 * vírgulas ali são parte do nome, não uma lista de colaboração. Uma colaboração
 * usa vírgula/feat e NÃO termina em "& Fulano". Então um trecho que contém "&"
 * fica INTEIRO — quebrá-lo inventaria artistas que não existem.
 *
 * Protege ainda "X, The Y": o pedaço depois da vírgula começando com artigo é a
 * continuação do nome ("Tyler, The Creator"), não um segundo artista.
 *
 * Na dúvida, NÃO separa: colar uma colaboração é um aborrecimento pequeno;
 * quebrar uma banda real é o erro a evitar.
 */
function quebrarListaDeNomes(texto: string, conhecidos?: ReadonlySet<string>): string[] {
  const saida: string[] = [];
  for (const trecho of texto.split(CONVIDADO_EM_LISTA)) {
    const t = trecho.trim();
    if (!t) continue;
    // Contém "&" → é nome de banda POR PADRÃO, fica inteiro.
    //
    // Mas "Earth, Wind & Fire" (banda) e "Matuê, WIU & Teto" (colaboração de
    // trap) têm a mesma forma "A, B & C" — o texto sozinho não distingue. Quem
    // distingue é a biblioteca: se CADA parte já existe como artista separado
    // (Matuê, WIU e Teto aparecem sozinhos em dezenas de faixas), é colaboração
    // de gente real e separa; se não (ninguém tem faixa só de "Earth", "Wind"
    // ou "Fire"), continua sendo o nome de uma banda. Sem a lista de conhecidos,
    // mantém o padrão seguro: não quebra.
    if (t.includes('&')) {
      const partes = t
        .split(/\s*(?:,|&|\be\b)\s*/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (
        conhecidos &&
        partes.length >= 2 &&
        partes.every((p) => conhecidos.has(chave(p)))
      ) {
        for (const p of partes) saida.push(p);
      } else {
        saida.push(t);
      }
      continue;
    }
    const porVirgula = t.split(',');
    for (let i = 0; i < porVirgula.length; i += 1) {
      const parte = porVirgula[i]!.trim();
      if (!parte) continue;
      // A religação por artigo só vale DENTRO da mesma vírgula (i > 0): um artigo
      // abrindo um trecho de convidado ("X feat. The Weeknd") é gente, não
      // continuação. E se o próprio trecho já é um artista CONHECIDO ("The Game"
      // aparece sozinho na biblioteca), é um segundo artista, não continuação —
      // é o que separa "Snoop Dogg, The Game" (colab) de "Tyler, The Creator".
      const ehConhecido = conhecidos?.has(chave(limparNomeDeArtista(parte))) ?? false;
      if (i > 0 && saida.length > 0 && ARTIGO_DE_CONTINUACAO.test(parte) && !ehConhecido) {
        saida[saida.length - 1] = `${saida[saida.length - 1]}, ${parte}`;
      } else {
        saida.push(parte);
      }
    }
  }
  return saida;
}

/**
 * DEDUPLICA nomes que só diferem por acento, pontuação, ©/™ ou caixa, mantendo a
 * grafia mais limpa: "Ms. Toi"/"Ms Toi" colapsam num só, e "Costi"/"Costi ©"
 * ficam como "Costi". A ordem de primeira aparição é preservada.
 */
function deduplicarNomes(nomes: string[]): string[] {
  const escolhido = new Map<string, string>();
  const ordem: string[] = [];
  for (const nome of nomes) {
    const k = chave(nome);
    if (!k) continue;
    const atual = escolhido.get(k);
    if (atual === undefined) {
      escolhido.set(k, nome);
      ordem.push(k);
    } else if (sujeiraDoNome(nome) < sujeiraDoNome(atual)) {
      escolhido.set(k, nome);
    }
  }
  return ordem.map((k) => escolhido.get(k)!);
}

/** Quanto de lixo tipográfico um nome carrega — menor é mais limpo. */
function sujeiraDoNome(nome: string): number {
  let s = 0;
  if (/[©®™]/.test(nome)) s += 100;
  if (/^[^\p{L}\p{N}]|[^\p{L}\p{N}]$/u.test(nome.trim())) s += 10;
  return s;
}

/**
 * UM CAMPO DE ARTISTA QUE, NA VERDADE, TRAZ VÁRIOS — agora separado de verdade.
 *
 * No banco, `artists` costuma ter UM item cujo nome é a lista inteira:
 *
 *   [{ name: "Snoop Dogg, Dr. Dre, D'Angelo" }]      ← um item, três nomes
 *   [{ name: "Ton Carfi, Rocket Music Brazil" }]     ← um item, um cantor + selo
 *
 * A versão antiga só quebrava quando alguma parte era selo (`ehGravadora`), então
 * a lista pura de cantores — o caso comum — ficava grudada: cada lista virava um
 * "artista" só, bagunçando prateleira, foto e voto de gênero. Agora ela sempre
 * quebra a lista, PROTEGE o grupo de verdade (`&`, `/`, "X, The Y"), FILTRA o
 * selo escondido no meio (vira label, não quem canta) e DEDUPLICA a grafia suja.
 *
 * Devolve `null` só quando não há NADA a fazer (já separado e limpo), para quem
 * chama distinguir "já estava certo" de "separei".
 */
export function separarArtistasGrudados(
  nomes: readonly string[],
  conhecidos?: ReadonlySet<string>,
): string[] | null {
  const bruto = nomes
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n.length > 0);
  if (bruto.length === 0) return null;

  // 1) Cada item pode ser uma lista colada: quebra todos em nomes soltos.
  const soltos: string[] = [];
  for (const item of bruto) {
    for (const nome of quebrarListaDeNomes(item, conhecidos)) {
      const limpo = limparNomeDeArtista(nome);
      if (limpo.length > 1 && limpo.length < 60) soltos.push(limpo);
    }
  }
  if (soltos.length === 0) return null;

  // 2) O selo escondido no meio da lista vira label, não quem canta. Mas se
  //    filtrar esvaziaria tudo (era só selo), preserva o que há — deixar a faixa
  //    sem artista nenhum é pior do que um selo a mais.
  const semSelo = soltos.filter((n) => !ehSelo(n));
  const candidatos = semSelo.length > 0 ? semSelo : soltos;

  // 3) Deduplica a grafia suja ("Costi" no lugar de "Costi ©").
  const final = deduplicarNomes(candidatos);

  // 4) Só reporta trabalho quando MUDOU de verdade — senão devolve null.
  const igual = final.length === bruto.length && final.every((n, i) => n === bruto[i]);
  return igual ? null : final;
}

/**
 * O TRECHO ENTRE ASPAS É A MÚSICA.
 *
 * Nos canais de funk e de gospel a fórmula é constante: os cantores vêm soltos e
 * o nome da faixa vem entre aspas — `MC Ryan SP, MC Kako - "Liberdade" (DJ...)`.
 * Era exatamente esse formato que entrava trocado, com a lista de cantores no
 * campo do título e a música no campo do artista.
 */
const ASPAS = /["“”]([^"“”]{2,60})["“”]|‘([^’]{2,60})’/;
/** As mesmas aspas, para apagar o trecho citado do resto da frase. */
const ASPAS_TODAS = /["“”][^"“”]*["“”]|‘[^’]*’/g;

/**
 * O APÓSTROFO NÃO É ASPA — e tratá-lo como aspa destruía nomes clássicos.
 *
 * `'` e `’` estavam na mesma classe de `"`, então qualquer título com DOIS
 * apóstrofos era lido como se tivesse um trecho citado no meio:
 *
 *   "Guns N' Roses - Sweet Child O' Mine"
 *     → título "Roses - Sweet Child O", artista "Guns N Mine"
 *
 * Só `"…"` e o par tipográfico `‘…’` delimitam. O apóstrofo solto fica onde
 * está, que é dentro do nome de quem canta.
 */
function trechoEntreAspas(texto: string): string | null {
  const m = ASPAS.exec(texto);
  return (m?.[1] ?? m?.[2])?.trim() ?? null;
}

/**
 * "ft. Fulano" NO NOME DA MÚSICA É GENTE, NÃO É TÍTULO.
 *
 * O canal do artista publica sem separador nenhum — o nome do vídeo é só a
 * música, e o convidado vem grudado no fim: "Ninguém Explica Deus ft. Gabriela
 * Rocha", "Os Sonhos de Deus ft. Juninho Black, Lukão Carvalho, Eli Soares".
 * Sem separar, a Gabriela Rocha some do cadastro (nunca ganha prateleira, foto
 * nem voto de gênero) e a mesma faixa importada de outro canal, sem o crédito
 * no título, não é reconhecida como a mesma.
 *
 * "Parte" não é "part.": a borda de palavra protege "Vida Loka - Parte II".
 */
const CONVIDADOS = /\s*[-–—|([]?\s*\b(?:feat|ft|part|participacao|participação)\b\.?\s*:?\s+(.+)$/i;

function extrairConvidados(titulo: string): { titulo: string; convidados: string[] } {
  const m = CONVIDADOS.exec(titulo);
  if (!m) return { titulo, convidados: [] };
  const convidados = separarNomes(m[1]!.replace(/[)\]]+\s*$/, '')).filter((n) => !ehGravadora(n));
  if (convidados.length === 0) return { titulo, convidados: [] };
  return { titulo: limpar(titulo.slice(0, m.index)), convidados };
}

/** Junta o resultado tirando os convidados de dentro do nome da música. */
function montar(titulo: string, artistas: string[], label: string | null): PartesDoVideo {
  const { titulo: nome, convidados } = extrairConvidados(titulo);
  const nomes = [...artistas];
  for (const c of convidados) {
    if (!nomes.some((n) => chave(n) === chave(c))) nomes.push(c);
  }
  return { title: nome, artists: nomes, label };
}

/**
 * Separa o nome de um vídeo em música, artistas e selo.
 *
 * `canal` é o nome do canal que publicou — usado só como último recurso para o
 * artista, e descartado quando é gravadora ou agregador.
 */
export function lerTituloDeVideo(bruto: string, canal?: string | null): PartesDoVideo {
  const limpo = limpar(bruto ?? '');
  // O selo também mora DENTRO do nome do vídeo — "Não Pare ( MK Music)",
  // "Deus Proverá [Som Livre]". `limpar` já tirou o trecho do título; aqui ele
  // é recuperado do texto bruto para virar o campo que é dele.
  const label = canal && ehGravadora(canal) ? canal.trim() : acharGravadora(bruto ?? '');

  // 1) Aspas mandam: o que está dentro é a música, o que está fora são nomes.
  const citado = trechoEntreAspas(limpo);
  if (citado) {
    // Os parênteses saem junto: o que sobrava depois do trecho citado era o
    // crédito de produção, e ele grudava no último cantor da lista —
    // "Neguinho do Kaxeta - (DJ Boy)" virava UM artista com esse nome.
    const fora = limpo.replace(ASPAS_TODAS, ' ').replace(PARENTESES, ' ');
    const artistas = separarNomes(limpar(fora)).filter((n) => !ehGravadora(n));
    return montar(limpar(citado), artistas, label);
  }

  // 2) O separador clássico "Artista - Música".
  const partes = limpo
    .split(SEPARADOR)
    .map((p) => limpar(p))
    .filter(Boolean)
    // Pedaço que é SÓ ruído depois do separador ("… | OFICIAL", "… - Áudio
    // Oficial") era remontado dentro do título, virando "Ele Vem - OFICIAL".
    // O primeiro pedaço nunca sai: a banda LIVE se chama LIVE.
    .filter((p, i) => i === 0 || !SO_RUIDO.test(chave(p)));
  if (partes.length >= 2) {
    const [esquerda, ...resto] = partes;
    const direita = resto.join(' - ');
    const artistas = separarNomes(esquerda!).filter((n) => !ehGravadora(n));
    // Lado esquerdo era só o selo ("MK MUSIC - Raridade"): o artista some, mas
    // o título fica certo — melhor do que gravar o selo como quem canta.
    return montar(direita, artistas, label ?? (artistas.length === 0 ? esquerda! : null));
  }

  // 3) Sem separador nem aspas: o nome inteiro é a música. O canal vira artista
  //    SÓ quando não é gravadora nem agregador — canal de terceiro no lugar do
  //    cantor é o erro que este módulo existe para não repetir.
  const doCanal = limparNomeDeArtista(canal?.trim() ?? '');
  const artistas = doCanal && !ehGravadora(doCanal) ? [doCanal] : [];
  return montar(partes[0] ?? limpo, artistas, label);
}

/**
 * A CHAVE DE IDENTIDADE de uma faixa — é ela que faz duas cópias se
 * reconhecerem.
 *
 * Junta artista e música já normalizados e sem ruído. "BENÇA" e
 * "BENÇA (Official Video)" produzem a mesma chave; "Raridade" do Anderson
 * Freire e "Raridade" de outro cantor, não.
 *
 * DO LADO DO ARTISTA VALE SÓ O PRIMEIRO NOME DE VERDADE. O campo de artista de
 * uma faixa importada é uma frase, e a mesma pessoa chega escrita de três
 * jeitos conforme o canal:
 *
 *   "Chitãozinho & Xororó"  /  "Chitãozinho e Xororó"
 *   "Isaias Saad"           /  "Isaias Saad feat. Gabriela Rocha"
 *   "Anderson Freire"       /  "MK MUSIC, Anderson Freire"
 *
 * Comparando a frase inteira, nenhuma dessas cópias se reconhecia — e é
 * exatamente esta função que decide se a mesma música importada duas vezes vira
 * uma entrada ou duas. O selo é descartado; o convidado, também.
 *
 * O que NÃO some da chave: nada que distinga a gravação. "Ao Vivo" e "Acústico"
 * SOMEM (são rótulo de canal — a duração é que separa gravação de gravação, ver
 * `duplicatas.ts`), mas "Remix" FICA, porque remix é outra faixa.
 */
export function chaveDeIdentidade(titulo: string, artista?: string | null): string {
  const t = chave(limpar(titulo ?? ''));
  const nomes = artista ? separarNomes(artista).filter((n) => !ehGravadora(n)) : [];
  // O `?? artista` é a rede: nome de uma letra só ou impronunciável pelo
  // separador não pode virar chave vazia e colidir com todo mundo.
  const a = nomes.length > 0 ? chave(nomes[0]!) : chave(artista ?? '');
  return a ? `${a}::${t}` : t;
}
