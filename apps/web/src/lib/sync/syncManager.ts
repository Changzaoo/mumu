/**
 * Cloud-sync bootstrap. Points every synced local store at the signed-in user's
 * Firestore space, and detaches on logout. Call once on app boot.
 */
import { subscribeAuth } from '@/lib/firebase';
import * as localLikes from '@/lib/local/localLikes';
import * as localHistory from '@/lib/local/localHistory';
import * as localPlaylists from '@/lib/local/localPlaylists';
import * as localLibrary from '@/lib/local/localLibrary';

let started = false;

export function initCloudSync(): void {
  if (started) return;
  started = true;
  // Limpeza de boot: o catálogo grátis não faz parte do acervo do usuário, mas
  // versões antigas o gravavam em listas e histórico. Curtidas ficam de fora de
  // propósito — curtir do catálogo continua valendo, só não vira biblioteca.
  localLikes.purgePreviews();
  localHistory.purgeCatalog();
  localPlaylists.purgeCatalog();
  subscribeAuth((user) => {
    const uid = user?.uid ?? null;
    localLikes.setUser(uid);
    localPlaylists.setUser(uid);
    localLibrary.setUser(uid);
  });
}
