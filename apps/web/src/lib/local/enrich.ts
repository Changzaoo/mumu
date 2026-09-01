/**
 * Metadata / cover-art enrichment for local tracks.
 *
 * LEGAL: this only fetches **metadata** (corrected title/artist/album) and
 * **cover art** from Apple's public iTunes API — it never touches audio. The
 * user's own audio bytes stay exactly as imported; we merely decorate the
 * registry entry so a bare "01 - faixa.mp3" gains a real name and 600×600 cover,
 * Spotify-style. Every function degrades silently to `null` on no-match/failure
 * so enrichment can never block or break an import.
 */
import { appleArtwork, searchSongs, type AppleSong } from '@/lib/catalog/itunes';
import { aiIdentifyTrack, aiSplitArtists } from '@/lib/ai/ai';
import { creditIsAmbiguous, splitArtistNames } from '@/lib/local/artists';
// O catálogo devolve PRATELEIRA, não gênero: "Brasileira" cobre sertanejo, trap,
// gospel e funk ao mesmo tempo. Gravar isso cru criava a prateleira inútil E
// trancava a faixa fora do agente de categorias. Ver shared/ai/generos.ts.
import { normalizarGenero } from '@radinho/shared';

export interface CleanQuery {
  title: string;
  artist?: string;
}

export interface EnrichedMeta {
  title: string;
  artist: string;
  /** The credit split into distinct artists (never merged into one). */
  artists: string[];
  album: string | null;
  coverUrl: string | null;
  genre: string | null;
  /** Quem ESCREVEU a música, quando o catálogo informa (não é o intérprete). */
  composer: string | null;
}

/** Compositor do catálogo — string vazia é "não informado", não um nome. */
const composerOf = (song: AppleSong): string | null => song.composerName?.trim() || null;

/**
 * Resolve a combined artist credit into distinct names: heuristic first, then —
 * only for ambiguous credits (comma/slash that might be part of a name) — the
 * AI arbitrates. Guarantees a two-artist song is never attributed to one.
 */
async function resolveArtists(credit: string, title: string): Promise<string[]> {
  const heuristic = splitArtistNames(credit);
  if (creditIsAmbiguous(credit)) {
    const ai = await aiSplitArtists(credit, title);
    if (ai && ai.length > 0) return ai;
  }
  return heuristic;
}

/** Junk fragments that filenames/streaming titles carry but iTunes does not. */
const NOISE = [
  /\[[^\]]*\]/g, // any [bracketed] segment — almost always noise on YouTube titles
  /\((?:official\s+)?(?:music\s+)?video\)/gi,
  /\((?:official\s+)?audio\)/gi,
  /\((?:official\s+)?lyric(?:s)?(?:\s+video)?\)/gi,
  /\(visualizer\)/gi,
  /\((?:hd|hq|4k|8k|full\s*hd|remaster(?:ed)?(?:\s*\d{2,4})?)\)/gi,
  /\((?:clipe(?:\s+oficial)?|v[ií]deo\s*clipe|ao\s+vivo|live|letra(?:\s+e\s+tradu[cç][aã]o)?|legendado|tradu[cç][aã]o|sped\s*up|slowed(?:\s*\+?\s*reverb)?)\)/gi,
  /\((?:feat\.?|ft\.?|prod\.?(?:\s+by)?|with)[^)]*\)/gi, // (feat X) hurts exact match
  /\b(?:official\s+(?:music\s+)?video|lyric\s+video|v[ií]deo\s+oficial|clipe\s+oficial|audio\s+oficial)\b/gi,
  /\s*[|·•]\s*.*$/, // trailing " | channel", " • ..."
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, // emojis/symbols
];

/** Upgrade Apple's 100×100 artwork URL to a 600×600 hi-res cover. */
const hiRes = (url: string): string => appleArtwork(url, 'grid');

