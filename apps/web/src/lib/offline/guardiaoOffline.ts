/**
 * GUARDIÃO DO OFFLINE — "se você viu a música, ela toca. Sem mais e sem menos."
 *
 * O problema que ele resolve: uma faixa aparecia na lista, você tocava, e ela
 * não vinha — porque os bytes moram no servidor de casa e ele podia estar fora
 * do ar, com a internet caindo ou o túnel derrubado. A faixa estava ali,
 * visível, clicável, e mentia.
 *
 * A única resposta honesta para isso é ter os bytes ANTES de precisar deles. O
 * player já prefere o áudio local (ver `ensurePlayableSource`); o que faltava
 * era alguém garantir que ele exista. É este arquivo.
 *
 * ── AS TRÊS COISAS QUE ELE NÃO PODE FAZER ──
 *
 * 1. NÃO PODE ATRAPALHAR A MÚSICA. Baixar é enfeite; ouvir é o serviço. Ele
 *    pausa enquanto uma faixa está tocando e só trabalha uma por vez, com
 *    respiro. Um `repairMissingAudio` automático já foi ligado no boot uma vez e
 *    virou um estrago: o celular, que só deveria transmitir, saiu baixando
 *    centenas de músicas de uma vez.
 *
 * 2. NÃO PODE ENCHER O APARELHO. Ele respeita a cota real do navegador
 *    (`navigator.storage.estimate`) e para bem antes do limite. Encher o
 *    armazenamento não quebraria só o app — quebraria o navegador da pessoa.
 *
 * 3. NÃO PODE BAIXAR NA ORDEM ERRADA. Uma biblioteca grande não cabe inteira, e
 *    baixar a esmo garante que o que você vai ouvir agora seja justamente o que
 *    faltou. Daí a ordem de prioridade abaixo — que é função pura e testada.
 */
import * as albunsOffline from '@/lib/local/albunsOffline';
import {
  albumKeyForTrack,
  garantirAudioLocal,
  hasLocalAudio,
  list,
  subscribe,
} from '@/lib/local/localLibrary';
import type { LibraryEntry } from '@/lib/local/localLibrary';

/** Espera entre downloads — o aparelho e o túnel de casa agradecem. */
const RESPIRO_MS = 1_500;
/** Começa depois do boot: a primeira tela é prioridade absoluta. */
const ATRASO_INICIAL_MS = 40_000;
/** Reavalia quando a biblioteca muda, sem correr atrás de cada mudança. */
const DEBOUNCE_MS = 15_000;
/** Teto de faixas por rodada — nunca uma rajada. */
const POR_RODADA = 25;
/**
 * Fração da cota do navegador que podemos ocupar.
 *
 * 0,5 é conservador de propósito: a cota é COMPARTILHADA com o cache de áudio
 * já baixado, as capas, o acervo e a fila offline. Ocupar tudo faria o navegador
 * despejar justamente o que acabamos de gravar — trabalho perdido e faixa que
 * some depois de "baixada".
 */
const FATIA_DA_COTA = 0.5;

export interface ContextoDeEscuta {
  /**
   * A FILA INTEIRA daqui para a frente, na ordem em que vai tocar.
   *
   * Já foi só "as próximas 7". A intenção era boa — priorizar o que toca em
   * segundos — mas o efeito era que sair do alcance do sinal no meio de uma
   * playlist parava a música na oitava faixa, que é exatamente a situação em
   * que o offline precisava existir. Mandar a fila toda não cria rajada: o
   * guardião continua baixando uma por vez, com respiro, e parando na cota. O
   * que muda é que ele passa a saber para onde a lista vai.
   */
  aSeguir: string[];
  /** Ids tocados recentemente, do mais recente para o mais antigo. */
  recentes: string[];
}

/**
 * A ORDEM DE QUEM BAIXA PRIMEIRO.
 *
 * Função pura para poder ser testada de verdade: é a decisão que separa "o
 * offline funciona" de "o offline funciona para faixas que você não ia ouvir".
 *
 * A ordem é a do risco de decepção:
 *   1. o que toca daqui a pouco (a fila inteira) — errar aqui é errar na cara
 *      da pessoa, e ela está com o aparelho na mão;
 *   2. os álbuns que ela MARCOU para levar (lib/local/albunsOffline) — é a
 *      única prioridade que a automação não tem como adivinhar sozinha, porque
 *      não está no que ela tocou nem no que vai tocar: está no que ela planeja;
 *   3. o que ela ouve sempre (o histórico) — é o que vai procurar sem sinal;
 *   4. o resto da biblioteca, do mais novo para o mais velho.
 *
 * Fica de fora quem já tem áudio aqui e quem NÃO TEM ROTA nenhuma para baixar
 * (nem cópia no importador, nem link de origem). Essa segunda exclusão importa:
 * sem ela, a varredura tentaria para sempre as mesmas faixas impossíveis e
 * nunca chegaria nas que dá.
 */
