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

/**
 * LOGIN NO PRÓPRIO DOMÍNIO — para o Google entrar NA MESMA ABA.
 *
 * Com o `authDomain` em `<projeto>.firebaseapp.com`, o login passa por uma
 * página de OUTRO site. Navegador que particiona o armazenamento por site
 * (Brave, Safari, Firefox, Chrome recente) não deixa essa página ler o estado
 * que o app guardou, e ela morre com "Unable to process request due to missing
 * initial state" — foi o que o dono viu no Brave do Android.
 *
 * A saída é servir essa página pelo NOSSO domínio: o `vercel.json` repassa
 * `/__/auth/*` ao Firebase e o `authDomain` vira o host do app. Aí tudo é o
 * mesmo site e dá para usar o redirecionamento na própria aba.
 *
 * SÓ ENTRA NA LISTA o domínio cujo endereço `https://<host>/__/auth/handler`
 * já está nos "URIs de redirecionamento autorizados" do cliente OAuth no Google
 * Cloud — sem isso o Google recusa TODO login com `redirect_uri_mismatch`.
 */
const DOMINIOS_COM_LOGIN_PROPRIO: readonly string[] = [];

const loginNoProprioDominio =
  typeof window !== 'undefined' && DOMINIOS_COM_LOGIN_PROPRIO.includes(window.location.host);

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: loginNoProprioDominio
    ? window.location.host
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
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
 * HÁ UMA SESSÃO SALVA NESTE APARELHO?
 *
 * O SDK guarda o usuário logado no IndexedDB (`firebaseLocalStorageDb`). Ler
 * isso custa microssegundos e NÃO precisa do SDK de ~140 kB comprimidos — e é a
 * resposta que decide se vale baixá-lo no boot:
 *
 *  - 'sim'     → restaura o login já (o app precisa saber quem é o usuário);
 *  - 'nao'     → visitante anônimo: ninguém para restaurar, o SDK só será
 *                baixado quando algo REALMENTE pedir (login, link de e-mail,
 *                abrir um compartilhamento público);
 *  - 'incerto' → não deu para ler (IndexedDB bloqueado, navegador antigo): na
 *                dúvida, carrega como antes — deslogar alguém por engano é pior
 *                do que gastar a banda.
 *
 * A abertura é abortada no `onupgradeneeded`: se o banco NÃO existe, não pode
 * ser CRIADO aqui (vazio e na versão 1 ele faria o SDK pular a criação do
 * object store e nunca mais persistir login).
 */
type SessaoSalva = 'sim' | 'nao' | 'incerto';

async function lerSessaoSalva(): Promise<SessaoSalva> {
  if (authDisabled) return 'nao';
  // Link de login por e-mail / retorno de OAuth: o SDK precisa processar a URL.
  const url = `${window.location.search}${window.location.hash}`;
  if (/[?&#]oobCode=/.test(url)) return 'sim';
  // Voltando do Google pelo redirecionamento: o SDK deixou esta marca antes de
  // sair e é ele quem conclui o login ao subir. Sem carregá-lo aqui, a pessoa
  // voltaria do Google e continuaria deslogada.
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      if (window.sessionStorage.key(i)?.startsWith('firebase:pendingRedirect:')) return 'sim';
    }
  } catch {
    /* sessionStorage bloqueado: não há redirecionamento a concluir */
  }
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      if (window.localStorage.key(i)?.startsWith('firebase:authUser:')) return 'sim';
    }
  } catch {
    /* localStorage bloqueado: segue para o IndexedDB */
  }
  if (typeof indexedDB === 'undefined') return 'incerto';
  return new Promise<SessaoSalva>((resolve) => {
    let aberto: IDBOpenDBRequest;
    try {
      aberto = indexedDB.open('firebaseLocalStorageDb');
    } catch {
      resolve('incerto');
      return;
    }
    aberto.onupgradeneeded = () => {
      // Banco inexistente: desfaz a criação (ver o comentário acima).
      aberto.transaction?.abort();
      resolve('nao');
    };
    aberto.onerror = () => resolve((aberto.error?.name ?? '') === 'AbortError' ? 'nao' : 'incerto');
    aberto.onblocked = () => resolve('incerto');
    aberto.onsuccess = () => {
      const conexao = aberto.result;
      try {
        if (!conexao.objectStoreNames.contains('firebaseLocalStorage')) {
          conexao.close();
          resolve('nao');
          return;
        }
        const contagem = conexao
          .transaction('firebaseLocalStorage', 'readonly')
          .objectStore('firebaseLocalStorage')
          .count();
        contagem.onsuccess = () => {
          conexao.close();
          resolve(contagem.result > 0 ? 'sim' : 'nao');
        };
        contagem.onerror = () => {
          conexao.close();
          resolve('incerto');
        };
      } catch {
        conexao.close();
        resolve('incerto');
      }
    };
  });
}

