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
 * 1. NÃO PODE ATRAPALHAR A MÚSICA. Baixar é enfeite; ouvir é o serviço. Um
 *    `repairMissingAudio` automático já foi ligado no boot uma vez e virou um
 *    estrago: o celular, que só deveria transmitir, saiu baixando centenas de
 *    músicas de uma vez. A defesa hoje não é baixar devagar sempre — é baixar
 *    no RITMO DO APARELHO (ver `ritmoDoAparelho`) e nunca passar de alguns
 *    minutos seguidos de trabalho por rodada.
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

/**
 * Teto de downloads simultâneos, em QUALQUER aparelho.
 *
 * Os bytes saem de um único servidor doméstico atrás de um túnel: passar disto
 * não acelera nada e atrapalha quem está ouvindo AGORA pela mesma conexão.
 */
const SIMULTANEOS_MAX = 4;

/**
 * Quanto tempo o guardião pode trabalhar sem parar numa rodada.
 *
 * Sem este limite, "baixar o mais rápido possível" vira o rádio e o disco
 * ligados por uma hora seguida — que é como se torra a bateria de um celular
 * sem que nada na tela explique por quê. Ele volta na próxima batida.
 */
const TEMPO_MAXIMO_POR_RODADA_MS = 10 * 60_000;

/** De quanto em quanto tempo o plantão reavalia sozinho, sem depender de evento. */
const BATIDA_MS = 5 * 60_000;

/**
 * Tentativas por faixa dentro da sessão.
 *
 * A fila é recalculada a cada lote (o que já baixou sai dela). Sem um teto de
 * tentativas, uma faixa que falha voltaria ao topo para sempre e seguraria a
 * fila inteira — o laço giraria sem baixar nada.
 */
const TENTATIVAS_POR_FAIXA = 2;
/** Começa depois do boot: a primeira tela é prioridade absoluta. */
const ATRASO_INICIAL_MS = 40_000;
/** Reavalia quando a biblioteca muda, sem correr atrás de cada mudança. */
const DEBOUNCE_MS = 15_000;
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
   * que o offline precisava existir. Mandar a fila toda não cria rajada: quem
   * limita o esforço é `ritmoDoAparelho` e a cota, não o tamanho da lista. O
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

/**
 * OS SINAIS QUE O APARELHO DÁ SOBRE O QUANTO AGUENTA.
 *
 * Tudo opcional de propósito: cada um destes campos falta em algum navegador
 * real (`deviceMemory` e `connection` não existem no Safari, por exemplo). A
 * regra é que a ausência de sinal nunca vire castigo — ver `ritmoDoAparelho`.
 */
export interface SinaisDoAparelho {
  /** O sistema pediu economia de dados. É um pedido explícito da pessoa. */
  economizarDados?: boolean;
  /** 'slow-2g' | '2g' | '3g' | '4g' — a qualidade efetiva da conexão. */
  tipoDeConexao?: string;
  /** Núcleos de CPU (`navigator.hardwareConcurrency`). */
  nucleos?: number;
  /** Memória em GB (`navigator.deviceMemory`), arredondada pelo navegador. */
  memoriaGb?: number;
}

export interface Ritmo {
  /** Quantas faixas baixar ao mesmo tempo. */
  simultaneos: number;
  /** Pausa entre um lote e o próximo. */
  respiroMs: number;
}

/**
 * QUANTO ESTE APARELHO AGUENTA BAIXAR AO MESMO TEMPO.
 *
 * O guardião baixava uma faixa por vez com 1,5 s de espera entre elas, em todo
 * aparelho. Isso dá ~13 faixas por minuto no melhor caso — um celular novo em
 * Wi-Fi passava o tempo todo ocioso esperando um respiro pensado para o pior
 * caso, e quem estava com pressa não tinha como ir mais rápido.
 *
 * Mas simplesmente subir o número esganaria justamente os aparelhos fracos:
 * cada download carrega o arquivo INTEIRO na memória antes de gravar (ver
 * `garantirAudioLocal`), então quatro em paralelo são quatro faixas de ~8 MB
 * vivas ao mesmo tempo. Num aparelho de 2 GB isso é dinheiro que não existe.
 *
 * Por isso o ritmo sai dos sinais do próprio aparelho, e o pior sinal manda:
 * uma conexão 2G num celular de 8 núcleos continua sendo 2G.
 *
 * Função pura para poder ser testada sem navegador — é a decisão que separa
 * "rápido" de "quebrou o celular de alguém".
 */
