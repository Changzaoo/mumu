/**
 * AI helpers (NVIDIA, via the importer's server-side proxy — the key never
 * reaches the browser). Reuse `aiChat` for any future AI feature.
 */
import { aiChat, type AiMessage } from '@/lib/local/importerHelper';

export { aiChat };
export type { AiMessage };

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
    { maxTokens: 120, temperature: 0 },
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
    { maxTokens: 100, temperature: 0 },
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