/** Loose normalization for comparison: lowercase, strip accents + punctuation. */
const DIACRITICS = new RegExp('\\p{M}+', 'gu');
function norm(value: string): string {
  // `[^a-z0-9]` apagava toda escrita não-latina, e esta é a TERCEIRA cópia do
  // mesmo engano no app (as outras duas estavam em `lyrics.ts` e no `normName`
  // da biblioteca). Aqui o estrago era comparar título/artista coreano contra o
  // catálogo: os dois lados viravam string vazia e casavam com qualquer coisa.
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Dois nomes se referem à mesma coisa? Comparação frouxa, mas com piso.
 *
 * O piso existe porque `includes` em pedaço curto aceita qualquer coisa: sem
 * ele, um canal chamado "AL" casaria com metade dos títulos do acervo e a
 * decisão de ordem abaixo viraria moeda.
 */
const MIN_PISTA = 3;
function mesmoNome(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < MIN_PISTA || b.length < MIN_PISTA) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Derive a clean search query from a filename (or a pasted title). Strips the
 * extension, leading track numbers ("01 - ", "01."), turns underscores into
 * spaces, removes "(Official Video)/(Audio)/(Lyrics)/[Official]" noise, and —
 * when the name looks like "Artist - Title" — splits artist + title.
 */
export function cleanQuery(filename: string, pista?: string | null): CleanQuery {
  let base = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
  base = base.replace(/_/g, ' ');
  // Leading track number: "01 - ", "01.", "1) ", "07_"
  base = base.replace(/^\s*\d{1,3}\s*[-.)\]]\s*/, '');
  for (const pattern of NOISE) base = base.replace(pattern, ' ');
  base = base.replace(/\s{2,}/g, ' ').trim();

  const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (split?.[1] && split[2]) {
    const esquerda = split[1].trim();
    const direita = split[2].trim();

    // DE QUE LADO DO HÍFEN ESTÁ O ARTISTA — a `pista` é quem sabe.
    //
    // Este código assumia SEMPRE "Artista - Título", e metade das postagens do
    // acervo é o contrário: "ÚLTIMA VEZ - Alee" saía com o artista no campo do
    // título e o nome da música no campo do artista. Era o defeito de "aparece
    // o nome do artista onde deveria ser o da música", e ele nasce aqui.
    //
    // Inverter a suposição não conserta — só troca quem é a vítima. O que
    // desempata é EVIDÊNCIA externa ao texto: o canal que publicou. Se o lado
    // DIREITO é o canal e o esquerdo não é, então o direito é o artista e a
    // ordem está invertida. Sem pista, ou com os dois lados casando (o canal
    // que leva o nome da música), fica a convenção antiga — que é a mais comum
    // e continua sendo o palpite certo na dúvida.
    const p = pista ? norm(pista) : '';
    if (p && mesmoNome(norm(direita), p) && !mesmoNome(norm(esquerda), p)) {
      return { artist: direita, title: esquerda };
    }
    return { artist: esquerda, title: direita };
  }
  return { title: base || filename };
}

/**
 * Nome de arquivo → {artist, title} para o import local. Reaproveita a limpeza
 * do `cleanQuery` (extensão, "01 - ", "(Official Video)") e só depois tenta
 * separar o crédito.
 *
 * `artist: null` quando não há como saber — antes devolvíamos "Desconhecido"
 * aqui, o que fazia o chamador tratar um NÃO-SABER como se fosse um crédito.
 * O hífen só separa artista quando tem espaço de algum lado: "Spider-Man Theme"
 * não é o artista "Spider" (a regra antiga fazia exatamente isso).
 */
export function parseTrackFileName(fileName: string): { title: string; artist: string | null } {
  const q = cleanQuery(fileName);
  if (q.artist) return { artist: q.artist, title: q.title };
  const split = /^(.+?)(?:\s+[-–—]\s*|\s*[-–—]\s+)(.+)$/.exec(q.title);
  if (split?.[1] && split[2]) return { artist: split[1].trim(), title: split[2].trim() };
  return { artist: null, title: q.title || fileName };
}

/**
 * Look up real metadata + hi-res cover for a track on iTunes. Picks the best
 * match (loosely comparing title, then artist). Returns the corrected
 * title/artist/album + 600×600 cover, or `null` on no match / any failure —
 * never throws.
 */
function scoreMatch(
  songTitle: string,
  songArtist: string,
  wantTitle: string,
  wantArtist: string,
): number {
  let score = 0;
  if (songTitle === wantTitle) score += 4;
  else if (songTitle.includes(wantTitle) || wantTitle.includes(songTitle)) score += 2;
  if (wantArtist) {
    if (songArtist === wantArtist) score += 3;
    else if (songArtist.includes(wantArtist) || wantArtist.includes(songArtist)) score += 1;
  }
  return score;
}

