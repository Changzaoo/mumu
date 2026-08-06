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
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';
import { registrarErro, registrarSnapshot, registrarUsuario } from '@/lib/sync/syncStatus';

const COLECAO = 'catalogo';

/**
 * QUEM BARRA A ESCRITA É A REGRA DO FIRESTORE, NÃO ESTE ARQUIVO.
 *
 * Antes havia uma segunda tranca aqui: uma lista de e-mails no cliente. Ela
 * parecia inofensiva e foi a provável causa do acervo ter ficado VAZIO — se a
 * conta usada para importar não fosse exatamente uma daquelas duas strings, a
 * publicação virava um `return` mudo, sem erro, sem log, sem nada na tela. Duas
 * trancas para a mesma porta, e a de dentro não avisava quando estava fechada.
 *
 * Agora o cliente SEMPRE tenta. Se a conta não tiver direito, o Firestore
 * recusa — e aí existe um erro de verdade, que o diagnóstico mostra e o admin
 * vê em forma de aviso. Falha visível vale mais que falha silenciosa.
 */
function talvezAdmin(): boolean {
  // Mantido só para decidir se vale AVISAR o usuário quando a escrita falha:
  // um ouvinte comum não precisa ver "falha ao publicar no acervo".
  return isAuthorizedEmail(auth?.currentUser?.email);
}

/**
 * O AVISO É PARA SER LIDO POR UMA PESSOA, NÃO COPIADO DE UM CONSOLE.
 *
 * A versão anterior colava a mensagem crua do erro na tela. Num caso real isso
 * virou dez linhas de despejo de pilha do SDK, com URLs de bundle e offsets de
 * byte, EM CIMA DO PLAYER, enquanto a música tocava:
 *
 *   Acervo: não consegui publicar — FIRESTORE (11.10.0) INTERNAL ASSERTION
 *   FAILED: Unexpected state (ID: b815) CONTEXT: {"hc":"The quota has been
 *   exceeded.\nsetItem@[native code]\nsetItem@https://…/firebase-gIWye2uh.js:
 *   3540:4679\nlo@…\naddPendingMutation@…"}
 *
 * Nada ali é acionável, e o pior: o assunto real era o armazenamento do
 * navegador estar cheio — não o acervo. Aqui cada falha conhecida vira uma
 * frase curta que diz O QUE FAZER, e o texto cru fica onde ele serve: no
 * relatório do /diagnostico, via `registrarErro`.
 *
 * O mesmo aviso também não se repete: a curadoria remenda faixas em rajada, e
 * sem trava a mesma falha empilhava um toast por faixa.
 */
let ultimoAviso = '';

function traduzirFalha(erro: unknown): string {
  const cru = erro instanceof Error ? erro.message : String(erro);
  // Cofre do navegador cheio. Chega aqui disfarçado de erro do Firestore porque
  // o SDK estoura por dentro quando não consegue gravar — ver cofreLocal.ts.
  if (/quota has been exceeded|QuotaExceededError/i.test(cru)) {
    return 'O armazenamento deste navegador encheu. Liberei espaço automaticamente — se voltar a aparecer, limpe os dados do site.';
  }
  if (/RESOURCE_EXHAUSTED|Quota exceeded/i.test(cru)) {
    return 'A cota diária do Firestore acabou. O acervo volta a publicar sozinho amanhã.';
  }
  if (/permission|PERMISSION_DENIED|insufficient/i.test(cru)) {
    return 'As regras do Firestore recusaram a escrita no acervo. Confira em /diagnostico com qual conta você está.';
  }
  if (/offline|unavailable|network/i.test(cru)) {
    return 'Sem conexão com o servidor agora — o acervo publica sozinho quando a rede voltar.';
  }
  // Desconhecido: uma linha só, cortada. O texto inteiro está no /diagnostico.
  return `Não consegui publicar no acervo (${cru.split('\n')[0]?.slice(0, 90) ?? 'erro'}). Detalhes em /diagnostico.`;
}

