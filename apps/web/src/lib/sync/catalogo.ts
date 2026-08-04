/**
 * ACERVO DO APP — o que o admin adiciona, todo mundo ouve.
 *
 * Por que isto existe: até aqui "as músicas do app" eram, na verdade, a
 * biblioteca PRIVADA de quem as importou. Tudo cai em `users/{uid}/library`, e
 * as regras do Firestore deixam só o dono ler — o que é certo para a biblioteca
 * pessoal e completamente errado para o acervo curado. O usuário comum abria o
 * app, via a própria biblioteca (vazia) e concluía, com razão, que o app não
 * tinha música nenhuma. Não era sincronia quebrada: o acervo compartilhado
 * simplesmente não existia.
 *
 * Como funciona:
 *   admin importa → entra no acervo dele → espelhado em `catalogo/{trackId}`
 *   qualquer usuário → assina `catalogo` → as faixas entram na biblioteca local
 *
 * Por que entra na biblioteca local em vez de virar uma prateleira à parte: a
 * Home, a busca, artistas, gêneros e álbuns são todos montados a partir dela.
 * Entrando ali, o acervo aparece em TODA a interface sem uma linha de UI nova.
 *
 * O que toca no aparelho do usuário: a entrada carrega `remoteUrl` (a cópia
 * enviada ao importador) e `sourceUrl` (o link original). O player já resolve
 * os dois — ver `ensurePlayableSource` em stores/playerStore.ts. Faixa que o
 * admin importou de arquivo e nunca subiu ao importador não toca em outro
 * aparelho; isso vale para o acervo como já valia para a biblioteca.
 */
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { auth, db, firebaseReady } from '@/lib/firebase';
import { firestore } from '@/lib/sync/firestoreLazy';
import { isAuthorizedEmail } from '@/lib/auth/roles';
import { registrarErro, registrarSnapshot, registrarUsuario } from '@/lib/sync/syncStatus';

const COLECAO = 'catalogo';

/** Só o admin escreve no acervo. As regras do Firestore repetem esta lista. */
function souAdmin(): boolean {
  return isAuthorizedEmail(auth?.currentUser?.email);
}

/**
 * Publica (ou atualiza) uma faixa no acervo do app.
 *
 * Chamado por toda mudança da biblioteca — em aparelho de usuário comum é um
 * no-op silencioso, e as regras do Firestore garantem isso mesmo se o cliente
 * for adulterado.
 */
export function publicarNoCatalogo(entry: LibraryEntry): void {
  void (async () => {
    await firebaseReady();
    if (!db || !souAdmin()) return;
    const { doc, setDoc } = await firestore();
    await setDoc(doc(db, COLECAO, entry.track.id), entry);
  })().catch((erro) => registrarErro(COLECAO, erro));
}

/** Tira uma faixa do acervo (admin apagou de vez). */
export function removerDoCatalogo(id: string): void {
  void (async () => {
    await firebaseReady();
    if (!db || !souAdmin()) return;
    const { deleteDoc, doc } = await firestore();
    await deleteDoc(doc(db, COLECAO, id));
  })().catch((erro) => registrarErro(COLECAO, erro));
}

/**
 * Sobe para o acervo tudo que o admin já tinha antes de o acervo existir.
 *
 * Sem esta varredura, só as faixas importadas DEPOIS desta versão chegariam aos
 * usuários — o acervo nasceria vazio e o problema pareceria não ter sido
 * resolvido. Roda uma vez por sessão, só no aparelho do admin, e é idempotente
 * (`setDoc` sobrescreve): repetir não duplica nada.
 */
export async function publicarAcervoDoAdmin(entradas: LibraryEntry[]): Promise<number> {
  await firebaseReady();
  if (!db || !souAdmin()) return 0;
  const { doc, setDoc } = await firestore();
  let publicadas = 0;
  for (const entry of entradas) {
    try {
      await setDoc(doc(db, COLECAO, entry.track.id), entry);
      publicadas += 1;
    } catch (erro) {
      registrarErro(COLECAO, erro);
    }
    // Respiro entre escritas: uma rajada de centenas de setDoc trava a página
    // em aparelho modesto e ainda esbarra no limite de escrita do Firestore.
    await new Promise((r) => setTimeout(r, 40));
  }
  return publicadas;
}

/**
 * Assina o acervo. Vale para TODO usuário, inclusive visitante sem conta —
 * é o acervo que dá o que ouvir antes de criar conta.
 */
export function subscribeCatalogo(callback: (entradas: LibraryEntry[]) => void): () => void {
  let cancelado = false;
  let desligar: (() => void) | null = null;
  void (async () => {
    await firebaseReady();
    if (cancelado || !db) return;
    const { collection, onSnapshot } = await firestore();
    registrarUsuario(COLECAO, auth?.currentUser?.uid ?? 'visitante');
    desligar = onSnapshot(
      collection(db, COLECAO),
      (snap) => {
        registrarSnapshot(COLECAO, snap.size, snap.metadata.fromCache ? 'cache' : 'servidor');
        callback(snap.docs.map((d) => d.data() as LibraryEntry));
      },
      (erro) => registrarErro(COLECAO, erro),
    );
  })().catch((erro) => registrarErro(COLECAO, erro));
  return () => {
    cancelado = true;
    desligar?.();
  };
}
