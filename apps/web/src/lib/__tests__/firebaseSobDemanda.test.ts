/**
 * O SDK do Firebase fora do boot do visitante anônimo.
 *
 * Garante os três contratos de `lib/firebase.ts`:
 *  1. sem sessão salva, `subscribeAuth` emite `null` e o SDK NÃO é baixado;
 *  2. com sessão salva no IndexedDB, o SDK sobe sozinho e o login é restaurado;
 *  3. o anônimo que faz login depois recebe o usuário na MESMA assinatura.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  carregamentos: { app: 0, auth: 0, store: 0 },
  emitirDoSdk: null as ((user: unknown) => void) | null,
  usuarioAtual: null as unknown,
  usuarioFalso: { uid: 'u1', email: 'a@b.c', getIdToken: async () => 'token-u1' },
}));
const { carregamentos, usuarioFalso } = estado;

/** `doMock` + `resetModules`: cada teste importa o firebase.ts do zero com os mocks. */
function mockarSdk(): void {
  vi.doMock('firebase/app', () => {
    carregamentos.app++;
    return { initializeApp: () => ({}) };
  });
  vi.doMock('firebase/auth', () => {
    carregamentos.auth++;
    return {
      getAuth: () => ({ currentUser: null }),
      onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
        estado.emitirDoSdk = cb;
        queueMicrotask(() => cb(estado.usuarioAtual));
        return () => undefined;
      },
      signInWithEmailAndPassword: async () => {
        estado.usuarioAtual = usuarioFalso;
        estado.emitirDoSdk?.(usuarioFalso);
        return { user: usuarioFalso };
      },
    };
  });
  vi.doMock('firebase/firestore', () => {
    carregamentos.store++;
    return {
      initializeFirestore: () => ({}),
      persistentLocalCache: () => ({}),
      persistentSingleTabManager: () => ({}),
      getFirestore: () => ({}),
    };
  });
}

async function guardarSessaoNoIndexedDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const abrir = indexedDB.open('firebaseLocalStorageDb', 1);
    abrir.onupgradeneeded = () => abrir.result.createObjectStore('firebaseLocalStorage');
    abrir.onerror = () => reject(abrir.error);
    abrir.onsuccess = () => {
      const tx = abrir.result.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').put({ uid: 'u1' }, 'firebase:authUser:k:[DEFAULT]');
      tx.oncomplete = () => {
        abrir.result.close();
        resolve();
      };
    };
  });
}

async function esperar(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe('firebase sob demanda', () => {
  beforeEach(() => {
    vi.resetModules();
    carregamentos.app = carregamentos.auth = carregamentos.store = 0;
    mockarSdk();
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'chave-de-teste');
    globalThis.indexedDB = new IDBFactory();
    window.localStorage.clear();
    estado.emitirDoSdk = null;
    estado.usuarioAtual = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('visitante anônimo: emite null e não baixa o SDK', async () => {
    const { subscribeAuth, getIdToken, firebaseReady } = await import('@/lib/firebase');
    const vistos: unknown[] = [];
    subscribeAuth((u) => vistos.push(u));
    await esperar(() => vistos.length > 0);
    expect(vistos).toEqual([null]);
    expect(await getIdToken()).toBeNull();
    await firebaseReady();
    expect(carregamentos).toEqual({ app: 0, auth: 0, store: 0 });
    // o banco inexistente NÃO pode ter sido criado pela sondagem
    const bancos = await indexedDB.databases();
    expect(bancos.some((b) => b.name === 'firebaseLocalStorageDb')).toBe(false);
  });

  it('sessão salva: o SDK sobe sozinho e o login é restaurado', async () => {
    await guardarSessaoNoIndexedDb();
    const { subscribeAuth } = await import('@/lib/firebase');
    const vistos: unknown[] = [];
    subscribeAuth((u) => vistos.push(u));
    await esperar(() => carregamentos.auth > 0 && estado.emitirDoSdk !== null);
    expect(carregamentos.app).toBe(1);
    estado.emitirDoSdk?.(usuarioFalso);
    expect(vistos.at(-1)).toBe(usuarioFalso);
  });

  it('anônimo que entra depois: a mesma assinatura recebe o usuário', async () => {
    const { subscribeAuth, signInEmail, carregarFirebase } = await import('@/lib/firebase');
    const vistos: unknown[] = [];
    subscribeAuth((u) => vistos.push(u));
    await esperar(() => vistos.length > 0);
    expect(carregamentos.auth).toBe(0);

    // O login é o gatilho do download; carregamos antes só para o mock do vitest
    // não correr com o `import()` paralelo de `signInEmail`.
    await carregarFirebase();
    await signInEmail('a@b.c', 'senha');
    await esperar(() => vistos.includes(usuarioFalso));
    expect(carregamentos.auth).toBe(1);
    expect(vistos[0]).toBeNull();
    expect(vistos.at(-1)).toBe(usuarioFalso);
    // o null inicial do SDK não repete o null que já foi entregue
    expect(vistos.filter((u) => u === null)).toHaveLength(1);
  });
});
