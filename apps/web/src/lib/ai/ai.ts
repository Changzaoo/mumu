/**
 * AI helpers (NVIDIA, via the importer's server-side proxy — the key never
 * reaches the browser). Reuse `aiChat` for any future AI feature.
 *
 * Os prompts e os parsers vivem em `@radinho/shared` porque o worker de
 * curadoria do servidor roda os MESMOS agentes 24/7. Duas cópias divergiriam, e
 * a mesma faixa passaria a receber respostas diferentes conforme quem a
 * processou.
 */
import {
  AI_BUDGET,
  GENRE_TAXONOMY,
  genreMessages,
  identityMessages,
  parseGenre,
  parseIdentity,
  parseVerify,
  verifyMessages,
  type TrackIdentity,
} from '@radinho/shared';
import { aiChat, type AiMessage } from '@/lib/local/importerHelper';

export { aiChat, GENRE_TAXONOMY };
export type { AiMessage };

/**
 * Modelo dos agentes de metadata (NVIDIA NIM).
 *
 * Antes isto era dividido por tarefa: 70B para conhecimento (identificar de
 * quem é a música, separar "Tyler, The Creator" de "Beyoncé, Jay-Z") e 8B para
 * as mecânicas (limpar título, rotular gênero), que rodam em LOTE sobre a
 * biblioteca toda. Agora todos usam o Nemotron Ultra por decisão sua.
 *
 * O mapa continua por caso de uso de propósito: se o consumo do lote pesar, dá
 * para baixar só `genre` e `cleanTitle` sem tocar nas tarefas de conhecimento.
 */
const NEMOTRON_ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b';

export const AI_MODELS = {
  /** Conhecimento musical + JSON estrito. A autoridade sobre "de quem é". */
  identity: NEMOTRON_ULTRA,
  /** Nomes de grupos com vírgula/& são conhecimento de mundo, não regex. */
  splitArtists: NEMOTRON_ULTRA,
  /** Auditoria de atribuição: saída de 1 palavra, decisão de conhecimento. */
  verify: NEMOTRON_ULTRA,
  /** Rótulo de uma lista fixa, em lote na biblioteca. */
  genre: NEMOTRON_ULTRA,
  /** Extração de string, sem conhecimento de mundo. */
  cleanTitle: NEMOTRON_ULTRA,
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
    { model: AI_MODELS.cleanTitle, maxTokens: AI_BUDGET.cleanTitle, temperature: 0 },
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

/**
 * Classify a track into ONE genre from GENRE_TAXONOMY using the AI. Used to
 * categorize imported tracks the catalog couldn't tag. Returns null if unsure.
 */
export async function aiClassifyGenre(title: string, artist?: string): Promise<string | null> {
  const content = await aiChat(genreMessages(title, artist), {
    model: AI_MODELS.genre,
    maxTokens: AI_BUDGET.genre,
  });
  return content ? parseGenre(content) : null;
}

/**
 * Periodic AUDITOR: ask the AI whether a track's attribution matches reality.
 * The AI never decides the artist (iTunes does) — it only flags a likely
 * mismatch so we can re-check. Returns true (SIM), false (clearly NÃO), or null
 * (uncertain / unavailable — treat as "leave it alone").
 */
export async function aiVerifyArtist(title: string, artist: string): Promise<boolean | null> {
  const content = await aiChat(verifyMessages(title, artist), {
    model: AI_MODELS.verify,
    maxTokens: AI_BUDGET.verify,
  });
  return content ? parseVerify(content) : null;
}

export type AiTrackIdentity = TrackIdentity;

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
  const content = await aiChat(identityMessages(rawTitle, currentArtist), {
    model: AI_MODELS.identity,
    maxTokens: AI_BUDGET.identity,
  });
  return content ? parseIdentity(content) : null;
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
    { model: AI_MODELS.splitArtists, maxTokens: AI_BUDGET.splitArtists, temperature: 0 },
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
