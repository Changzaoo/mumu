/**
 * Firebase Web SDK bootstrap.
 *
 * Demo-mode guard: when VITE_FIREBASE_API_KEY is missing, `authDisabled` is true,
 * `auth` is null and every sign-in helper throws a friendly pt-BR error — the app
 * still boots and plays audio without an account.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInAnonymously as fbSignInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from 'firebase/auth';

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

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
/** Firestore handle for cross-device sync + trending; null in demo mode. */
export let db: Firestore | null = null;

if (!authDisabled) {
  app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = 'pt-BR';
  db = getFirestore(app);
}

export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

function requireAuth(): Auth {
  if (!auth) {
    throw new Error('Login indisponível no modo demonstração. Configure o Firebase no .env.local.');
  }
  return auth;
}

/** Current user's ID token (Firebase caches and refreshes internally). Null when signed out. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export function signInGoogle(): Promise<UserCredential> {
  return signInWithPopup(requireAuth(), googleProvider);
}

export function signInGithub(): Promise<UserCredential> {
  return signInWithPopup(requireAuth(), githubProvider);
}

export function signInEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export function signUpEmail(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(requireAuth(), email, password);
}

export function signInAnonymously(): Promise<UserCredential> {
  return fbSignInAnonymously(requireAuth());
}

const MAGIC_LINK_EMAIL_KEY = 'aurial:magic-link-email';

/** Sends a passwordless sign-in link; completion happens on /login via completeMagicLink(). */
export async function sendMagicLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(requireAuth(), email, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(MAGIC_LINK_EMAIL_KEY, email);
}

/** Finishes a magic-link flow if the current URL is a sign-in link. Returns null otherwise. */
export async function completeMagicLink(): Promise<UserCredential | null> {
  if (!auth || !isSignInWithEmailLink(auth, window.location.href)) return null;
  let email = window.localStorage.getItem(MAGIC_LINK_EMAIL_KEY);
  if (!email) {
    email = window.prompt('Confirme seu e-mail para concluir o acesso');
  }
  if (!email) return null;
  const cred = await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem(MAGIC_LINK_EMAIL_KEY);
  return cred;
}

export function logout(): Promise<void> {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

/** Subscribe to auth state; immediately emits null in demo mode. */
export function subscribeAuth(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}

export type { User };
