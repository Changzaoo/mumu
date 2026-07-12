/**
 * Shared community library — link-imported tracks published to a global
 * Firestore collection so every user can discover and play them.
 *
 * Only metadata + the original source link are shared (audio stays per device),
 * so another user "plays" a shared track by re-importing it through the importer
 * with the stored `sourceUrl`. Deduped by a key derived from that URL, so the
 * same video shared by many people is a single entry.
 */
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import type { TrackDto } from '@aurial/shared';
import { auth, db } from '@/lib/firebase';

export interface SharedTrack {
  track: TrackDto;
  sourceUrl: string;
  sharedByName: string | null;
  sharedAt: number;
}

/** Firestore-safe, deterministic doc id for a source URL (dedupes the same link). */
function keyFor(sourceUrl: string): string {
  return (
    sourceUrl
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 300) || 'x'
  );
}

/** Publish (or refresh) a link-imported track to the community library. */
export function publishSharedTrack(track: TrackDto, sourceUrl: string): void {
  const user = auth?.currentUser;
  if (!db || !user || !sourceUrl) return;
  void setDoc(
    doc(db, 'sharedTracks', keyFor(sourceUrl)),
    {
      track,
      sourceUrl,
      sharedByName: user.displayName ?? null,
      sharedByUid: user.uid,
      sharedAt: Date.now(),
    },
    { merge: true },
  ).catch(() => undefined);
}

/** Realtime subscription to the newest shared tracks. Returns an unsubscribe. */
export function subscribeSharedTracks(callback: (items: SharedTrack[]) => void): () => void {
  if (!db) {
    callback([]);
    return () => undefined;
  }
  const q = query(collection(db, 'sharedTracks'), orderBy('sharedAt', 'desc'), fsLimit(60));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => d.data() as SharedTrack)),
    () => callback([]),
  );
}
