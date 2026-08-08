/**
 * Shared community library — link-imported tracks published to a global
 * Firestore collection so every user can discover and play them.
 *
 * Only metadata + the original source link are shared (audio stays per device),
 * so another user "plays" a shared track by re-importing it through the importer
 * with the stored `sourceUrl`. Deduped by a key derived from that URL, so the
 * same video shared by many people is a single entry.
 */
import type { TrackDto } from '@aurial/shared';
import { auth, db, firebaseReady } from '@/lib/firebase';

// Import dinâmico: a biblioteca local alcança este módulo, e ela está no
// caminho crítico do boot — o SDK do Firestore não pode entrar no bundle inicial.
import { firestore } from '@/lib/sync/firestoreLazy';

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

/**
 * Publish a link-imported track to the community library. The FIRST person to
 * share a given link owns the entry: their title/artist/cover and its position
 * (sharedAt) are canonical and everyone else sees exactly that. Re-importing the
 * same link by anyone else does NOT relabel or reorder it. Only the original
 * sharer may refresh their own entry (e.g. a better cover after enrichment),
 * and even then the order (sharedAt) is preserved.
 */
export async function publishSharedTrack(track: TrackDto, sourceUrl: string): Promise<void> {
  if (!sourceUrl) return;
  await firebaseReady();
  const { doc, getDoc, setDoc } = await firestore();
  const user = auth?.currentUser;
  if (!db || !user) return;
  const ref = doc(db, 'sharedTracks', keyFor(sourceUrl));
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      // Someone else owns it → never touch (no relabel, no reorder).
      if (snap.data()?.sharedByUid !== user.uid) return;
      // My own entry → refresh metadata but keep the original sharedAt/order.
      await setDoc(ref, { track, sharedByName: user.displayName ?? null }, { merge: true });
      return;
    }
    await setDoc(ref, {
      track,
      sourceUrl,
      sharedByName: user.displayName ?? null,
      sharedByUid: user.uid,
      sharedAt: Date.now(),
    });
  } catch {
    /* offline / rules — best-effort */
  }
}

/** Realtime subscription to the newest shared tracks. Returns an unsubscribe. */
export function subscribeSharedTracks(callback: (items: SharedTrack[]) => void): () => void {
  let cancelado = false;
  let desligar: (() => void) | null = null;
  void (async () => {
    await firebaseReady();
    const { collection, limit: fsLimit, onSnapshot, orderBy, query } = await firestore();
    if (cancelado) return;
    if (!db) {
      callback([]);
      return;
    }
    const q = query(collection(db, 'sharedTracks'), orderBy('sharedAt', 'desc'), fsLimit(60));
    desligar = onSnapshot(
      q,
      (snap) => callback(snap.docs.map((d) => d.data() as SharedTrack)),
      () => callback([]),
    );
  })().catch(() => callback([]));
  return () => {
    cancelado = true;
    desligar?.();
  };
}
