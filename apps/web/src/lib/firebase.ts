/**
 * Firebase Web SDK bootstrap — CARREGADO FORA DO CAMINHO CRÍTICO.
 *
 * O SDK pesa ~445 kB no bundle (firestore + auth + webchannel + app + util), e
 * enquanto ele estava em `import` estático o navegador tinha que baixar e
 * EXECUTAR tudo isso antes de pintar o primeiro pixel — mesmo que nada no boot
 * precise dele de imediato: a biblioteca do usuário vem do localStorage, que é
 * leitura instantânea. Era ~30% do caminho crítico parado na frente da tela.
 *
 * Agora o SDK entra por `import()` dinâmico, disparado JÁ na avaliação deste
 * módulo — o download acontece em paralelo com a renderização, não na frente
 * dela. `auth` e `db` nascem `null` e são preenchidos quando o SDK sobe
 * (bindings vivas de ESM: quem importou enxerga a troca sozinho).
 *
 * A regra para quem consome: nada de ler `auth`/`db` no instante do boot. Ou
 * espere `firebaseReady()`, ou trabalhe dentro de `subscribeAuth`, que só
 * dispara depois do SDK pronto. Os guardas `if (!db) return` que já existiam
 * continuam valendo — agora eles também cobrem a janela de carregamento.
 *
 * Demo-mode guard: sem VITE_FIREBASE_API_KEY, `authDisabled` é true, o SDK nem
 * é baixado e todo helper de login lança um erro amigável em pt-BR — o app
 * ainda sobe e toca áudio sem conta.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { Auth, User, UserCredential } from 'firebase/auth';
import type { FirestoreModule } from '@/lib/sync/firestoreLazy';
import { marcarBoot } from '@/lib/telemetry/bootPerf';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True when the app runs without Firebase credentials (demo mode). */
export const authDisabled: boolean = !config.apiKey;

/**
 * Auth handle — `null` até o SDK subir (e para sempre no modo demonstração).
 * Binding VIVA: `import { auth }` enxerga o valor novo sem reimportar.
 */
export let auth: Auth | null = null;
/** Firestore handle for cross-device sync + trending; same lifecycle as `auth`. */
export let db: Firestore | null = null;

/**
 * Sobe o SDK uma única vez. Resolve mesmo em caso de falha — quem espera por
 * isto quer saber "a janela de carregamento acabou", não "deu certo"; o teste
 * de verdade continua sendo `if (!db)`.
 */
const readyPromise: Promise<void> = authDisabled
  ? Promise.resolve()
  : (async () => {
      try {
        const [{ initializeApp }, authMod, storeMod] = await Promise.all([
          import('firebase/app'),
          import('firebase/auth'),
          import('firebase/firestore'),
        ]);
        const app = initializeApp(config);
        auth = authMod.getAuth(app);
        auth.languageCode = 'pt-BR';
        db = criarFirestore(app, storeMod);
      } catch {
        // Sem SDK o app continua inteiro no modo local: biblioteca, reprodução
        // e importação não dependem da nuvem. Só a sincronia fica de fora.
      }
      marcarBoot('firebase-pronto');
    })();

/**
 * Firestore COM cache em disco.
 *
 * Sem isto o cache é só de memória: toda abertura do app buscava a coleção
 * `users/{uid}/library` inteira na rede antes de qualquer música da nuvem
 * aparecer na tela — e offline não aparecia nunca. Com o cache persistente, o
 * primeiro snapshot sai do IndexedDB na hora e a rede vira só o delta.
 *
 * `persistentMultipleTabManager` porque o app abre em várias abas com
 * frequência (e o gerente de aba única derruba a persistência na segunda).
 * Navegador que não suporta cai no Firestore comum — pior desempenho, mesmo
 * comportamento.
 */
