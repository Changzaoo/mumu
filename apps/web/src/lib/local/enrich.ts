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
import { searchSongs, type AppleSong } from '@/lib/catalog/itunes';
import { aiCleanSongTitle } from '@/lib/ai/ai';

export interface CleanQuery {
  title: string;
  artist?: string;
  /** Internal: guards the one-shot AI retry from recursing. */
  aiTried?: boolean;
}

export interface EnrichedMeta {
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
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
function hiRes(url: string): string {
  return url.replace('100x100bb', '600x600bb');
}

/** Loose normalization for comparison: lowercase, strip accents + punctuation. */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Derive a clean search query from a filename (or a pasted title). Strips the
 * extension, leading track numbers ("01 - ", "01."), turns underscores into
 * spaces, removes "(Official Video)/(Audio)/(Lyrics)/[Official]" noise, and —
 * when the name looks like "Artist - Title" — splits artist + title.
 */
export function cleanQuery(filename: string): CleanQuery {
  let base = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
  base = base.replace(/_/g, ' ');
  // Leading track number: "01 - ", "01.", "1) ", "07_"
  base = base.replace(/^\s*\d{1,3}\s*[-.)\]]\s*/, '');
  for (const pattern of NOISE) base = base.replace(pattern, ' ');
  base = base.replace(/\s{2,}/g, ' ').trim();

  const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (split?.[1] && split[2]) {
    return { artist: split[1].trim(), title: split[2].trim() };
  }
  return { title: base || filename };
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
        album: best.collectionName || null,
        coverUrl: best.artworkUrl100 ? hiRes(best.artworkUrl100) : null,
      };
    }
  }

  // Couldn't confirm the artist. Ask the AI once for a clean artist/title, then
  // re-verify against iTunes (the AI alone is never trusted — iTunes must
  // corroborate the artist). Guarantees we never assert an unconfirmed artist.
  if (!q.aiTried) {
    const cleaned = await aiCleanSongTitle(q.artist ? `${q.title} ${q.artist}` : q.title, q.artist);
    if (cleaned?.artist) {
      return enrichMeta({ title: cleaned.title, artist: cleaned.artist, aiTried: true });
    }
  }
  return null;
}
