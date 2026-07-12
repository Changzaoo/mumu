/**
 * Community trending — a global, cross-user "em alta" fed by likes.
 *
 * Liking a track increments a global counter for it (bucketed by genre), guarded
 * by a per-user vote doc so each person counts once. The Home page reads the top
 * tracks overall and per genre. All best-effort: no Firestore / not signed in →
 * the feed is simply empty and likes stay purely local.
 *
 *   trending/{trackId}                     { track, genre, genreKey, likeCount }
 *   trending/{trackId}/voters/{uid}        { at }   (one per user who liked it)
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as fsLimit,
  orderBy,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { TrackDto } from '@aurial/shared';
import { auth, db } from '@/lib/firebase';

interface TrendingDoc {
  track: TrackDto;
  genre: string | null;
  genreKey: string;
  likeCount: number;
}

function genreKeyOf(track: TrackDto): string {
  return (track.genre ?? '').trim().toLowerCase() || 'outros';
}

/** Apply a like/unlike to the global trending counters (idempotent per user). */
export async function recordLike(track: TrackDto, liked: boolean): Promise<void> {
  const user = auth?.currentUser;
  if (!db || !user) return;
  const trendRef = doc(db, 'trending', track.id);
  const voterRef = doc(db, 'trending', track.id, 'voters', user.uid);
  try {
    const voted = (await getDoc(voterRef)).exists();
    if (liked === voted) return; // nothing to change
    const batch = writeBatch(db);
    if (liked) {
      batch.set(voterRef, { at: Date.now() });
      batch.set(
        trendRef,
        { track, genre: track.genre ?? null, genreKey: genreKeyOf(track), likeCount: increment(1) },
        { merge: true },
      );
    } else {
      batch.delete(voterRef);
      batch.set(trendRef, { likeCount: increment(-1) }, { merge: true });
    }
    await batch.commit();
  } catch {
    /* offline / rules / quota — trending is best-effort */
  }
}

function readTracks(docs: Array<{ data: () => unknown }>): TrackDto[] {
  return docs
    .map((d) => (d.data() as Partial<TrendingDoc>).track)
    .filter((t): t is TrackDto => Boolean(t));
}

/** Top liked tracks overall (community). */
export async function topTrending(n = 12): Promise<TrackDto[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'trending'), orderBy('likeCount', 'desc'), fsLimit(n)),
    );
    return readTracks(snap.docs);
  } catch {
    return [];
  }
}

/** Top liked tracks in a genre (matched case-insensitively). */
export async function topByGenre(genre: string, n = 12): Promise<TrackDto[]> {
  if (!db) return [];
  const key = genre.trim().toLowerCase();
  if (!key) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'trending'),
        where('genreKey', '==', key),
        orderBy('likeCount', 'desc'),
        fsLimit(n),
      ),
    );
    return readTracks(snap.docs);
  } catch {
    return [];
  }
}