export async function enrichMeta(q: CleanQuery): Promise<EnrichedMeta | null> {
  const title = q.title.trim();
  if (!title) return null;

  // Title with any parentheticals stripped — a strong alternate query.
  const bareTitle = title
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Try several searches (most specific first) and keep the best match overall.
  const terms = Array.from(
    new Set(
      [
        q.artist ? `${title} ${q.artist}` : title,
        q.artist && bareTitle ? `${bareTitle} ${q.artist}` : null,
        title,
        bareTitle && bareTitle !== title ? bareTitle : null,
      ].filter((t): t is string => Boolean(t && t.trim().length > 1)),
    ),
  );

  const wantTitle = norm(title);
  const wantArtist = q.artist ? norm(q.artist) : '';
  let best: AppleSong | null = null;
  let bestScore = -1;

  for (const term of terms) {
    let results: AppleSong[];
    try {
      results = await searchSongs(term, 'br', 15);
    } catch {
      continue;
    }
    for (const song of results) {
      const score = scoreMatch(norm(song.trackName), norm(song.artistName), wantTitle, wantArtist);
      if (score > bestScore) {
        bestScore = score;
        best = song;
      }
    }
    if (bestScore >= 6) break; // confident exact-ish match — stop searching
  }

  // ACCURACY FIRST: only accept a match when BOTH the title AND the artist are
  // confirmed. Renaming a song to a DIFFERENT artist (e.g. Matuê → Jeff Costa)
  // must never happen — a same-title song by someone else is rejected.
  if (best && wantArtist) {
    const mt = norm(best.trackName);
    const ma = norm(best.artistName);
    const titleOk = mt === wantTitle || mt.includes(wantTitle) || wantTitle.includes(mt);
    const artistOk = ma === wantArtist || ma.includes(wantArtist) || wantArtist.includes(ma);
    if (titleOk && artistOk) {
      return {
        title: best.trackName,
        artist: best.artistName,
        artists: await resolveArtists(best.artistName, best.trackName),
        album: best.collectionName || null,
        coverUrl: best.artworkUrl100 ? hiRes(best.artworkUrl100) : null,
        genre: normalizarGenero(best.primaryGenreName),
        composer: composerOf(best),
      };
    }
  }

  // Couldn't confirm the artist → return null, PERIOD. Regra do JUIZ (metaTeam):
  // a IA nunca introduz um artista. O caminho antigo — pedir um palpite de
  // artista à IA só pelo título e "confirmar" o próprio palpite no iTunes —
  // era confirmação circular: foi ele que creditou "Warzone" (do Brandão85)
  // ao The Wanted, que tem uma música homônima no catálogo.
  return null;
}

// STRICT title match: normalized equality, or one is the other plus a short
// live/remaster-style suffix ("song" vs "song ao vivo"). Deliberately NOT a
// loose substring test — that let a different song by another artist "match".
/**
 * Tira o que vem entre parênteses/colchetes NO FIM do título.
 *
 * É o "(feat. Fulano & Beltrano)", o "[Remix]", o "(Ao Vivo)". Repetido porque
 * um título pode carregar dois: "Faixa (feat. X) [Remix]".
 */
/**
 * O que pode sobrar no fim de um título e AINDA ser a mesma música.
 *
 * Já normalizado (minúsculo, sem acento e sem pontuação). A lista é fechada de
 * propósito: qualquer outra sobra é tratada como outra faixa.
 */
const MARCADOR_DE_VERSAO =
  /^(ao vivo|live|acustic[oa]|acoustic|unplugged|remaster(ed)?|remix|vers[aã]o|version|radio edit|edit|extended|deluxe|bonus|instrumental|playback|sped up|slowed( reverb)?|reverb|karaoke|demo|mono|stereo|explicit|clean|single|ep|album)( .*)?$|^\d{4}$/;

const semSufixo = (valor: string): string => {
  let atual = valor.trim();
  for (let i = 0; i < 3; i += 1) {
    const cortado = atual.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/, '').trim();
    if (cortado === atual || !cortado) break;
    atual = cortado;
  }
  return atual;
};

