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
];

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
      // Número de faixa no começo ("05 ", "12 - ").
      .replace(/^\s*\d{1,2}\s*[-.]?\s+/, '')
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
function separarNomes(texto: string): string[] {
  return texto
    .split(/\s*(?:,|&|\+|\bfeat\.?\b|\bft\.?\b|\bcom\b|\be\b|\band\b|\bx\b|\/)\s*/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 1 && n.length < 60);
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