/**
 * Não bloqueia: começa na avaliação do módulo (leitura local, instantânea) e as
 * decisões abaixo esperam por ela. Falha de leitura vira 'incerto'.
 */
const sessaoSalva: Promise<SessaoSalva> = lerSessaoSalva().catch(() => 'incerto' as const);

/** Memo do carregamento do SDK — `null` enquanto ninguém precisou dele. */
let sdkPromise: Promise<void> | null = null;
/** O módulo `firebase/auth` já resolvido por `carregarSdk` (evita um 2º `import()`). */
let authApi: typeof import('firebase/auth') | null = null;

/**
 * Sobe o SDK uma única vez (idempotente) e resolve mesmo em caso de falha —
 * quem espera por isto quer saber "a janela de carregamento acabou", não "deu
 * certo"; o teste de verdade continua sendo `if (!db)`.
 */
function carregarSdk(): Promise<void> {
  if (authDisabled) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  const subindo = (async () => {
    try {
      const [{ initializeApp }, authMod, storeMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);
      const app = initializeApp(config);
      authApi = authMod;
      auth = authMod.getAuth(app);
      auth.languageCode = 'pt-BR';
      db = criarFirestore(app, storeMod);
    } catch {
      // Sem SDK o app continua inteiro no modo local: biblioteca, reprodução
      // e importação não dependem da nuvem. Só a sincronia fica de fora.
    }
    marcarBoot('firebase-pronto');
  })();
  sdkPromise = subindo;
  // Quem assinou o estado de login ANTES de o SDK existir (anônimo que acabou de
  // pedir login) passa a ser notificado por ele.
  void subindo.then(() => {
    if (assinantes.size > 0) void ligarOuvinteDoSdk();
  });
  return subindo;
}

// Sessão salva (ou dúvida) → restaura o login logo, em paralelo com a primeira
// pintura (é `import()` assíncrono: não bloqueia render). Visitante anônimo →
// o SDK não é baixado até alguém pedir.
void sessaoSalva.then((s) => {
  if (s !== 'nao') void carregarSdk();
});

/**
 * Resolve quando o SDK que ESTÁ para subir (ou subiu) terminou. Não força o
 * download para o visitante anônimo — nada a restaurar. Para forçar, use
 * `carregarFirebase()`.
 */
async function sdkSeHouver(): Promise<void> {
  if (!sdkPromise && (await sessaoSalva) === 'nao') return;
  await carregarSdk();
}

