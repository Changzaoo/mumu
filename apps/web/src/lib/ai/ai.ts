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