/** Avisa o admin quando o acervo recusa uma escrita — silêncio aqui foi o que
 *  custou dias de procura no lugar errado. */
function avisarFalha(erro: unknown): void {
  registrarErro(COLECAO, erro); // o texto CRU vive aqui, para o /diagnostico
  if (!talvezAdmin()) return;
  const mensagem = traduzirFalha(erro);
  if (mensagem === ultimoAviso) return; // uma rajada de falhas = um aviso
  ultimoAviso = mensagem;
  void import('sonner')
    .then(({ toast }) => toast.error(mensagem, { duration: 6000 }))
    .catch(() => undefined);
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
  // Cota cheia: no pior caso reescrevemos o acervo uma vez a mais — e é por
  // isso que estas impressões são sacrificáveis. Ver lib/local/cofreLocal.ts.
  gravarCache(IMPRESSOES_KEY, JSON.stringify(impressoes ?? {}), 300_000);
}

registrarDescartavel(IMPRESSOES_KEY, 30, () => {
  impressoes = null;
});

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
export function publicarNoCatalogo(entry: LibraryEntry, forcar = false): void {
  // A SEGUNDA TRANCA QUE EU TINHA POSTO AQUI SAIU.
  //
  // Era "sem remoteUrl nem sourceUrl, não entra", para evitar faixa que aparece
  // e não toca. O raciocínio estava certo e a consequência estava errada: se o
  // cofre do importador estiver fora do ar na hora do upload, NENHUMA faixa
  // ganha rota, e o acervo inteiro fica vazio — que é infinitamente pior. Não
  // aparecer é o defeito que o usuário relatou; aparecer e não tocar é um
  // aviso que o /diagnostico já dá, com contagem.
  const digital = impressaoDigital(entry);
  if (!forcar && lerImpressoes()[entry.track.id] === digital) return; // nada mudou
  void (async () => {
    await firebaseReady();
    if (!db) return;
    const { doc, setDoc } = await firestore();
    await setDoc(doc(db, COLECAO, entry.track.id), entry);
    lerImpressoes()[entry.track.id] = digital;
    gravarImpressoes();
  })().catch(avisarFalha);
}

/** Tira uma faixa do acervo (admin apagou de vez). */
export function removerDoCatalogo(id: string): void {
  void (async () => {
    await firebaseReady();
    if (!db) return; // quem barra é a regra do Firestore — ver publicarNoCatalogo
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

/**
 * Compara a biblioteca com o que o acervo TEM DE VERDADE e sobe a diferença.
 *
 * Substitui a migração antiga, que confiava numa marca local de "já publiquei".
 * Essa marca é uma memória do cliente, e memória de cliente mente: durante a
 * cota estourada as escritas falhavam e, na versão anterior, bastava um deslize
 * para o aparelho passar a acreditar que tinha publicado algo que nunca saiu —
 * e nunca mais tentar. Foi assim que o acervo ficou vazio e continuou vazio.
 *
 * Aqui não há memória envolvida: `idsNoAcervo` vem do snapshot que a assinatura
 * já trouxe (custo zero de leitura), e o que falta é republicado à força. Se
 * alguma coisa impedir a escrita, a próxima abertura tenta de novo, porque a
 * comparação é sempre contra a realidade.
 */
export async function reconciliarAcervo(
  minhasEntradas: LibraryEntry[],
  idsNoAcervo: ReadonlySet<string>,
): Promise<number> {
  await firebaseReady();
  if (!db) return 0;
  const faltando = minhasEntradas.filter((e) => !idsNoAcervo.has(e.track.id));
  if (faltando.length === 0) return 0;

  const { doc, setDoc } = await firestore();
  let publicadas = 0;
  for (const entry of faltando.slice(0, TETO_POR_RODADA)) {
    try {
      await setDoc(doc(db, COLECAO, entry.track.id), entry);
      lerImpressoes()[entry.track.id] = impressaoDigital(entry);
      publicadas += 1;
    } catch (erro) {
      avisarFalha(erro);
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