/**
 * Firestore COM cache em disco.
 *
 * Sem isto o cache é só de memória: toda abertura do app buscava a coleção
 * `users/{uid}/library` inteira na rede antes de qualquer música da nuvem
 * aparecer na tela — e offline não aparecia nunca. Com o cache persistente, o
 * primeiro snapshot sai do IndexedDB na hora e a rede vira só o delta.
 *
 * ABA ÚNICA, DE PROPÓSITO — o gerente MULTI-ABA usa o localStorage.
 *
 * Ele parecia a escolha óbvia (o app abre em várias abas com frequência) e foi
 * o que estourou na cara do usuário, POR CIMA DA MÚSICA TOCANDO:
 *
 *   FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
 *   CONTEXT: {"hc":"The quota has been exceeded.\nsetItem@[native code]…
 *             addPendingMutation@…"}
 *
 * O cache em si mora no IndexedDB, que tem cota de gigabytes. Mas o gerente
 * multi-aba avisa as outras abas pelo localStorage e grava uma marca A CADA
 * MUTAÇÃO (`addPendingMutation`). O localStorage tem ~5 MB e estava cheio de
 * cache de letra — então esse `setItem` falhava, e o SDK trata falha ali como
 * estado impossível: dispara a asserção interna e DERRUBA O CLIENTE. Curtir uma
 * faixa, registrar uma escuta, qualquer escrita virava esse despejo de pilha.
 *
 * O gerente de aba única não encosta no localStorage — usa memória para
 * coordenar. O preço é conhecido e pequeno: numa SEGUNDA aba a persistência não
 * é assumida e ela roda com cache de memória (busca da rede, funciona igual).
 * Trocar uma aba secundária mais lenta por um cliente que não quebra no meio da
 * reprodução não é uma decisão difícil.
 *
 * O cofre cheio também foi tapado na origem — ver lib/local/cofreLocal.ts — mas
 * essa correção depende do cofre; esta aqui não depende de nada.
 */
function criarFirestore(app: FirebaseApp, mod: FirestoreModule): Firestore {
  try {
    return mod.initializeFirestore(app, {
      localCache: mod.persistentLocalCache({
        tabManager: mod.persistentSingleTabManager({ forceOwnership: false }),
      }),
    });
  } catch {
    return mod.getFirestore(app);
  }
}

/**
 * Resolve quando `auth`/`db` já estão definidos (ou o SDK falhou/está
 * desligado/não há sessão para restaurar). NÃO baixa o SDK para o anônimo: quem
 * precisa do Firestore mesmo sem login (link público de compartilhamento) chama
 * `carregarFirebase()`.
 */
export function firebaseReady(): Promise<void> {
  return sdkSeHouver();
}

/** Força o carregamento do SDK (idempotente) e espera `auth`/`db` ficarem prontos. */
export function carregarFirebase(): Promise<void> {
  return carregarSdk();
}

async function requireAuth(): Promise<Auth> {
  await carregarSdk();
  if (!auth) {
    throw new Error('Login indisponível no modo demonstração. Configure o Firebase no .env.local.');
  }
  return auth;
}

/** Current user's ID token (Firebase caches and refreshes internally). Null when signed out. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  await sdkSeHouver(); // anônimo sem sessão: sem token, sem baixar o SDK
  const user = auth?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

/**
 * Só leitura do ANIVERSÁRIO (People API). É o que tira do usuário a pergunta de
 * "quando você nasceu?": a conta Google já sabe. Ver lib/auth/nascimentoGoogle.ts.
 */
export const ESCOPO_ANIVERSARIO = 'https://www.googleapis.com/auth/user.birthday.read';

/**
 * Pedir o aniversário JÁ NO LOGIN só depois de o Google aprovar o escopo
 * (People API ativa + escopo verificado na tela de consentimento). Antes disso
 * todo login mostraria "app não verificado" — o botão no diálogo de idade
 * continua pedindo sob demanda. Liga com VITE_GOOGLE_ANIVERSARIO_NO_LOGIN=1.
 */
const ANIVERSARIO_NO_LOGIN = import.meta.env.VITE_GOOGLE_ANIVERSARIO_NO_LOGIN === '1';

