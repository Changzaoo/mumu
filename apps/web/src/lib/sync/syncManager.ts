/**
 * Cloud-sync bootstrap. Points every synced local store at the signed-in user's
 * Firestore space, and detaches on logout. Call once on app boot.
 */
import { subscribeAuth } from '@/lib/firebase';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import * as faixasQueFalharam from '@/lib/local/faixasQueFalharam';
import * as importacoesNaConta from '@/lib/local/importacoesNaConta';
import * as gostoInicial from '@/lib/local/gostoInicial';
import * as localLikes from '@/lib/local/localLikes';
import * as localHistory from '@/lib/local/localHistory';
import * as localPlaylists from '@/lib/local/localPlaylists';
import * as localLibrary from '@/lib/local/localLibrary';
import * as importQueue from '@/lib/local/importQueue';
import { definirUsuario, limparFila } from '@/lib/sync/filaOffline';

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
    definirUsuario(uid);
    localLikes.setUser(uid);
    localPlaylists.setUser(uid);
    localLibrary.setUser(uid);
    gostoInicial.setUser(uid);
    faixasQueFalharam.setUser(uid);
    importacoesNaConta.setUser(uid);
    artistasSeguidos.setUser(uid);
  });
}

/**
 * Chamado pelo logout. Apaga o que e DA CONTA que saiu:
 *  - cache `aurial-api` do service worker (respostas da API);
 *  - fila de escritas offline;
 *  - links de import ja conhecidos e os ainda pendentes na fila.
 * FICAM: biblioteca local e downloads (acervo offline da pessoa no aparelho).
 */
export async function limparEstadoDaConta(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete('aurial-api');
  } catch {
    /* sem Cache Storage: nada a apagar */
  }
  await limparFila();
  importacoesNaConta.limpar();
  importQueue.limparPendentesDaConta();
}
