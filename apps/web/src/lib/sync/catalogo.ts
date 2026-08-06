/**
 * ACERVO DO APP — o que o admin adiciona, todo mundo ouve.
 *
 * Por que isto existe: até aqui "as músicas do app" eram, na verdade, a
 * biblioteca PRIVADA de quem as importou. O usuário comum abria o app, via a
 * própria biblioteca (vazia) e concluía, com razão, que o app não tinha música
 * nenhuma. Não era sincronia quebrada: o acervo compartilhado não existia.
 *
 * Como funciona:
 *   admin importa → entra na biblioteca dele → espelhado no NOSSO SERVIDOR
 *   qualquer usuário → assina o acervo → as faixas entram na biblioteca local
 *
 * Por que entra na biblioteca local em vez de virar uma prateleira à parte: a
 * Home, a busca, artistas, gêneros e álbuns são todos montados a partir dela.
 * Entrando ali, o acervo aparece em TODA a interface sem uma linha de UI nova.
 *
 * ONDE O ACERVO MORA — E POR QUE MUDOU DE CASA. Ele viveu no Firestore, e a
 * conta não fechava: a coleção INTEIRA era lida a cada abertura do app, por
 * cada pessoa, mais a varredura horária do worker. O limite grátis de 50 mil
 * leituras/dia é do PROJETO, então quando estourava caía tudo junto — acervo,
 * sincronia entre aparelhos, curtidas. Aconteceu três vezes. Agora ele vive no
 * nosso servidor (ver lib/sync/catalogoApi.ts), que já era dependência dura
 * para ouvir: todo áudio sai de lá. O Firebase continua cuidando do login.
 *
 * O que toca no aparelho do usuário: a entrada carrega `remoteUrl` (a cópia
 * enviada ao importador) e `sourceUrl` (o link original). O player já resolve
 * os dois — ver `ensurePlayableSource` em stores/playerStore.ts.
 */
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { auth } from '@/lib/firebase';
import { isAuthorizedEmail } from '@/lib/auth/roles';
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';
import { publicarEntrada, publicarLote, removerEntrada } from '@/lib/sync/catalogoApi';
import { registrarErro } from '@/lib/sync/syncStatus';

export { subscribeCatalogo } from '@/lib/sync/catalogoApi';

const COLECAO = 'catalogo';

/**
 * QUEM BARRA A ESCRITA É O SERVIDOR, NÃO ESTE ARQUIVO.
 *
 * Antes havia uma tranca aqui: uma lista de e-mails no cliente. Ela parecia
 * inofensiva e foi a causa do acervo ter ficado VAZIO — se a conta usada para
 * importar não fosse exatamente uma daquelas strings, a publicação virava um
 * `return` mudo, sem erro, sem log, sem nada na tela. Duas trancas para a mesma
 * porta, e a de dentro não avisava quando estava fechada.
 *
 * Agora o cliente SEMPRE tenta. Se a conta não tiver direito, o servidor recusa
 * — e aí existe um erro de verdade, que o diagnóstico mostra.
 */
function talvezAdmin(): boolean {
  // Mantido só para decidir se vale AVISAR: um ouvinte comum não precisa ver
  // "falha ao publicar no acervo".
  return isAuthorizedEmail(auth?.currentUser?.email);
}

/**
 * O AVISO É PARA SER LIDO POR UMA PESSOA, NÃO COPIADO DE UM CONSOLE.
 *
 * A versão anterior colava a mensagem crua do erro na tela. Num caso real isso
 * virou dez linhas de despejo de pilha do SDK, com URLs de bundle e offsets de
 * byte, EM CIMA DO PLAYER, com a música tocando. Nada ali era acionável.
 */
let ultimoAviso = '';

function traduzirFalha(erro: unknown): string | null {
  const cru = erro instanceof Error ? erro.message : String(erro);
  if (/HTTP 401|HTTP 403/.test(cru)) {
    return 'O servidor recusou a publicação no acervo — confira em /diagnostico com qual conta você está.';
  }
  if (/HTTP 5\d\d/.test(cru)) {
    return 'O servidor do acervo respondeu com erro. Ele tenta de novo sozinho na próxima abertura.';
  }
  if (/Failed to fetch|NetworkError|offline/i.test(cru)) {
    return null; // sem rede: tenta de novo sozinho, não há o que avisar
  }
  return `Não consegui publicar no acervo (${cru.split('\n')[0]?.slice(0, 90) ?? 'erro'}). Detalhes em /diagnostico.`;
}

