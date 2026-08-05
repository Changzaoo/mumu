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

// ── ESCREVER SÓ O QUE MUDOU ─────────────────────────────────────
//
// A primeira versão disto ESTOUROU A COTA DIÁRIA do Firestore e derrubou o app
// inteiro — não só o acervo: `trending`, `shares` e a sincronia da biblioteca
// pessoal pararam junto, porque a cota é do projeto, não da coleção. Nada do
// que o admin adicionava chegava a ninguém, nem a ele.
//
// Foram duas torneiras abertas ao mesmo tempo:
//
//  1. `patchEntry` publicava a CADA remendo, e a curadoria de fundo remenda a
//     mesma faixa muitas vezes (capa, catálogo, dedupe, redrive, auditoria).
//     Cada remendo virava duas escritas: a nuvem pessoal e o acervo.
//  2. A migração republicava a biblioteca INTEIRA a cada abertura do app.
//     Trezentas faixas = trezentas escritas por recarga.
//
// A correção é lembrar o que já foi publicado. Guardamos uma impressão digital
// por faixa — só dos campos que o acervo mostra — e a escrita só acontece
// quando ela muda de verdade. Depois da primeira publicação, reabrir o app,
// rodar a curadoria e remendar metadata custam ZERO escrita.
const IMPRESSOES_KEY = 'radinho:acervoPublicado';
let impressoes: Record<string, string> | null = null;

function lerImpressoes(): Record<string, string> {
  if (impressoes) return impressoes;
  try {
    const cru: unknown = JSON.parse(window.localStorage.getItem(IMPRESSOES_KEY) ?? '{}');
    impressoes = cru && typeof cru === 'object' ? (cru as Record<string, string>) : {};
  } catch {
    impressoes = {};
  }
  return impressoes;
}

function gravarImpressoes(): void {
  try {
    window.localStorage.setItem(IMPRESSOES_KEY, JSON.stringify(impressoes ?? {}));
  } catch {
    /* cota cheia: no pior caso reescrevemos o acervo uma vez a mais */
  }
}

/** O que o acervo REALMENTE mostra. Mudou algo fora daqui, não vale escrita. */
function impressaoDigital(entry: LibraryEntry): string {
  return JSON.stringify([
    entry.track.title,
    entry.track.artists.map((a) => a.name).join('/'),
    entry.track.album?.title ?? '',
    entry.track.genre ?? '',
    entry.track.coverUrl ?? '',
    entry.track.durationMs,
    entry.remoteUrl ?? '',
    entry.sourceUrl ?? '',
  ]);
}

/**
 * Publica (ou atualiza) uma faixa no acervo do app.
 *
 * Chamado por toda mudança da biblioteca — em aparelho de usuário comum é um
 * no-op silencioso, e as regras do Firestore garantem isso mesmo se o cliente
 * for adulterado.
 */
export function publicarNoCatalogo(entry: LibraryEntry): void {
  // SEM ROTA PARA O ÁUDIO, NÃO ENTRA NO ACERVO.
  //
  // O catálogo é o índice; quem serve a música é o servidor Linux. A entrada só
  // vale se apontar para lá — `remoteUrl` (a cópia no cofre) ou `sourceUrl` (o
  // link, que o importador transmite ao vivo). Publicar antes disso colocava a
  // faixa na tela de todo mundo por alguns segundos sem nada para tocar, que é
  // o pior estado possível: parece que chegou e não toca.
  //
  // Não é perda: assim que o upload termina, `patchEntry` republica com a rota
  // pronta. O acervo só mostra o que dá para ouvir.
  if (!entry.remoteUrl && !entry.sourceUrl) return;
  const digital = impressaoDigital(entry);
  if (lerImpressoes()[entry.track.id] === digital) return; // nada mudou: sem escrita
  void (async () => {
    await firebaseReady();
    if (!db || !souAdmin()) return;
    const { doc, setDoc } = await firestore();
    await setDoc(doc(db, COLECAO, entry.track.id), entry);
    lerImpressoes()[entry.track.id] = digital;
    gravarImpressoes();
  })().catch((erro) => registrarErro(COLECAO, erro));
}

/** Tira uma faixa do acervo (admin apagou de vez). */
export function removerDoCatalogo(id: string): void {
  void (async () => {
    await firebaseReady();
    if (!db || !souAdmin()) return;
    const { deleteDoc, doc } = await firestore();
    await deleteDoc(doc(db, COLECAO, id));
    delete lerImpressoes()[id]; // some da memória também: republicar volta a valer
    gravarImpressoes();
  })().catch((erro) => registrarErro(COLECAO, erro));
}

/**
 * Sobe para o acervo o que o admin já tinha antes de o acervo existir.
 *
 * Sem esta varredura, só as faixas importadas DEPOIS desta versão chegariam aos
 * usuários e o acervo nasceria vazio. Mas ela era a maior das duas torneiras
 * que estouraram a cota: reescrevia a biblioteca INTEIRA a cada abertura do
 * app — trezentas faixas, trezentas escritas, por recarga.
 *
 * Agora a impressão digital manda: só sobe quem nunca subiu ou mudou. Depois
 * da primeira passada isto custa zero escrita, e o teto por rodada garante que
 * nem a primeira consegue esgotar a cota sozinha.
 */
const TETO_POR_RODADA = 200;

export async function publicarAcervoDoAdmin(entradas: LibraryEntry[]): Promise<number> {
  await firebaseReady();
  if (!db || !souAdmin()) return 0;
  const jaPublicadas = lerImpressoes();
  const pendentes = entradas.filter(
    (e) => (e.remoteUrl || e.sourceUrl) && jaPublicadas[e.track.id] !== impressaoDigital(e),
  );
  if (pendentes.length === 0) return 0;

  const { doc, setDoc } = await firestore();
  let publicadas = 0;
  for (const entry of pendentes.slice(0, TETO_POR_RODADA)) {
    try {
      await setDoc(doc(db, COLECAO, entry.track.id), entry);
      jaPublicadas[entry.track.id] = impressaoDigital(entry);
      publicadas += 1;
    } catch (erro) {
      registrarErro(COLECAO, erro);
      break; // cota estourada ou regra negando: insistir 300 vezes não ajuda
    }
    // Respiro entre escritas: uma rajada de centenas de setDoc trava a página
    // em aparelho modesto e ainda esbarra no limite de escrita do Firestore.
    await new Promise((r) => setTimeout(r, 40));
  }
  gravarImpressoes();
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