export function ritmoDoAparelho(sinais: SinaisDoAparelho): Ritmo {
  // Pedido explícito de economia vence qualquer capacidade: a pessoa disse ao
  // sistema que não quer gastar dados. Não paramos de baixar — a fila é o que
  // ela vai ouvir, não especulação — mas voltamos ao mínimo.
  if (sinais.economizarDados) return { simultaneos: 1, respiroMs: 5_000 };

  const conexao = sinais.tipoDeConexao;
  if (conexao === 'slow-2g' || conexao === '2g') return { simultaneos: 1, respiroMs: 4_000 };
  if (conexao === '3g') return { simultaneos: 2, respiroMs: 1_500 };

  // Sem sinal de conexão (Safari) tratamos como boa: a ausência de informação
  // não é evidência de aparelho ruim, e a cota e o tempo máximo já seguram o
  // exagero. Punir o desconhecido deixaria todo iPhone no ritmo de 2G.
  const nucleos = sinais.nucleos ?? 4;
  const memoria = sinais.memoriaGb ?? 4;

  if (memoria <= 2 || nucleos <= 2) return { simultaneos: 2, respiroMs: 900 };
  if (memoria <= 4 || nucleos <= 4) return { simultaneos: 3, respiroMs: 400 };
  return { simultaneos: SIMULTANEOS_MAX, respiroMs: 200 };
}

/** Lê os sinais do navegador. Fora dos testes, é a única fonte deles. */
function sinaisDoAparelho(): SinaisDoAparelho {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const conexao = (
    nav as unknown as { connection?: { effectiveType?: string; saveData?: boolean } } | undefined
  )?.connection;
  return {
    economizarDados: conexao?.saveData,
    tipoDeConexao: conexao?.effectiveType,
    nucleos: nav?.hardwareConcurrency,
    memoriaGb: (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory,
  };
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

/**
 * Faixas que falharam nesta sessão, e quantas vezes.
 *
 * Vive fora da rodada porque a fila é recalculada a cada lote: sem memória
 * entre lotes, a faixa que acabou de falhar voltaria ao topo imediatamente e o
 * guardião giraria nela para sempre, sem chegar nas que dariam certo.
 */
const tentativas = new Map<string, number>();

function desistiuDe(id: string): boolean {
  return (tentativas.get(id) ?? 0) >= TENTATIVAS_POR_FAIXA;
}

/**
 * Uma rodada: trabalha até acabar a fila, encher a cota ou estourar o tempo.
 *
 * Antes ela baixava 25 faixas e ia embora até alguém mudar a biblioteca. Numa
 * biblioteca de cinco mil faixas isso nunca chegava perto de "offline": eram 25
 * por acordar, e o guardião acordava por evento, não por relógio.
 */
async function rodada(): Promise<void> {
  if (rodando || !podeTrabalhar()) return;
  rodando = true;
  const limite = Date.now() + TEMPO_MAXIMO_POR_RODADA_MS;
  try {
    const ritmo = ritmoDoAparelho(sinaisDoAparelho());
    while (Date.now() < limite) {
      if (!podeTrabalhar()) break;
      if (!(await cabeMaisAudio())) break;

      // Recalculada a cada lote de propósito: enquanto se baixa, a pessoa pula
      // faixa, entra numa playlist nova ou marca um álbum. A fila de trinta
      // segundos atrás não é mais a ordem certa.
      const alvos = ordemDeDownload(list(), contexto, hasLocalAudio, albunsOffline.lista())
        .filter((e) => !desistiuDe(e.track.id))
        .slice(0, ritmo.simultaneos);
      if (alvos.length === 0) break;

      await Promise.all(
        alvos.map(async (entrada) => {
          const id = entrada.track.id;
          tentativas.set(id, (tentativas.get(id) ?? 0) + 1);
          const ok = await garantirAudioLocal(id).catch(() => false);
          if (ok) tentativas.delete(id);
        }),
      );
      await new Promise((r) => setTimeout(r, ritmo.respiroMs));
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
  // Batida própria: sem ela o guardião só acordava por evento, e numa
  // biblioteca parada (ninguém importando nada) ele simplesmente não voltava
  // depois da primeira rodada.
  setInterval(() => void rodada(), BATIDA_MS);
}
