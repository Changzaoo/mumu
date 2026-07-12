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
import { searchSongs } from '@/lib/catalog/itunes';

export interface CleanQuery {
  title: string;
  artist?: string;
}

export interface EnrichedMeta {
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
}

/** Junk fragments that filenames/streaming titles carry but iTunes does not. */
const NOISE = [
  /\((?:official\s+)?(?:music\s+)?video\)/gi,
  /\((?:official\s+)?audio\)/gi,
  /\((?:official\s+)?lyric(?:s)?(?:\s+video)?\)/gi,
  /\(visualizer\)/gi,
  /\[(?:official[^\]]*)\]/gi,
  /\[[^\]]*(?:video|audio|lyric[^\]]*)\]/gi,
  /\((?:hd|hq|4k|full\s+hd)\)/gi,
  /\bofficial\s+(?:music\s+)?video\b/gi,
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
export async function enrichMeta(q: CleanQuery): Promise<EnrichedMeta | null> {
  const title = q.title.trim();
  if (!title) return null;
  const term = q.artist ? `${title} ${q.artist}` : title;

  try {
    const results = await searchSongs(term, 'br', 8);
    if (results.length === 0) return null;

    const wantTitle = norm(title);
    const wantArtist = q.artist ? norm(q.artist) : '';

    let best = results[0];
    let bestScore = -1;
    for (const song of results) {
      const songTitle = norm(song.trackName);
      const songArtist = norm(song.artistName);
      let score = 0;
      if (songTitle === wantTitle) score += 4;
      else if (songTitle.includes(wantTitle) || wantTitle.includes(songTitle)) score += 2;
      if (wantArtist) {
        if (songArtist === wantArtist) score += 3;
        else if (songArtist.includes(wantArtist) || wantArtist.includes(songArtist)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = song;
      }
    }
    if (!best) return null;

    return {
      title: best.trackName,
      artist: best.artistName,
      album: best.collectionName || null,
      coverUrl: best.artworkUrl100 ? hiRes(best.artworkUrl100) : null,
    };
  } catch {
    return null;
  }
}
