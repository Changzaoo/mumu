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
import { ehGravadora } from './gravadoraComoArtista.js';

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

/** `(qualquer coisa com ruído dentro)` ou `[idem]`. */
const PARENTESE_RUIDOSO = new RegExp(
  String.raw`[([\uFF08][^)\]\uFF09]*\b(?:${RUIDO_PALAVRAS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\b[^)\]\uFF09]*[)\]\uFF09]`,
  'gi',
);

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

/** Remove o ruído de um pedaço de texto, preservando acentos e caixa. */
function limpar(texto: string): string {
  return (
    texto
      // A descrição vem PRIMEIRO: ela leva o separador junto, e sem separador a
      // divisão "Artista - Música" nem chega a acontecer no lado errado.
      .replace(DESCRICAO_DO_CANAL, ' ')
      .replace(PARENTESE_RUIDOSO, ' ')
      // Ruído solto, sem parênteses, no fim da frase.
      .replace(
        new RegExp(String.raw`\s+[-–—]?\s*\b(?:${RUIDO_PALAVRAS.join('|')})\b\s*$`, 'i'),
        ' ',
      )
      // Resolução de vídeo colada ("640x360"), marca registrada, hashtags.
      .replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/g, ' ')
      .replace(/[®™©]/g, ' ')
      .replace(/#\w+/g, ' ')
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
      // Sobras de pontuação e espaço.
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—,;|]+|[\s\-–—,;|]+$/g, '')
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
  return texto
    .split(/\s*(?:,|&|\+|\bfeat\.?\b|\bft\.?\b|\bcom\b|\be\b|\band\b|\bx\b|\/)\s*/i)
    .map((n) => limparNomeDeArtista(n))
    .filter((n) => n.length > 1 && n.length < 60);
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
  return nome
    .trim()
    .replace(/\s*[-–—|]?\s*\b(?:oficial|official|vevo|topic|ao vivo)\b\s*$/i, '')
    .replace(/\s*[-–—|,]\s*$/, '')
    .trim();
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
export function separarArtistasGrudados(nomes: readonly string[]): string[] | null {
  if (nomes.length !== 1) return null; // já vieram separados
  const unico = nomes[0]?.trim();
  if (!unico) return null;
  const partes = separarNomes(unico);
  // "Simon & Garfunkel", "Tyler, The Creator" e "AC/DC" são UM artista com
  // separador no nome. Não há como distinguir pelo texto, então o critério é
  // conservador: só separa quando alguma das partes é reconhecidamente um selo.
  // Fora esse caso, o nome fica inteiro — quebrar uma dupla real é pior.
  if (partes.length < 2 || !partes.some((p) => ehGravadora(p))) return null;
  return partes;
}

/**
 * O TRECHO ENTRE ASPAS É A MÚSICA.
 *
 * Nos canais de funk e de gospel a fórmula é constante: os cantores vêm soltos e
 * o nome da faixa vem entre aspas — `MC Ryan SP, MC Kako - "Liberdade" (DJ...)`.
 * Era exatamente esse formato que entrava trocado, com a lista de cantores no
 * campo do título e a música no campo do artista.
 */
function trechoEntreAspas(texto: string): string | null {
  const m = /["“”'']([^"“”'']{2,60})["“”'']/.exec(texto);
  return m?.[1]?.trim() ?? null;
}

/**
 * Separa o nome de um vídeo em música, artistas e selo.
 *
 * `canal` é o nome do canal que publicou — usado só como último recurso para o
 * artista, e descartado quando é gravadora ou agregador.
 */
export function lerTituloDeVideo(bruto: string, canal?: string | null): PartesDoVideo {
  const limpo = limpar(bruto ?? '');
  const label = canal && ehGravadora(canal) ? canal.trim() : null;

  // 1) Aspas mandam: o que está dentro é a música, o que está fora são nomes.
  const citado = trechoEntreAspas(limpo);
  if (citado) {
    const fora = limpo.replace(/["“”''][^"“”'']*["“”'']/g, ' ');
    const artistas = separarNomes(limpar(fora)).filter((n) => !ehGravadora(n));
    return { title: limpar(citado), artists: artistas, label };
  }

  // 2) O separador clássico "Artista - Música".
  const partes = limpo
    .split(SEPARADOR)
    .map((p) => limpar(p))
    .filter(Boolean);
  if (partes.length >= 2) {
    const [esquerda, ...resto] = partes;
    const direita = resto.join(' - ');
    const artistas = separarNomes(esquerda!).filter((n) => !ehGravadora(n));
    // Lado esquerdo era só o selo ("MK MUSIC - Raridade"): o artista some, mas
    // o título fica certo — melhor do que gravar o selo como quem canta.
    return {
      title: direita,
      artists: artistas,
      label: label ?? (artistas.length === 0 ? esquerda! : null),
    };
  }

  // 3) Sem separador nem aspas: o nome inteiro é a música. O canal vira artista
  //    SÓ quando não é gravadora nem agregador — canal de terceiro no lugar do
  //    cantor é o erro que este módulo existe para não repetir.
  const doCanal = canal?.trim();
  const artistas = doCanal && !ehGravadora(doCanal) ? [doCanal] : [];
  return { title: limpo, artists: artistas, label };
}

/**
 * A CHAVE DE IDENTIDADE de uma faixa — é ela que faz duas cópias se
 * reconhecerem.
 *
 * Junta artista e música já normalizados e sem ruído. "BENÇA" e
 * "BENÇA (Official Video)" produzem a mesma chave; "Raridade" do Anderson
 * Freire e "Raridade" de outro cantor, não.
 */
export function chaveDeIdentidade(titulo: string, artista?: string | null): string {
  const t = chave(limpar(titulo ?? ''));
  const a = artista ? chave(artista) : '';
  return a ? `${a}::${t}` : t;
}
