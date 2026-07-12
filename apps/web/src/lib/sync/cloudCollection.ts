/**
 * cloudCollection — mirrors an id-keyed local store to a per-user Firestore
 * subcollection (`users/{uid}/{name}`) for cross-device sync.
 *
 * Model: the local store stays the fast source for the UI; this layer keeps it
 * in union with the cloud. On sign-in it seeds any local-only items up to the
 * cloud and applies remote items down to local; thereafter local add/remove
 * push to the cloud and a realtime listener applies other devices' changes.
 *
 * Everything is best-effort and guarded — if Firestore is unavailable or a
 * write fails, the local experience is untouched.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface CloudCollection<T extends DocumentData> {
  /** Upsert an item to the cloud (no-op when not syncing). */
  push: (id: string, data: T) => void;
  /** Delete an item from the cloud (no-op when not syncing). */
  remove: (id: string) => void;
  /** Start (uid) or stop (null) syncing for a signed-in user. */
  setUser: (uid: string | null) => void;
}

export interface CloudCollectionConfig<T extends DocumentData> {
  /** Subcollection name under `users/{uid}`. */
  name: string;
  /** Current local items to seed to the cloud on first sync. */
  localItems: () => Iterable<[string, T]>;
  /** Apply a remote add/update to the local store — must NOT re-push. */
  onRemoteUpsert: (id: string, data: T) => void;
  /** Apply a remote delete to the local store — must NOT re-push. */
  onRemoteDelete: (id: string) => void;
}

export function cloudCollection<T extends DocumentData>(
  config: CloudCollectionConfig<T>,
): CloudCollection<T> {
  let uid: string | null = null;
  let unsub: Unsubscribe | null = null;
  let seeded = false;

  const colRef = () => collection(db!, 'users', uid!, config.name);

  const push = (id: string, data: T): void => {
    if (!db || !uid) return;
    void setDoc(doc(colRef(), id), data).catch(() => undefined);
  };

  const remove = (id: string): void => {
    if (!db || !uid) return;
    void deleteDoc(doc(colRef(), id)).catch(() => undefined);
  };

  const setUser = (next: string | null): void => {
    if (next === uid) return;
    unsub?.();
    unsub = null;
    seeded = false;
    uid = next;
    if (!db || !uid) return;

    unsub = onSnapshot(
      colRef(),
      (snap) => {
        // First snapshot: union — push local-only items up, apply remote down.
        if (!seeded) {
          seeded = true;
          const remoteIds = new Set(snap.docs.map((d) => d.id));
          for (const [id, data] of config.localItems()) {
            if (!remoteIds.has(id)) push(id, data);
          }
        }
        for (const change of snap.docChanges()) {
          if (change.type === 'removed') config.onRemoteDelete(change.doc.id);
          else config.onRemoteUpsert(change.doc.id, change.doc.data() as T);
        }
      },
      () => undefined, // permission/offline errors: stay local-only
    );
  };

  return { push, remove, setUser };
}