/**
 * O mesmo título, mesmo escrito de outro jeito?
 *
 * ESTE ERA O DEFEITO DO ÁLBUM QUE APARECIA PELA METADE.
 *
 * O app já limpava os parênteses do NOSSO título antes de comparar, mas não do
 * que o iTunes devolve — e a assimetria condenava exatamente as faixas com
 * participação. Medido nas faixas do XTRANHO, do Matuê:
 *
 *   "OS MELHORES"                                → sobra  0 → casava
 *   "PENSAMENTOS PERIGOSOS (feat. LPT Zlatan)"   → sobra 16 → casava
 *   "FACAS E MACHADOS (feat. FAB GODAMN & Okie)" → sobra 21 → RECUSAVA
 *   "ÍCONE FASHION (feat. Kouth & Pabllo Vittar)"→ sobra 25 → RECUSAVA
 *
 * A tolerância de 18 caracteres foi calibrada para sufixo curto ("ao vivo",
 * "remaster"); um "(feat. A & B)" de rap passa longe dela. E recusar não
 * significava só perder o álbum: sem confirmação do catálogo a faixa fica sem
 * capa, sem álbum E sem gênero — e aí o classificador chuta no escuro. É por
 * isso que "FACAS E MACHADOS", um trap do Matuê, foi parar em Sertanejo.
 *
 * O conserto é a simetria: limpa dos DOIS lados e exige igualdade. Continua sem
 * ser teste frouxo de substring — "Faixa" não casa com "Faixa Dois" —, e o que
 * se abre é o caso legítimo de a mesma música vir com a lista de convidados no
 * nome. O preço: uma versão "(Ao Vivo)" pode adotar a ficha do estúdio. Trocar
 * "sem capa, sem álbum e com gênero chutado" por "capa e gênero certos, versão
 * do estúdio" é um bom negócio.
 */
export const titleExact = (a: string, b: string): boolean => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const sa = norm(semSufixo(a));
  const sb = norm(semSufixo(b));
  if (sa && sb && sa === sb) return true;

  // Sufixo SOLTO, sem parênteses ("Faixa Ao Vivo"). Aqui a régua antiga era
  // "cabe em 18 caracteres", e contar caracteres não distingue versão de OUTRA
  // MÚSICA: "Faixa Dois" casava com "Faixa" (12 de sobra) e "Warzone
  // Freestyle" com "Warzone" (9). Cada casamento desses dá à faixa o álbum, a
  // capa e o gênero de uma música que não é ela.
  //
  // Agora o que sobra precisa SER um marcador de versão. Marcador desconhecido
  // é recusa — e recusar deixa a faixa como está, que é o lado seguro do erro.
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (!long.startsWith(`${short} `)) return false;
  return MARCADOR_DE_VERSAO.test(long.slice(short.length + 1));
};

// Confirm an artist: normalized equality, or one is a WORD-prefix of the other
// ("charlie brown" ⊂ "charlie brown jr"). NOT a loose substring test — that let
// "MC Kevin" confirm as "MC Kevin o Chris" (a different artist).
const artistClose = (name: string, wantNorm: string): boolean => {
  if (!wantNorm) return false;
  const n = norm(name);
  if (!n) return false;
  if (n === wantNorm) return true;
  const [short, long] = n.length <= wantNorm.length ? [n, wantNorm] : [wantNorm, n];
  return long.startsWith(`${short} `);
};

/**
 * MINUTELY verify a track's real identity against iTunes and return AUTHORITATIVE
 * metadata — the artist and genre come from iTunes, never from a guess. Returns
 * null when iTunes can't confidently confirm an artist (title has no match, or
 * many different artists share the title so it's ambiguous). Callers must then
 * LEAVE the track un-reattributed rather than crediting the wrong artist/genre.
 */
export async function verifyIdentity(
  title: string,
  artistHint?: string,
): Promise<EnrichedMeta | null> {
  const t = title.trim();
  if (!t) return null;
  const bare = t
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Gather candidates from a few queries (most specific first).
  const byId = new Map<number, AppleSong>();
  const terms = Array.from(
    new Set([artistHint ? `${t} ${artistHint}` : t, t, bare].filter((s) => s.length > 1)),
  );
  for (const term of terms) {
    try {
      for (const s of await searchSongs(term, 'br', 20)) byId.set(s.trackId, s);
    } catch {
      /* skip this query */
    }
  }
  const titleMatches = [...byId.values()].filter(
    (s) => titleExact(s.trackName, t) || titleExact(s.trackName, bare),
  );
  if (titleMatches.length === 0) return null;

  // Attribute ONLY when the artist hint (from the filename / YouTube metadata)
  // is CONFIRMED by an exact-title iTunes match. No hint, or no confirmation →
  // return null; the caller then keeps the current artist rather than guessing.
  // (The old "dominant artist by title" fallback credited random artists to
  //  common titles — that's what produced the stupidly-wrong names.)
  const hintNorm = artistHint ? norm(artistHint) : '';
  if (!hintNorm) return null;
  const chosen = titleMatches.find((s) => artistClose(s.artistName, hintNorm));
  if (!chosen) return null;

  return {
    title: chosen.trackName,
    artist: chosen.artistName,
    artists: await resolveArtists(chosen.artistName, chosen.trackName),
    album: chosen.collectionName || null,
    coverUrl: chosen.artworkUrl100 ? hiRes(chosen.artworkUrl100) : null,
    genre: normalizarGenero(chosen.primaryGenreName),
    composer: composerOf(chosen),
  };
}