function telaDeToque(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Login com Google (com o aniversário, se ligado); devolve o token OAuth junto. */
export async function signInGoogle(): Promise<UserCredential & { accessToken: string | null }> {
  const [instance, { GoogleAuthProvider, signInWithPopup, signInWithRedirect }] = await Promise.all(
    [requireAuth(), import('firebase/auth')],
  );
  const provider = new GoogleAuthProvider();
  if (ANIVERSARIO_NO_LOGIN) provider.addScope(ESCOPO_ANIVERSARIO);
  // No celular o "popup" é outra aba — a pessoa sai do app e, em navegador que
  // particiona armazenamento, nem volta. Com o login no próprio domínio, vai e
  // volta do Google NA MESMA ABA; o SDK conclui o login ao recarregar (ver
  // `lerSessaoSalva`). A promessa não resolve: a página está saindo.
  if (loginNoProprioDominio && telaDeToque()) {
    await signInWithRedirect(instance, provider);
    return new Promise(() => {});
  }
  const result = await signInWithPopup(instance, provider);
  const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null;
  return Object.assign(result, { accessToken });
}

/**
 * Para quem JÁ está logado com Google: pede de novo à conta, agora com o
 * escopo do aniversário, e devolve o token OAuth. Null se não é conta Google.
 */
export async function tokenGoogleComAniversario(): Promise<string | null> {
  const [instance, { GoogleAuthProvider, reauthenticateWithPopup }] = await Promise.all([
    requireAuth(),
    import('firebase/auth'),
  ]);
  const user = instance.currentUser;
  if (!user || !user.providerData.some((p) => p.providerId === 'google.com')) return null;
  const provider = new GoogleAuthProvider();
  provider.addScope(ESCOPO_ANIVERSARIO);
  provider.setCustomParameters({ login_hint: user.email ?? '' });
  const result = await reauthenticateWithPopup(user, provider);
  return GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null;
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
  // Só precisa do SDK se a URL é mesmo um link de login — senão a página de
  // login abriria baixando o Firebase à toa.
  if (!/[?&]oobCode=/.test(window.location.search)) return null;
  await carregarSdk();
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
  await sdkSeHouver();
  if (!auth) return;
  const { signOut } = await import('firebase/auth');
  return signOut(auth);
}

/**
 * Subscribe to auth state; immediately emits null in demo mode.
 *
 * Assinar ANTES de o SDK subir é o caso normal (todo consumidor de boot cai
 * aqui). Três situações:
 *  - sessão salva / dúvida: a assinatura fica pendurada e o estado vem do SDK;
 *  - visitante anônimo: emite `null` assim que a leitura local confirma que não
 *    há sessão — SEM baixar o SDK. Se depois alguém fizer login (o SDK sobe sob
 *    demanda), o mesmo SDK passa a notificar esta assinatura;
 *  - SDK que falhou: emite `null` e o app segue como deslogado.
 * Cancelar antes de qualquer uma delas também precisa funcionar.
 */
const assinantes = new Set<(user: User | null) => void>();
/** Último estado conhecido; `undefined` = ainda não se sabe. */
let estadoDeAuth: User | null | undefined;
let ouvindoSdk = false;

function emitirAuth(user: User | null): void {
  if (estadoDeAuth === user) return;
  estadoDeAuth = user;
  for (const cb of [...assinantes]) cb(user);
}

/** Liga o ouvinte ÚNICO do SDK (uma vez), depois de ele estar pronto. */
async function ligarOuvinteDoSdk(): Promise<void> {
  if (ouvindoSdk) return;
  ouvindoSdk = true;
  await carregarSdk();
  if (!auth || !authApi) {
    emitirAuth(null);
    return;
  }
  authApi.onAuthStateChanged(auth, emitirAuth);
}

export function subscribeAuth(callback: (user: User | null) => void): () => void {
  if (authDisabled) {
    callback(null);
    return () => undefined;
  }
  assinantes.add(callback);
  if (estadoDeAuth !== undefined) {
    // Já se sabe quem é: entrega assíncrono, como o SDK faria.
    const atual = estadoDeAuth;
    void Promise.resolve().then(() => {
      if (assinantes.has(callback) && estadoDeAuth === atual) callback(atual);
    });
  }
  void sessaoSalva.then((s) => {
    if (s === 'nao' && !sdkPromise) {
      emitirAuth(null); // anônimo: sabido sem o SDK
    } else {
      void ligarOuvinteDoSdk();
    }
  });
  return () => {
    assinantes.delete(callback);
  };
}

export type { User };
