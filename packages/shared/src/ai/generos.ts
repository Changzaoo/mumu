/**
 * DE ONDE VEM O GÊNERO ERRADO DAS MÚSICAS BRASILEIRAS.
 *
 * O relato foi específico: funk, trap, gospel e sertanejo se embaralhando, e
 * trap indo parar em Lo-Fi e em Sertanejo. São dois defeitos diferentes com o
 * mesmo sintoma, e este arquivo trata o primeiro — o mais silencioso dos dois.
 *
 * 1. O CATÁLOGO DA APPLE NÃO RESPONDE "GÊNERO", RESPONDE "PRATELEIRA".
 *
 *    `primaryGenreName` da loja brasileira devolve, para boa parte do que é
 *    nacional, o rótulo "Brasileira" (o "Brazilian" da Apple). Isso é
 *    NACIONALIDADE, não gênero: cabe sertanejo, trap, gospel, funk e MPB no
 *    mesmo balde. O app gravava esse rótulo CRU na faixa — daí a prateleira
 *    "Brasileira" com 27 músicas que não têm nada a ver umas com as outras.
 *
 *    E o estrago não parava aí: com `track.genre` preenchido, o agente de
 *    categorias PULA a faixa para sempre (ele só procura quem está sem gênero).
 *    Uma faixa marcada como "Brasileira" nunca mais seria classificada de
 *    verdade. O balde não era só inútil: ele trancava a porta.
 *
 * 2. Rótulos que existem e o app não conhecia. A Apple devolve "Sertanejo",
 *    "Pagode", "Forró", "Axé", "Samba", "Funk brasileiro", "Cristã e Gospel" —
 *    cada um escrito de um jeito, às vezes em inglês, às vezes com acento. Sem
 *    tradução, um rótulo perfeitamente correto virava uma categoria estranha na
 *    interface, ou nenhuma.
 *
 * A regra aqui é a mesma do resto do app: rótulo que não dá para traduzir com
 * segurança vira `null`, e a faixa segue sem categoria — visível, e na fila de
 * quem pode classificar com evidência. Nunca um chute.
 *
 * Vive em `shared` porque os dois lados classificam: o navegador e o worker de
 * curadoria do servidor. Duas cópias divergiriam, e faixa classificada de forma
 * diferente conforme quem a processou é o defeito que estamos consertando.
 */
import { GENRE_TAXONOMY, type Genre } from './curation.js';

