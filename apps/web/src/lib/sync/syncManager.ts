/**
 * Cloud-sync bootstrap. Points every synced local store at the signed-in user's
 * Firestore space, and detaches on logout. Call once on app boot.
 */
import { subscribeAuth } from '@/lib/firebase';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import * as localLibrary from '@/lib/local/localLibrary';

let started = false;

export function initCloudSync(): void {
  if (started) return;
  started = true;
  subscribeAuth((user) => {
    const uid = user?.uid ?? null;
    localLikes.setUser(uid);
    localPlaylists.setUser(uid);
    localLibrary.setUser(uid);
  });
}