export function ordemDeDownload(
  entradas: readonly LibraryEntry[],
  contexto: ContextoDeEscuta,
  jaTem: (id: string) => boolean,
  /** Chaves de álbum que a pessoa marcou para levar (ver albunsOffline). */
  fixados: ReadonlySet<string> = new Set(),
): LibraryEntry[] {
  const candidatas = entradas.filter(
    // `tocavel` cobre a entrada MAGRA do acervo, que não traz mais URL — só o
    // bit. Sem ele, o guardião concluiria que nada tem rota e o offline pararia
    // de existir para o acervo inteiro.
    (e) =>
      !jaTem(e.track.id) &&
      (e.remoteUrl || e.sourceUrl || e.tocavel === true) &&
      !e.track.previewOnly,
  );
  const porId = new Map(candidatas.map((e) => [e.track.id, e]));

  const fila: LibraryEntry[] = [];
  const visto = new Set<string>();
  const empurrar = (id: string): void => {
    const entrada = porId.get(id);
    if (!entrada || visto.has(id)) return;
    visto.add(id);
    fila.push(entrada);
  };

  for (const id of contexto.aSeguir) empurrar(id);
  // Os álbuns marcados vêm inteiros, na ordem em que aparecem na biblioteca —
  // um álbum pela metade no avião não é "álbum disponível offline".
  if (fixados.size > 0) {
    for (const entrada of candidatas) {
      const chave = albumKeyForTrack(entrada.track);
      if (chave && fixados.has(chave)) empurrar(entrada.track.id);
    }
  }
  for (const id of contexto.recentes) empurrar(id);
  for (const entrada of candidatas) empurrar(entrada.track.id);
  return fila;
}

/**
 * Ainda cabe? Devolve `true` quando vale a pena continuar baixando.
 *
 * Sem `storage.estimate` (navegadores antigos, Safari em certos modos) a
 * resposta é `true`: o `putBlob` da biblioteca já falha e cai para o IndexedDB
 * quando a cota estoura, então o pior caso é uma tentativa perdida — não um
 * aparelho lotado sem aviso.
 */
export async function cabeMaisAudio(): Promise<boolean> {
  try {
    const estimativa = await navigator.storage?.estimate?.();
    if (!estimativa?.quota || estimativa.usage === undefined) return true;
    return estimativa.usage < estimativa.quota * FATIA_DA_COTA;
  } catch {
    return true;
  }
}

// ── plantão ─────────────────────────────────────────────────────────────────

let iniciado = false;
let rodando = false;
let acordarTimer: ReturnType<typeof setTimeout> | null = null;
let contexto: ContextoDeEscuta = { aSeguir: [], recentes: [] };

/**
 * O player conta o que está por vir. Sem isto o guardião baixaria pela ordem da
 * biblioteca, e a faixa que você mandou tocar agora seria a última da fila.
 */
export function informarContexto(proximo: ContextoDeEscuta): void {
  contexto = proximo;
}

/** Tocando agora? Então o guardião espera — ouvir é o serviço. */
function podeTrabalhar(): boolean {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  return true;
}

async function rodada(): Promise<void> {
  if (rodando || !podeTrabalhar()) return;
  rodando = true;
  try {
    const alvos = ordemDeDownload(list(), contexto, hasLocalAudio, albunsOffline.lista()).slice(
      0,
      POR_RODADA,
    );
    for (const entrada of alvos) {
      if (!podeTrabalhar()) break;
      if (!(await cabeMaisAudio())) break;
      await garantirAudioLocal(entrada.track.id).catch(() => false);
      await new Promise((r) => setTimeout(r, RESPIRO_MS));
    }
  } finally {
    rodando = false;
  }
}

function acordar(): void {
  if (acordarTimer) clearTimeout(acordarTimer);
  acordarTimer = setTimeout(() => void rodada(), DEBOUNCE_MS);
}

/** Liga o plantão uma única vez (App). */
export function initGuardiaoOffline(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  setTimeout(() => void rodada(), ATRASO_INICIAL_MS);
  subscribe(acordar); // biblioteca mudou: faixa nova entra na fila de download
  window.addEventListener('online', acordar);
}