/** Compara rótulos ignorando acento, caixa e pontuação. */
function chave(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * BALDES QUE NÃO SÃO GÊNERO.
 *
 * Rótulo de nacionalidade ou de guarda-chuva. Não descrevem como a música soa,
 * então não podem virar categoria — e o pior é que, gravados, eles impedem a
 * faixa de receber a categoria de verdade.
 */
const BALDES_SEM_INFORMACAO = new Set(
  [
    'brasileira',
    'brasileiro',
    'brazilian',
    'musicabrasileira',
    'mpbbrasileira',
    'mundial',
    'worldwide',
    'world',
    'worldmusic',
    'musicamundial',
    'internacional',
    'international',
    'variados',
    'various',
    'outros',
    'other',
    'diversos',
    'trilhasonora',
    'soundtrack',
    'infantil',
    'childrensmusic',
    'musicainfantil',
    'holiday',
    'natal',
    'spokenword',
    'vocal',
    'easylistening',
  ].map(chave),
);

/**
 * TRADUÇÃO DOS RÓTULOS REAIS DO CATÁLOGO.
 *
 * Cada linha aqui é um rótulo que a Apple (ou outra fonte) devolve de verdade,
 * apontando para a nossa taxonomia. Escrito à mão de propósito: adivinhar por
 * semelhança de texto é como "Funk" americano viraria funk carioca e vice-versa.
 */
const TRADUCAO: ReadonlyArray<readonly [string, Genre]> = [
  // ── Brasil ────────────────────────────────────────────────────────────────
  ['sertanejo', 'Sertanejo'],
  ['sertaneja', 'Sertanejo'],
  ['sertanejouniversitario', 'Sertanejo'],
  ['musicasertaneja', 'Sertanejo'],
  ['mpb', 'MPB'],
  ['musicapopularbrasileira', 'MPB'],
  ['pagode', 'Pagode'],
  ['samba', 'Samba'],
  ['sambaepagode', 'Samba'],
  ['bossanova', 'MPB'],
  ['forro', 'Forró'],
  ['axe', 'Axé'],
  ['sofrencia', 'Sertanejo'],
  // "Funk" na loja brasileira é o funk carioca. O funk americano (James Brown)
  // a Apple entrega como "R&B/Soul", então não há colisão prática.
  ['funk', 'Funk'],
  ['funkbrasileiro', 'Funk'],
  ['funkcarioca', 'Funk'],
  ['bailefunk', 'Funk'],
  ['brazilianfunk', 'Funk'],
  ['funkostentacao', 'Funk'],
  ['brega', 'Forró'],
  ['piseiro', 'Forró'],
  ['arrocha', 'Sertanejo'],
  // ── Gospel ────────────────────────────────────────────────────────────────
  ['gospel', 'Gospel'],
  ['gospelecrista', 'Gospel'],
  ['cristaegospel', 'Gospel'],
  ['christiangospel', 'Gospel'],
  ['christian', 'Gospel'],
  ['religiosa', 'Gospel'],
  ['musicacrista', 'Gospel'],
  ['louvoreadoracao', 'Gospel'],
  ['worship', 'Gospel'],
  // ── Rap / trap ────────────────────────────────────────────────────────────
  ['hiphoprap', 'Hip-Hop/Rap'],
  ['hiphop', 'Hip-Hop/Rap'],
  ['rap', 'Hip-Hop/Rap'],
  ['raphiphop', 'Hip-Hop/Rap'],
  ['rapnacional', 'Hip-Hop/Rap'],
  ['trap', 'Trap'],
  ['trapbrasileiro', 'Trap'],
  ['drill', 'Trap'],
  // ── Resto do mundo ────────────────────────────────────────────────────────
  ['pop', 'Pop'],
  ['poprock', 'Pop'],
  ['teenpop', 'Pop'],
  ['rock', 'Rock'],
  ['rockalternativo', 'Rock'],
  ['punk', 'Rock'],
  ['hardrock', 'Rock'],
  ['metal', 'Metal'],
  ['heavymetal', 'Metal'],
  ['hardcore', 'Metal'],
  ['rbsoul', 'R&B/Soul'],
  ['rb', 'R&B/Soul'],
  ['soul', 'R&B/Soul'],
  ['eletronica', 'Eletrônica'],
  ['electronic', 'Eletrônica'],
  ['electronica', 'Eletrônica'],
  ['house', 'Eletrônica'],
  ['techno', 'Eletrônica'],
  ['dubstep', 'Eletrônica'],
  ['dance', 'Dance'],
  ['edm', 'Dance'],
  ['reggae', 'Reggae'],
  ['dancehall', 'Reggae'],
  ['reggaeton', 'Reggaeton'],
  ['regueton', 'Reggaeton'],
  ['urbanolatino', 'Reggaeton'],
  ['latinurban', 'Reggaeton'],
  ['country', 'Country'],
  ['jazz', 'Jazz'],
  ['blues', 'Blues'],
  ['classica', 'Clássica'],
  ['classical', 'Clássica'],
  ['erudita', 'Clássica'],
  ['opera', 'Clássica'],
  ['indie', 'Indie'],
  ['indierock', 'Indie'],
  ['indiepop', 'Indie'],
  ['alternativa', 'Indie'],
  ['alternative', 'Indie'],
  ['lofi', 'Lo-Fi'],
  ['lofihiphop', 'Lo-Fi'],
  ['chillhop', 'Lo-Fi'],
  ['latina', 'Latina'],
  ['latin', 'Latina'],
  ['musicalatina', 'Latina'],
  ['poplatino', 'Latina'],
  ['latinpop', 'Latina'],
  ['salsa', 'Latina'],
  ['cumbia', 'Latina'],
  // ── K-pop ─────────────────────────────────────────────────────────────────
  // `chave()` come hífen e espaço, então 'kpop' cobre "K-Pop", "K Pop" e "k-pop".
  ['kpop', 'K-Pop'],
  ['koreanpop', 'K-Pop'],
  ['popcoreano', 'K-Pop'],
  ['kpopcoreano', 'K-Pop'],
  // "Coreana" sozinha é NACIONALIDADE, e cairia no balde sem informação como
  // "Brasileira" — mas a Apple usa esse rótulo na prateleira de K-pop, e mandar
  // para o balde deixaria a faixa sem categoria nenhuma. Aqui a nacionalidade
  // aponta para uma cena só, então traduzir é seguro; em "Brasileira" não é.
  ['musicacoreana', 'K-Pop'],
];

const MAPA = new Map<string, Genre>(TRADUCAO.map(([k, v]) => [chave(k), v]));
// Todo rótulo da taxonomia se traduz para ele mesmo — inclusive escrito de
// outro jeito ("Hip Hop/Rap" = "Hip-Hop/Rap", "eletronica" = "Eletrônica").
for (const g of GENRE_TAXONOMY) MAPA.set(chave(g), g);

/** O rótulo é um balde de nacionalidade/guarda-chuva em vez de um gênero? */
export function ehBaldeSemInformacao(bruto: string | null | undefined): boolean {
  if (!bruto) return false;
  return BALDES_SEM_INFORMACAO.has(chave(bruto));
}

/**
 * Traduz um rótulo de gênero vindo de fora para a taxonomia do app.
 *
 * `null` quer dizer "não dá para afirmar" — e é uma resposta boa: a faixa fica
 * sem categoria, aparece como pendente e vai para a fila de quem classifica com
 * evidência. Muito melhor que a prateleira "Brasileira", que misturava tudo e
 * ainda escondia a faixa do agente de categorias.
 */
export function normalizarGenero(bruto: string | null | undefined): Genre | null {
  if (!bruto) return null;
  const k = chave(bruto);
  if (!k || BALDES_SEM_INFORMACAO.has(k)) return null;
  const direto = MAPA.get(k);
  if (direto) return direto;

  // Rótulo composto ("Sertanejo/Forró", "Christian & Gospel", "Hip-Hop/Rap"):
  // tenta cada pedaço, na ordem, e fica com o primeiro que traduzir. A ordem
  // importa — a Apple põe o gênero principal na frente.
  for (const pedaco of bruto.split(/[/,&|]|\se\s|\sand\s/i)) {
    const traduzido = MAPA.get(chave(pedaco));
    if (traduzido) return traduzido;
  }
  return null;
}
