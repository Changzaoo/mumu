/**
 * AI helpers (NVIDIA, via the importer's server-side proxy — the key never
 * reaches the browser). Reuse `aiChat` for any future AI feature.
 */
import { aiChat, type AiMessage } from '@/lib/local/importerHelper';

export { aiChat };
export type { AiMessage };

/**
 * Modelo por CASO DE USO (NVIDIA NIM, endpoints gratuitos).
 *
 * Antes tudo caía no default do servidor (llama-3.1-8b) — barato, mas fraco em
 * conhecimento de mundo. Identificar de quem é uma música, separar "Tyler, The
 * Creator" de "Beyoncé, Jay-Z" ou auditar uma atribuição são tarefas de
 * CONHECIMENTO, não de formatação: com 8B elas erram e a metadata da
 * biblioteca inteira herda o erro. Já classificar num rótulo fixo e limpar um
 * título de YouTube são tarefas mecânicas, onde o 8B acerta e é ~10× mais
 * barato — e rodam em lote sobre a biblioteca toda.
 */
export const AI_MODELS = {
  /** Conhecimento musical + JSON estrito. A autoridade sobre "de quem é". */
  identity: 'meta/llama-3.3-70b-instruct',
  /** Nomes de grupos com vírgula/& são conhecimento de mundo, não regex. */
  splitArtists: 'meta/llama-3.3-70b-instruct',
  /** Auditoria de atribuição: saída de 1 palavra, decisão de conhecimento. */
  verify: 'meta/llama-3.3-70b-instruct',
  /** Rótulo de uma lista fixa, em lote na biblioteca → o menor que resolve. */
  genre: 'meta/llama-3.1-8b-instruct',
  /** Extração de string, sem conhecimento de mundo → o menor que resolve. */
  cleanTitle: 'meta/llama-3.1-8b-instruct',
} as const;

/**
 * Extract a clean {artist, title} from a messy YouTube-style title, to improve
 * lyric + cover lookups. Returns null when the AI is unavailable or unsure.
 */
export async function aiCleanSongTitle(
  raw: string,
  artistHint?: string,
): Promise<{ artist?: string; title: string } | null> {
  const content = await aiChat(
    [
      {
        role: 'system',
        content:
          'Você extrai o artista e o título de uma música a partir de um texto (nome de vídeo do YouTube). ' +
          'Responda SOMENTE com JSON {"artist":"...","title":"..."} — sem markdown, sem explicações. ' +
          'Se não houver artista claro, deixe "artist" vazio.',
      },
      {
        role: 'user',
        content: `Texto: "${raw}"${artistHint ? `\nDica de artista: ${artistHint}` : ''}`,
      },
    ],
    { model: AI_MODELS.cleanTitle, maxTokens: 120, temperature: 0 },
  );
  if (!content) return null;
  try {
    const json = JSON.parse(content.replace(/```json|```/gi, '').trim()) as {
      artist?: unknown;
      title?: unknown;
    };
    if (json && typeof json.title === 'string' && json.title.trim()) {
      return {
        title: json.title.trim(),
        artist:
          typeof json.artist === 'string' && json.artist.trim() ? json.artist.trim() : undefined,
      };
    }
  } catch {
    /* model didn't return clean JSON */
  }
  return null;
}

/** Fixed genre taxonomy the AI must classify into (pt-BR labels). */
export const GENRE_TAXONOMY = [
  'Pop',
  'Hip-Hop/Rap',
  'Trap',
  'Funk',
  'Sertanejo',
  'MPB',
  'Pagode',
  'Forró',
  'Gospel',
  'Rock',
  'R&B/Soul',
  'Eletrônica',
  'Dance',
  'Reggae',
  'Reggaeton',
  'Country',
  'Jazz',
  'Blues',
  'Clássica',
  'Metal',
  'Indie',
  'Lo-Fi',
  'Latina',
] as const;

/**
 * Classify a track into ONE genre from GENRE_TAXONOMY using the AI. Used to
 * categorize imported tracks the catalog couldn't tag. Returns null if unsure.
 */