/**
 * Identifica uma faixa SÓ pelo título, para o arquivo solto que não trouxe
 * nenhuma pista de artista (nem na tag embutida, nem no nome).
 *
 * Isto é deliberadamente uma EXCEÇÃO à regra do JUIZ ("sem palpite, não
 * procura"). A regra existe para impedir que um crédito EXISTENTE seja trocado
 * por outro alucinado; aqui não há crédito nenhum a proteger — a alternativa é
 * a faixa ficar "Desconhecido" para sempre, sem capa, álbum nem letra. Ainda
 * assim, um artista ERRADO é pior que "Desconhecido", então só adotamos com
 * prova forte:
 *
 *   1. o título tem que ser IGUAL (normalizado) — nem substring, nem sufixo; e
 *   2. todos os resultados com esse título têm que ser do MESMO artista —
 *      título disputado é ambiguidade, e ambiguidade não vira crédito; ou
 *   3. havendo disputa, a IA (aiIdentifyTrack) dá um segundo parecer e só
 *      vale se apontar um artista QUE JÁ ESTÁ entre os candidatos do iTunes.
 *      A IA nunca introduz um nome sozinha — ela só desempata.
 */
export async function identifyByTitle(title: string): Promise<EnrichedMeta | null> {
  const t = title.trim();
  // Título curto/genérico ("faixa", "01", "audio") não identifica nada.
  if (norm(t).replace(/\s+/g, '').length < 4) return null;
  const bare = t
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const byId = new Map<number, AppleSong>();
  for (const term of new Set([t, bare].filter((s) => s.length > 1))) {
    try {
      for (const s of await searchSongs(term, 'br', 25)) byId.set(s.trackId, s);
    } catch {
      /* rede fora / catálogo instável — segue com o que já veio */
    }
  }
  // Aqui a régua é ainda mais dura que a do `titleExact`: IGUALDADE normalizada.
  // O `titleExact` tolera um sufixo curto ("ao vivo", "remaster") porque lá o
  // artista JÁ foi confirmado por outra via; sem artista nenhum, "Tempo" e
  // "Tempo Perdido" são músicas diferentes e ponto.
  const alvo = norm(t);
  const alvoBare = norm(bare);
  const matches = [...byId.values()].filter((s) => {
    const n = norm(s.trackName);
    return n === alvo || n === alvoBare;
  });
  if (matches.length === 0) return null;

  // Um artista por candidato, deduplicado — é a contagem que diz se há disputa.
  const porArtista = new Map<string, AppleSong>();
  for (const s of matches) {
    const key = norm(s.artistName);
    if (key && !porArtista.has(key)) porArtista.set(key, s);
  }

  let chosen: AppleSong | null =
    porArtista.size === 1 ? (porArtista.values().next().value ?? null) : null;

  if (!chosen) {
    const ai = await aiIdentifyTrack(t).catch(() => null);
    const palpite = ai?.artists[0] ? norm(ai.artists[0]) : '';
    if (palpite) chosen = matches.find((s) => artistClose(s.artistName, palpite)) ?? null;
  }
  if (!chosen) return null;

  return {
    title: chosen.trackName,
    artist: chosen.artistName,
    artists: await resolveArtists(chosen.artistName, chosen.trackName),
    album: chosen.collectionName || null,
    coverUrl: chosen.artworkUrl100 ? hiRes(chosen.artworkUrl100) : null,
    genre: normalizarGenero(chosen.primaryGenreName),
    composer: composerOf(chosen),
  };
}
