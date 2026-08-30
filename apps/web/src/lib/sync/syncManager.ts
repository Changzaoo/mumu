/**
 * Cloud-sync bootstrap. Points every synced local store at the signed-in user's
 * Firestore space, and detaches on logout. Call once on app boot.
 */
import { subscribeAuth } from '@/lib/firebase';
import * as faixasQueFalharam from '@/lib/local/faixasQueFalharam';
import * as gostoInicial from '@/lib/local/gostoInicial';
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
  // A capa escolhida pela pessoa é servida por `URL.createObjectURL`, e essa URL
  // morre junto com a aba: na recarga seguinte a lista aparecia com um quadrado
  // cinza no lugar da capa que ela acabou de escolher. Os bytes continuam no
  // cofre — este passe só emite uma URL viva a partir deles.
  void localPlaylists.reidratarCapas().catch(() => undefined);
  subscribeAuth((user) => {
    const uid = user?.uid ?? null;
    localLikes.setUser(uid);
    localPlaylists.setUser(uid);
    localLibrary.setUser(uid);
    gostoInicial.setUser(uid);
    faixasQueFalharam.setUser(uid);
  });
}
