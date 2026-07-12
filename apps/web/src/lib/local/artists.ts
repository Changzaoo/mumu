/**
 * Artist-credit parsing. A single credit string like "A feat. B", "A & B" or
 * "A x B" names MULTIPLE distinct artists — merging them into one makes the
 * track impossible to attribute correctly. We split them here with a SAFE
 * heuristic (used synchronously so obvious cases work immediately); the
 * enrichment path additionally consults the AI for the ambiguous cases, where a
 * separator can be part of a single act's name ("Tyler, The Creator", "AC/DC",
 * "Earth, Wind & Fire").
 */

/** Acts whose real name legitimately contains a separator — never split these. */
export const GROUP_EXCEPTIONS = new Set(
  [
    'ac/dc',
    'earth, wind & fire',
    'simon & garfunkel',
    'hall & oates',
    'above & beyond',
    'florence + the machine',
    'tyler, the creator',
    'crosby, stills & nash',
    'crosby, stills, nash & young',
    'now, now',
    'sam & dave',
    'kool & the gang',
    'blood, sweat & tears',
    'derek & the dominos',
    'mumford & sons',
    'macklemore & ryan lewis',
    'sly & the family stone',
    'nick cave & the bad seeds',
  ].map((s) => s.toLowerCase()),
);

// Featuring markers ALWAYS denote separate artists — safe to split anywhere.
const FEAT_SEP =
  /\s*(?:\bfeat(?:\.|uring)?\b|\bft\.?\b|\bpart(?:\.|icipa[cç][aã]o)?\b|\bcom\b|\bwith\b)\s*/gi;
// Reasonably-safe collaboration separators (comma and "/" are deliberately left
// to the AI — they're too often part of a single act's name).
const COLLAB_SEP = /\s*&\s*|\s+x\s+|\s+vs\.?\s+|\s*;\s*/gi;

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const name = n.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Split an artist credit into distinct names (heuristic). Splits featuring
 * markers always, and safe collab separators (`&`, ` x `, ` vs `, `;`) unless
 * the whole credit — or a piece of it — is a known group name. Always returns at
 * least one name.
 */
export function splitArtistNames(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (GROUP_EXCEPTIONS.has(trimmed.toLowerCase())) return [trimmed];
  const out: string[] = [];
  for (const featPart of trimmed.split(FEAT_SEP)) {
    const p = featPart.trim();
    if (!p) continue;
    if (GROUP_EXCEPTIONS.has(p.toLowerCase())) {
      out.push(p);
      continue;
    }
    out.push(...p.split(COLLAB_SEP));
  }
  const names = dedupe(out);
  return names.length > 0 ? names : [trimmed];
}

/** True when a credit has an AMBIGUOUS separator worth asking the AI about. */
export function creditIsAmbiguous(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (GROUP_EXCEPTIONS.has(t)) return false;
  return /[,/]/.test(t); // comma or slash — could be a name or a separator
}