function criarFirestore(app: FirebaseApp, mod: FirestoreModule): Firestore {
  try {
    return mod.initializeFirestore(app, {
      localCache: mod.persistentLocalCache({
        tabManager: mod.persistentMultipleTabManager(),
      }),
    });
  } catch {
    return mod.getFirestore(app);
  }
}

/** Resolve quando `auth`/`db` já estão definidos (ou o SDK falhou/está desligado). */
export function firebaseReady(): Promise<void> {
  return readyPromise;
}

async function requireAuth(): Promise<Auth> {
  await readyPromise;
  if (!auth) {
    throw new Error('Login indisponível no modo demonstração. Configure o Firebase no .env.local.');
  }
  return auth;
}

/** Current user's ID token (Firebase caches and refreshes internally). Null when signed out. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  await readyPromise;
  const user = auth?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function signInGoogle(): Promise<UserCredential> {
  const [instance, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  return signInWithPopup(instance, new GoogleAuthProvider());
}

export async function signInEmail(email: string, password: string): Promise<UserCredential> {
  const [instance, { signInWithEmailAndPassword }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  return signInWithEmailAndPassword(instance, email, password);
}

export async function signUpEmail(email: string, password: string): Promise<UserCredential> {
  const [instance, { createUserWithEmailAndPassword, sendEmailVerification }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  const credential = await createUserWithEmailAndPassword(instance, email, password);
  // Dispara o e-mail de verificação na hora (best-effort). Sem isso, contas
  // e-mail/senha ficavam não-verificadas PARA SEMPRE — e serviços que checam
  // email_verified (ex.: modo allow-list do importer) as recusavam em silêncio.
  void sendEmailVerification(credential.user).catch(() => undefined);
  return credential;
}

export async function signInAnonymously(): Promise<UserCredential> {
  const [instance, { signInAnonymously: fbSignInAnonymously }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  return fbSignInAnonymously(instance);
}

const MAGIC_LINK_EMAIL_KEY = 'aurial:magic-link-email';

/** Sends a passwordless sign-in link; completion happens on /login via completeMagicLink(). */
export async function sendMagicLink(email: string): Promise<void> {
  const [instance, { sendSignInLinkToEmail }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  await sendSignInLinkToEmail(instance, email, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(MAGIC_LINK_EMAIL_KEY, email);
}

/** Finishes a magic-link flow if the current URL is a sign-in link. Returns null otherwise. */
export async function completeMagicLink(): Promise<UserCredential | null> {
  await readyPromise;
  if (!auth) return null;
  const { isSignInWithEmailLink, signInWithEmailLink } = await import('firebase/auth');
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;
  let email = window.localStorage.getItem(MAGIC_LINK_EMAIL_KEY);
  if (!email) {
    email = window.prompt('Confirme seu e-mail para concluir o acesso');
  }
  if (!email) return null;
  const cred = await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem(MAGIC_LINK_EMAIL_KEY);
  return cred;
}

export async function logout(): Promise<void> {
  await readyPromise;
  if (!auth) return;
  const { signOut } = await import('firebase/auth');
  return signOut(auth);
}

/**
 * Subscribe to auth state; immediately emits null in demo mode.
 *
 * Assinar ANTES de o SDK subir é o caso normal agora (todo consumidor de boot
 * cai aqui), então a assinatura fica pendurada e é ligada quando `auth` existe.
 * Cancelar antes disso também precisa funcionar — daí o `cancelado`.
 */
export function subscribeAuth(callback: (user: User | null) => void): () => void {
  if (authDisabled) {
    callback(null);
    return () => undefined;
  }
  let cancelado = false;
  let desligar: (() => void) | null = null;
  void (async () => {
    await readyPromise;
    if (cancelado) return;
    if (!auth) {
      callback(null); // SDK não subiu: o app segue como se estivesse deslogado
      return;
    }
    const { onAuthStateChanged } = await import('firebase/auth');
    if (cancelado) return;
    desligar = onAuthStateChanged(auth, callback);
  })();
  return () => {
    cancelado = true;
    desligar?.();
  };
}

export type { User };
