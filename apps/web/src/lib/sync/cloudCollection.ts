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
 *
 * As funções do `firebase/firestore` entram por `import()` dinâmico de
 * propósito: este módulo é alcançado a partir da biblioteca local, que está no
 * caminho crítico do boot. Com o import estático, os ~250 kB do Firestore
 * voltavam para o chunk de entrada e anulavam o carregamento tardio do SDK.
 */
import type { DocumentData, Unsubscribe } from 'firebase/firestore';
import { db, firebaseReady } from '@/lib/firebase';
import { firestore } from '@/lib/sync/firestoreLazy';
import {
  registrarErro,
  registrarSnapshot,
  registrarUniao,
  registrarUsuario,
} from '@/lib/sync/syncStatus';

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
  /**
   * Aplica um LOTE de mudanças remotas de uma vez.
   *
   * O primeiro snapshot traz a coleção INTEIRA, e entregá-la item a item fazia
   * a loja local reconstruir o array a cada faixa — O(n²) de cópia e um
   * recálculo de álbuns/artistas/gêneros por item, no exato momento em que o
   * usuário está esperando a tela. Quem não implementa cai no caminho item a
   * item, que continua correto.
   */
  onRemoteBatch?: (upserts: Array<[string, T]>, deletes: string[]) => void;
}

export function cloudCollection<T extends DocumentData>(
  config: CloudCollectionConfig<T>,
): CloudCollection<T> {
  let uid: string | null = null;
  let unsub: Unsubscribe | null = null;
  let seeded = false;

  const push = (id: string, data: T): void => {
    if (!uid) return;
    const alvo = uid;
    void (async () => {
      const fs = await firestore();
      if (!db || uid !== alvo) return; // deslogou (ou trocou de conta) no caminho
      await fs.setDoc(fs.doc(fs.collection(db, 'users', alvo, config.name), id), data);
    })().catch((erro) => registrarErro(config.name, erro));
  };

  const remove = (id: string): void => {
    if (!uid) return;
    const alvo = uid;
    void (async () => {
      const fs = await firestore();
      if (!db || uid !== alvo) return;
      await fs.deleteDoc(fs.doc(fs.collection(db, 'users', alvo, config.name), id));
    })().catch((erro) => registrarErro(config.name, erro));
  };

  const setUser = (next: string | null): void => {
    if (next === uid) return;
    unsub?.();
    unsub = null;
    seeded = false;
    uid = next;
    registrarUsuario(config.name, uid);
    if (!uid) return;

    const alvo = uid;
    void (async () => {
      await firebaseReady();
      const fs = await firestore();
      if (!db || uid !== alvo) return;

      unsub = fs.onSnapshot(
        fs.collection(db, 'users', alvo, config.name),
        (snap) => {
          registrarSnapshot(config.name, snap.size, snap.metadata.fromCache ? 'cache' : 'servidor');
          // First snapshot: union — push local-only items up, apply remote down.
          if (!seeded) {
            seeded = true;
            const remoteIds = new Set(snap.docs.map((d) => d.id));
            let enviados = 0;
            for (const [id, data] of config.localItems()) {
              if (!remoteIds.has(id)) {
                push(id, data);
                enviados += 1;
              }
            }
            registrarUniao(config.name, enviados);
          }
          const upserts: Array<[string, T]> = [];
          const deletes: string[] = [];
          for (const change of snap.docChanges()) {
            if (change.type === 'removed') deletes.push(change.doc.id);
            else upserts.push([change.doc.id, change.doc.data() as T]);
          }
          if (upserts.length === 0 && deletes.length === 0) return;
          if (config.onRemoteBatch) {
            config.onRemoteBatch(upserts, deletes);
            return;
          }
          for (const id of deletes) config.onRemoteDelete(id);
          for (const [id, data] of upserts) config.onRemoteUpsert(id, data);
        },
        // Regra negando leitura, projeto errado, rede morta: o app segue
        // local-only (é o certo), mas o motivo NÃO pode mais sumir — era
        // exatamente assim que um aparelho ficava para trás sem sintoma.
        (erro) => registrarErro(config.name, erro),
      );
    })().catch((erro) => registrarErro(config.name, erro));
  };

  return { push, remove, setUser };
}