export async function aiClassifyGenre(title: string, artist?: string): Promise<string | null> {
  const content = await aiChat(
    [
      {
        role: 'system',
        content:
          'Você classifica uma música em UM gênero musical desta lista EXATA: ' +
          `${GENRE_TAXONOMY.join(', ')}. ` +
          'Responda SOMENTE com o nome do gênero, exatamente como está na lista — sem texto extra.',
      },
      { role: 'user', content: `Música: "${title}"${artist ? ` — Artista: ${artist}` : ''}` },
    ],
    { model: AI_MODELS.genre, maxTokens: 12, temperature: 0 },
  );
  if (!content) return null;
  const answer = content.trim().replace(/["'.]/g, '').toLowerCase();
  return GENRE_TAXONOMY.find((g) => g.toLowerCase() === answer) ?? null;
}

/**
 * Periodic AUDITOR: ask the AI whether a track's attribution matches reality.
 * The AI never decides the artist (iTunes does) — it only flags a likely
 * mismatch so we can re-check. Returns true (SIM), false (clearly NÃO), or null
 * (uncertain / unavailable — treat as "leave it alone").
 */
export async function aiVerifyArtist(title: string, artist: string): Promise<boolean | null> {
  const content = await aiChat(
    [
      {
        role: 'system',
        content:
          'Você confere se a atribuição de uma música está correta na vida real. ' +
          'Responda com UMA palavra apenas: SIM (a música é realmente desse(s) artista(s)), ' +
          'NAO (claramente NÃO é), ou INCERTO (sem certeza). Sem nada além da palavra.',
      },
      { role: 'user', content: `A música "${title}" é de "${artist}"?` },
    ],
    { model: AI_MODELS.verify, maxTokens: 5, temperature: 0 },
  );
  if (!content) return null;
  const a = content.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (a.startsWith('sim')) return true;
  if (a.startsWith('nao')) return false;
  return null;
}

export interface AiTrackIdentity {
  title: string;
  /** All distinct artists (primary first, then features) — never merged. */
  artists: string[];
  album: string | null;
  genre: string | null;
}

/**
 * The metadata "identity agent" (NVIDIA LLM via the importer proxy). Given a
 * possibly-messy title and the current (maybe wrong) artist, it identifies the
 * REAL song: canonical title, EVERY distinct creator in order, album and genre.
 * This is the authority for who a song belongs to; the caller then confirms the
 * cover (iTunes) and lyrics (LRCLIB) against this result. Returns null if unsure.
 */
export async function aiIdentifyTrack(
  rawTitle: string,
  currentArtist?: string,
): Promise<AiTrackIdentity | null> {
  const content = await aiChat(
    [
      {
        role: 'system',
        content:
          'Você é um especialista em identificar músicas com precisão. Dado um título (às vezes ' +
          'bagunçado, de vídeo do YouTube) e possivelmente um artista (que pode estar errado), ' +
          'identifique a MÚSICA REAL e responda SOMENTE com JSON: ' +
          '{"title":"...","artists":["principal","participação",...],"album":null,"genre":null}. ' +
          'REGRAS OBRIGATÓRIAS: (1) liste TODOS os artistas distintos como itens SEPARADOS do array, ' +
          'na ordem correta (principal primeiro, depois feats/participações); NUNCA junte dois ' +
          'artistas num nome só. (2) Mantenha grupos/duplas reais como UM item ("AC/DC", ' +
          '"Tyler, The Creator", "Simon & Garfunkel"). (3) "title" limpo, sem "(Official Video)" etc. ' +
          `(4) "genre" deve ser um destes ou null: ${GENRE_TAXONOMY.join(', ')}. ` +
          '(5) Se não tiver certeza do álbum ou gênero, use null. Sem markdown, sem texto extra.',
      },
      {
        role: 'user',
        content: `Título: "${rawTitle}"${currentArtist ? `\nArtista atual (pode estar errado): ${currentArtist}` : ''}`,
      },
    ],
    { model: AI_MODELS.identity, maxTokens: 220, temperature: 0 },
  );
  if (!content) return null;
  try {
    const json = JSON.parse(content.replace(/```json|```/gi, '').trim()) as {
      title?: unknown;
      artists?: unknown;
      album?: unknown;
      genre?: unknown;
    };
    const title = typeof json.title === 'string' ? json.title.trim() : '';
    if (!title) return null;
    const artists = Array.isArray(json.artists)
      ? json.artists
          .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
          .map((a) => a.trim())
      : [];
    const album = typeof json.album === 'string' && json.album.trim() ? json.album.trim() : null;
    const genreRaw = typeof json.genre === 'string' ? json.genre.trim().toLowerCase() : '';
    const genre = GENRE_TAXONOMY.find((g) => g.toLowerCase() === genreRaw) ?? null;
    return { title, artists, album, genre };
  } catch {
    return null;
  }
}

/**
 * Split a combined artist credit into DISTINCT artists using the AI — for the
 * ambiguous cases a heuristic can't safely resolve (a comma or "/" may separate
 * two artists OR be part of one act's name, e.g. "Tyler, The Creator" vs
 * "Beyoncé, Jay-Z"). Returns the ordered list of names, or null if unavailable.
 */
export async function aiSplitArtists(credit: string, title?: string): Promise<string[] | null> {
  const content = await aiChat(
    [
      {
        role: 'system',
        content:
          'Você separa os artistas de uma música. Dado o crédito de artista (e o título), ' +
          'responda SOMENTE com um array JSON dos nomes DISTINTOS de artistas, ex: ["A","B"]. ' +
          'MANTENHA como UM só os nomes de grupos/duplas que legitimamente contêm vírgula, "&", "/" ' +
          'ou "the" (ex.: "Tyler, The Creator", "AC/DC", "Earth, Wind & Fire", "Simon & Garfunkel"). ' +
          'SEPARE colaborações reais (feat., &, x, vírgula entre artistas diferentes). ' +
          'Sem markdown, sem texto extra — apenas o array JSON.',
      },
      { role: 'user', content: `Crédito: "${credit}"${title ? `\nTítulo: ${title}` : ''}` },
    ],
    { model: AI_MODELS.splitArtists, maxTokens: 100, temperature: 0 },
  );
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content.replace(/```json|```/gi, '').trim());
    if (Array.isArray(parsed)) {
      const names = parsed
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim());
      if (names.length > 0) return names;
    }
  } catch {
    /* not clean JSON */
  }
  return null;
}