function avisarFalha(erro: unknown): void {
  registrarErro(COLECAO, erro); // o texto CRU vive aqui, para o /diagnostico
  const mensagem = traduzirFalha(erro);
  if (!mensagem) return;
  if (!talvezAdmin()) return;
  if (mensagem === ultimoAviso) return; // uma rajada de falhas = um aviso
  ultimoAviso = mensagem;
  void import('sonner')
    .then(({ toast }) => toast.error(mensagem, { duration: 6000 }))
    .catch(() => undefined);
}

// ── ESCREVER SÓ O QUE MUDOU ─────────────────────────────────────
//
// A primeira versão disto ESTOUROU A COTA DIÁRIA do Firestore e derrubou o app
// inteiro. Foram duas torneiras: `patchEntry` publicava a CADA remendo (e a
// curadoria remenda a mesma faixa muitas vezes — capa, catálogo, dedupe), e a
// migração republicava a biblioteca INTEIRA a cada abertura do app.
//
// O acervo saiu do Firestore, mas a lição fica: cada publicação atravessa o
// túnel de casa, e trezentas por recarga são trezentas idas e voltas numa
// máquina de dois núcleos. A impressão digital abaixo continua valendo — depois
// da primeira publicação, reabrir o app e rodar a curadoria custam ZERO envio.
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
  // Cota cheia: no pior caso reenviamos o acervo uma vez a mais — e é por isso
  // que estas impressões são sacrificáveis. Ver lib/local/cofreLocal.ts.
  gravarCache(IMPRESSOES_KEY, JSON.stringify(impressoes ?? {}), 300_000);
}

registrarDescartavel(IMPRESSOES_KEY, 30, () => {
  impressoes = null;
});

/** O que o acervo REALMENTE mostra. Mudou algo fora daqui, não vale envio. */
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
 * Chamado por toda mudança da biblioteca — em aparelho de usuário comum o
 * servidor recusa, e é ele quem decide, não este arquivo.
 */
export function publicarNoCatalogo(entry: LibraryEntry, forcar = false): void {
  // A SEGUNDA TRANCA QUE EU TINHA POSTO AQUI SAIU.
  //
  // Era "sem remoteUrl nem sourceUrl, não entra", para evitar faixa que aparece
  // e não toca. O raciocínio estava certo e a consequência estava errada: se o
  // cofre do importador estiver fora do ar na hora do upload, NENHUMA faixa
  // ganha rota, e o acervo inteiro fica vazio — que é infinitamente pior.
  const digital = impressaoDigital(entry);
  if (!forcar && lerImpressoes()[entry.track.id] === digital) return; // nada mudou
  void (async () => {
    await publicarEntrada(entry);
    lerImpressoes()[entry.track.id] = digital;
    gravarImpressoes();
  })().catch(avisarFalha);
}

/** Tira uma faixa do acervo (admin apagou de vez). */
export function removerDoCatalogo(id: string): void {
  void (async () => {
    await removerEntrada(id);
    delete lerImpressoes()[id]; // some da memória também: republicar volta a valer
    gravarImpressoes();
  })().catch((erro) => registrarErro(COLECAO, erro));
}

/**
 * Compara a biblioteca com o que o acervo TEM DE VERDADE e sobe a diferença.
 *
 * Substitui a migração antiga, que confiava numa marca local de "já publiquei".
 * Marca de cliente mente: bastava um deslize para o aparelho passar a acreditar
 * que tinha publicado algo que nunca saiu — e nunca mais tentar. Foi assim que
 * o acervo ficou vazio e continuou vazio.
 *
 * Aqui não há memória envolvida: `idsNoAcervo` vem do snapshot que a assinatura
 * já trouxe, e o que falta é republicado. Se algo impedir o envio, a próxima
 * abertura tenta de novo, porque a comparação é sempre contra a realidade.
 */
const TETO_POR_RODADA = 200;
/** Faixas por requisição — o servidor aceita até 500; 100 mantém o corpo leve. */
const POR_LOTE = 100;

export async function reconciliarAcervo(
  minhasEntradas: LibraryEntry[],
  idsNoAcervo: ReadonlySet<string>,
): Promise<number> {
  const faltando = minhasEntradas.filter((e) => !idsNoAcervo.has(e.track.id));
  if (faltando.length === 0) return 0;

  const alvo = faltando.slice(0, TETO_POR_RODADA);
  let publicadas = 0;
  for (let i = 0; i < alvo.length; i += POR_LOTE) {
    const lote = alvo.slice(i, i + POR_LOTE);
    try {
      publicadas += await publicarLote(lote);
      for (const entry of lote) lerImpressoes()[entry.track.id] = impressaoDigital(entry);
    } catch (erro) {
      avisarFalha(erro);
      break; // servidor fora do ar ou recusando: insistir não ajuda
    }
  }
  gravarImpressoes();
  return publicadas;
}
