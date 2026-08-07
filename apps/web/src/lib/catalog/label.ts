/**
 * Gravadora (selo) de uma faixa/artista.
 *
 * O iTunes não expõe um campo "label": o que existe é o `copyright` do álbum,
 * uma frase jurídica no formato "℗ 2019 Sony Music Entertainment". A gravadora
 * está lá dentro — só é preciso tirar o símbolo de fonograma e o ano. O código
 * jogava esse campo fora; aqui ele vira o dado que a ficha do artista mostra.
 */

/** Sufixos societários que só poluem o nome exibido ("Sony Music, LLC"). */
const SUFFIX = /[,\s]+(inc|llc|ltda?|ltd|s\.?a\.?|gmbh|b\.?v\.?|corp|co)\.?$/i;

/**
 * "X sob licença exclusiva de Y" — QUEM ASSINA NÃO É QUEM LANÇA.
 *
 * A distribuidora aparece primeiro na frase e o selo de verdade vem depois. Já
 * havia o corte em inglês; faltava o português, que é a forma de praticamente
 * todo lançamento brasileiro grande. O efeito era exatamente o tipo de erro que
 * não pode acontecer numa prateleira:
 *
 *   ℗ 2022 Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM
 *      antes → "Sony Music Entertainment Brasil ltda. sob licença exclusiva de 30PRAUM"
 *      agora → "30PRAUM"
 *
 * Medido na API real: em Matuê, Teto e WIU, 3 de 8 álbuns caíam nessa forma.
 */
const LICENCIADO =
  /(?:exclusive licen[cs]e to|licen[cs]ed to|distributed by|sob licen[çc]a (?:exclusiva )?d[eo]|com licen[çc]a (?:exclusiva )?d[eo]|distribu[íi]d[oa] por)\s+(.+)$/i;

/**
 * Descrição da ATIVIDADE grudada no nome da empresa — "30PRAUM Agenciamento e
 * Produção" é a razão social; a gravadora é "30PRAUM".
 *
 * A lista é curta e composta de propósito. Cortar "Produções" sozinho quebraria
 * "Hash Produções", que é o nome REAL do selo do Brandão85 nos primeiros discos.
 * Só sai o que ninguém usa como marca.
 */
const ATIVIDADE =
  /[,\s]+(agenciamento e produç(?:ão|ões)|agenciamento|edições musicais|produç(?:ão|ões) fonográfica)\.?$/i;

/**
 * Extrai o nome da gravadora de um `copyright` do iTunes. Devolve null quando
 * a frase não sobra nada útil (aviso genérico, string vazia) — melhor não
 * mostrar gravadora do que mostrar "2019".
 */
export function parseLabel(copyright: string | null | undefined): string | null {
  if (typeof copyright !== 'string') return null;
  // Reedição carrega DUAS notas na mesma linha ("℗ 1975 X Ltd./(P) 2011 X Ltd.").
  // Cada marca (℗/©/(P)/(C)) abre uma nota nova, então cortamos por elas e
  // ficamos com a primeira — o selo original, não o texto grudado das duas.
  let value = (copyright.split(/[℗©®]|\((?:p|c)\)/gi).find((part) => part.trim()) ?? '').trim();
  // Ano de lançamento no começo da frase: some (a data já vem em releaseYear).
  value = value.replace(/^(19|20)\d{2}\s*[-–—,]?\s*/, '').trim();
  // "Distributed by X" / "sob licença exclusiva de X" — o selo é quem vem depois.
  const licensed = LICENCIADO.exec(value);
  if (licensed?.[1]) value = licensed[1].trim();
  value = value
    // Pontuação de emenda no fim (inclusive a "/" que separava as duas notas).
    .replace(/[/.,;\s]+$/, '')
    .replace(SUFFIX, '')
    // A razão social sai DEPOIS do sufixo societário: "…Produção ltda." perde o
    // "ltda." primeiro, e só então "Agenciamento e Produção" fica no fim da linha.
    .replace(ATIVIDADE, '')
    .replace(/[/.,;\s]+$/, '')
    .trim();
  // Sobrou só pontuação/número → não é nome de gravadora.
  if (value.length < 2 || !/[a-zà-ú]/i.test(value)) return null;
  return value;
}

/**
 * A gravadora do ARTISTA: a mais frequente entre as faixas dele. Um artista
 * troca de selo ao longo da carreira e faixas soltas trazem o selo do
 * distribuidor, então a moda é mais honesta que "a da primeira faixa". Empate
 * é resolvido pela primeira que apareceu (ordem estável).
 */
export function dominantLabel(labels: Array<string | null | undefined>): string | null {
  const counts = new Map<string, { label: string; count: number; first: number }>();
  labels.forEach((raw, index) => {
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (!label) return;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { label, count: 1, first: index });
  });
  let best: { label: string; count: number; first: number } | null = null;
  for (const row of counts.values()) {
    if (!best || row.count > best.count || (row.count === best.count && row.first < best.first)) {
      best = row;
    }
  }
  return best?.label ?? null;
}
