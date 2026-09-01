/**
 * Download manager — orchestrates offline downloads of full audio files.
 *
 * Flow: fetch `track.downloadUrl` (single-file audio, auth header only for our
 * own API) with byte progress → store the blob in IndexedDB → index it in the
 * registry →
 * keep an in-memory object URL the AudioEngine plays from (via playerStore's
 * local source resolver). Playback prefers the local copy whenever present,
 * so downloaded tracks work fully offline.
 */
import type { TrackDto } from '@radinho/shared';
import { isFirstPartyUrl } from '@/lib/api';
import { getIdToken } from '@/lib/firebase';
import { queueLyricsSync } from '@/lib/lyrics/syncFromAudio';
import { pushNotification } from '@/stores/notificationsStore';
import {
  cacheSupported,
  deleteAudio,
  getAudioBlob,
  putAudio,
  requestPersistentStorage,
} from '@/lib/offline/audioCache';
import { addDownload, isDownloaded, removeDownload } from '@/features/downloads/registry';
import { abrir, consultar, soltar } from '@/lib/perf/alcasDeBlob';

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

export interface DownloadState {
  status: DownloadStatus;
  /** 0..1 while downloading. */
  progress: number;
}

const inFlight = new Map<string, number>(); // trackId → progress 0..1
const failed = new Set<string>();

/**
 * AS ALÇAS DE ÁUDIO NÃO MORAM MAIS AQUI — e o motivo não é arrumação.
 *
 * Este módulo tinha um mapa de object URLs com teto de 60 ALÇAS, cópia literal
 * do que o `localLibrary` tinha do outro lado. Dois problemas nasceram daí:
 *
 *  1. Contar alças é contar a coisa errada. Sessenta alças são 60 MB numa
 *     biblioteca de MP3 e 2,4 GB numa de FLAC — mesmo número, mesmo "teto
 *     respeitado", quarenta vezes a memória. O limite tem de ser em BYTES.
 *  2. Por serem DOIS mapas, cada um respeitava o próprio teto sem saber do
 *     outro: os dois cheios eram 120 alças, e ninguém no app conseguia
 *     responder "quanto a aba está segurando" — a resposta não existia.
 *
 * O comentário antigo daqui já registrava que este módulo era "a SEGUNDA cópia
 * do mapa" e que por isso o sintoma sobreviveu ao primeiro conserto. A cópia
 * acabou: `alcasDeBlob` é o dono único, com conta consultável por
 * `radinhoMemoria()`.
 */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeDownloadManager(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when offline downloads are usable (IndexedDB present). */
export function downloadsSupported(): boolean {
  return cacheSupported();
}

/** True when the track carries a downloadable single-file source. */
export function isDownloadable(track: TrackDto): boolean {
  return Boolean(track.downloadUrl) && cacheSupported();
}

export function downloadStateOf(trackId: string): DownloadState {
  const progress = inFlight.get(trackId);
  if (progress !== undefined) return { status: 'downloading', progress };
  if (failed.has(trackId)) return { status: 'error', progress: 0 };
  if (isDownloaded(trackId)) return { status: 'downloaded', progress: 1 };
  return { status: 'idle', progress: 0 };
}

/**
 * Alça já aberta NESTA sessão, ou null.
 *
 * Cuidado ao usar isto como "a faixa está baixada?": não é. Desde que o mapa
 * ganhou orçamento, `null` aqui significa apenas "a alça não está aberta agora" —
 * pode ser uma faixa perfeitamente baixada cuja alça foi descartada, ou uma que
 * nunca foi aberta neste boot. Quem quer saber se os bytes existem pergunta a
 * `hasDownloadedAudio`; quem quer TOCAR chama `ensureDownloadedAudioUrl`.
 */
export function localAudioUrl(trackId: string): string | null {
  return consultar('audio', trackId);
}

/**
 * Os bytes desta faixa estão neste aparelho? Responde SEM abrir o arquivo.
 *
 * Existe para separar as duas perguntas que `localAudioUrl` misturava. É a
 * pergunta barata e síncrona, boa para decidir se vale esperar pelo caminho
 * local em vez de sair para a rede.
 */
export function hasDownloadedAudio(trackId: string): boolean {
  return isDownloaded(trackId);
}

/**
 * Abre a alça desta faixa AGORA, se os bytes existirem aqui.
 *
 * É o par do orçamento de `alcasDeBlob`: com teto em bytes, a alça de uma faixa
 * baixada pode não estar aberta, e o caminho do play precisa de um jeito de
 * reabrir antes de cogitar a rede. Uma faixa baixada indo buscar bytes no
 * servidor é o pior erro deste módulo — offline ela simplesmente emudece.
 *
 * Também é aqui que o registro se conserta: se o navegador despejou os bytes
 * (a quota é do navegador, não nossa), a entrada é removida em vez de continuar
 * anunciando um download que não toca. Essa poda ficava no boot e varria tudo;
 * agora acontece na faixa que foi pedida, quando a verdade importa.
 */
export async function ensureDownloadedAudioUrl(trackId: string): Promise<string | null> {
  const aberta = consultar('audio', trackId); // consultar conta como uso
  if (aberta) return aberta;
  if (!isDownloaded(trackId) || !cacheSupported()) return null;

  const blob = await getAudioBlob(trackId).catch(() => null);
  if (!blob) {
    removeDownload(trackId);
    emit();
    return null;
  }
  return abrir('audio', trackId, blob);
}

const MAX_DOWNLOAD_TRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 90_000;

/**
 * Quantos downloads correm ao mesmo tempo.
 *
 * Antes não havia teto: mandar baixar uma prateleira inteira abria uma
 * requisição por faixa DE UMA VEZ. O navegador enfileira o excedente e a banda
 * se divide entre todas — ninguém termina, a barra de todo mundo rasteja, e no
 * servidor doméstico (que ainda serve o /stream da música que está tocando) o
 * resultado é timeout. Poucas em paralelo terminam MAIS rápido que muitas:
 * cada uma pega banda inteira e sai da fila.
 *
 * Três é o ponto onde a rede doméstica satura sem prejudicar a reprodução.
 */
const MAX_DOWNLOADS_PARALELOS = 3;

let baixandoAgora = 0;
const esperando: (() => void)[] = [];

async function pegarVaga(): Promise<void> {
  if (baixandoAgora < MAX_DOWNLOADS_PARALELOS) {
    baixandoAgora += 1;
    return;
  }
  await new Promise<void>((resolve) => esperando.push(resolve));
  baixandoAgora += 1;
}

function devolverVaga(): void {
  baixandoAgora -= 1;
  esperando.shift()?.();
}

/**
 * Pede persistência UMA vez para o app inteiro, não a cada faixa.
 *
 * Isto estava na frente de cada download, e `navigator.storage.persist()` pode
 * consultar heurística do navegador (ou abrir prompt): toda faixa pagava essa
 * espera ANTES de o primeiro byte ser pedido. A garantia é do armazenamento
 * como um todo, então uma vez basta.
 */
let persistenciaPedida: Promise<unknown> | null = null;
function garantirPersistencia(): Promise<unknown> {
  return (persistenciaPedida ??= requestPersistentStorage().catch(() => undefined));
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/** Baixa o corpo uma vez, com timeout/abort. Lança em falha de rede/HTTP. */
async function fetchAudioBlob(
  url: string,
  headers: Record<string, string>,
  onProgress: (fraction: number | null) => void,
): Promise<Blob> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`Falha no download (${res.status})`);
    // Content-Length é omitido em CDN cross-origin sem Expose-Headers → total 0.
    // Nesse caso mostramos progresso indeterminado (null) em vez de barra travada.
    const total = Number(res.headers.get('Content-Length') ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    onProgress(total > 0 ? 0 : null);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress(Math.min(0.99, received / total));
    }
    return new Blob(chunks as BlobPart[], {
      type: res.headers.get('Content-Type') ?? 'audio/mpeg',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Faixas já mandadas rebaixar por ERRO DE REPRODUÇÃO nesta sessão — evita
 *  refazer o pedido a cada evento de erro repetido da mesma faixa. */
const rebaixaPorErro = new Set<string>();

/**
 * REBAIXAR AO FALHAR.
 *
 * Quando uma fonte remota morre no meio da reprodução, o player já rotaciona
 * para uma fonte viva na hora para a música não travar (ver
 * `attemptSourceFallback` no playerStore). Mas isso conserta só ESTA vez: a
 * próxima reprodução cairia no mesmo link podre e daria o mesmo erro.
 *
 * Aqui aproveitamos a fonte fresca que ACABOU de funcionar para baixar uma
 * cópia LOCAL da faixa. Da próxima vez ela toca do disco — o link morto nunca
 * mais é tentado, e de quebra a faixa passa a existir offline. Melhor esforço:
 * sem rede, sem fonte, já baixada ou já em download, não faz nada; falha de
 * download cai no `scheduleAutoRetry` normal, com o teto de tentativas de lá.
 *
 * `track` deve trazer uma fonte VIVA (fresca), não a URL que acabou de morrer —
 * quem chama resolve isso antes (token novo / nó de descoberta vivo).
 */
export function rebaixarAoFalhar(track: TrackDto): void {
  if (!cacheSupported()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const url = track.downloadUrl ?? track.streamUrl;
  if (!url) return;
  if (isDownloaded(track.id) || inFlight.has(track.id)) return;
  if (rebaixaPorErro.has(track.id)) return;
  rebaixaPorErro.add(track.id);
  const alvo = track.downloadUrl ? track : { ...track, downloadUrl: url };
  void downloadTrack(alvo).catch(() => undefined); // já emite estado e reagenda
}

export async function downloadTrack(track: TrackDto): Promise<void> {
  const downloadUrl = track.downloadUrl;
  if (!downloadUrl || !cacheSupported()) return;
  if (inFlight.has(track.id) || isDownloaded(track.id)) return;

  failed.delete(track.id);
  // -1 = indeterminado: a UI já mostra "na fila" enquanto a vaga não sai, em
  // vez de uma barra parada em 0% que parece travamento.
  inFlight.set(track.id, -1);
  emit();

  await pegarVaga();
  try {
    await baixarComVaga(track, downloadUrl);
  } finally {
    devolverVaga();
  }
}

async function baixarComVaga(track: TrackDto, downloadUrl: string): Promise<void> {
  // Persistência garante que o browser não evicte o áudio sob pressão enquanto
  // o registro (localStorage) sobrevive — faixa "some" no boot. Pedida uma vez
  // para o app todo, e sem segurar o primeiro byte: o download já pode começar.
  void garantirPersistencia();

  // Only send the Firebase token to our own API. Catalog tracks download
  // straight from the third-party Audius CDN — an Authorization header there
  // leaks the token and trips a CORS preflight the CDN rejects.
  const headers: Record<string, string> = {};
  if (isFirstPartyUrl(downloadUrl)) {
    const token = await getIdToken().catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const setProgress = (fraction: number | null): void => {
    // null = indeterminado (sem Content-Length); a UI trata <0 como spinner.
    inFlight.set(track.id, fraction ?? -1);
    emit();
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_TRIES; attempt++) {
    try {
      const blob = await fetchAudioBlob(downloadUrl, headers, setProgress);
      // putAudio só resolve quando a transação COMMITA (ver audioCache.tx) — um
      // abort de quota rejeita aqui e nunca registramos uma faixa fantasma.
      await putAudio(track.id, blob);
      addDownload(track, blob.size);
      abrir('audio', track.id, blob);
      // O áudio acabou de chegar ao aparelho: além de cachear a letra, é AQUI
      // que ela pode ganhar sincronia (a transcrição precisa do arquivo local).
      // Vai para uma fila serial — baixar uma playlist não pode virar uma
      // rajada de transcrições.
      queueLyricsSync(track);
      inFlight.delete(track.id);
      emit();
      pushNotification({ type: 'download', title: 'Download concluído', body: track.title });
      return;
    } catch (err) {
      lastErr = err;
      // Sem espaço não adianta tentar de novo — falha direto com aviso claro.
      if (isQuotaError(err)) {
        inFlight.delete(track.id);
        failed.add(track.id);
        emit();
        throw new Error('Sem espaço no dispositivo para baixar esta faixa.');
      }
      if (attempt < MAX_DOWNLOAD_TRIES) {
        // Mantém inFlight (UI mostra "baixando", não "erro") e espera o backoff.
        inFlight.set(track.id, -1);
        emit();
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  inFlight.delete(track.id);
  failed.add(track.id);
  emit();
  // As 3 tentativas seguidas caíram, mas a causa costuma ser passageira (rede
  // do celular, CDN engasgado). Em vez de deixar a faixa parada em vermelho
  // até alguém tocar nela, tenta de novo sozinha mais tarde.
  scheduleAutoRetry(track);
  throw lastErr instanceof Error ? lastErr : new Error('Não foi possível baixar esta faixa.');
}

/** Espera antes da retomada automática de um download que falhou de vez. */
const AUTO_RETRY_MS = 3 * 60_000;
/** Teto de retomadas automáticas por faixa — sem isso um link morto tentaria
 *  para sempre, gastando dados do usuário em silêncio. */
const MAX_AUTO_RETRIES = 3;
const autoRetries = new Map<string, number>();
const autoRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoRetry(track: TrackDto): void {
  if (typeof window === 'undefined') return;
  const used = autoRetries.get(track.id) ?? 0;
  if (used >= MAX_AUTO_RETRIES) return;
  if (autoRetryTimers.has(track.id)) return;
  const timer = setTimeout(() => {
    autoRetryTimers.delete(track.id);
    // Some da fila de retomada se o usuário já resolveu no braço, apagou, ou
    // está offline (tentar sem rede só queima uma rodada à toa).
    if (isDownloaded(track.id) || inFlight.has(track.id)) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      scheduleAutoRetry(track); // ainda sem rede: reagenda sem gastar rodada
      return;
    }
    autoRetries.set(track.id, used + 1);
    void downloadTrack(track).catch(() => undefined); // já emite estado
  }, AUTO_RETRY_MS);
  autoRetryTimers.set(track.id, timer);
}

export async function removeDownloadedTrack(trackId: string): Promise<void> {
  await deleteAudio(trackId).catch(() => undefined);
  soltar('audio', trackId);
  removeDownload(trackId);
  inFlight.delete(trackId);
  failed.delete(trackId);
  // Apagar a faixa cancela qualquer retomada automática pendente — senão ela
  // reapareceria sozinha minutos depois de o usuário mandar remover.
  const timer = autoRetryTimers.get(trackId);
  if (timer) clearTimeout(timer);
  autoRetryTimers.delete(trackId);
  autoRetries.delete(trackId);
  // Libera o "rebaixar ao falhar" desta faixa: se ela tornar a dar erro depois
  // de removida, pode baixar de novo em vez de ficar travada pela marca antiga.
  rebaixaPorErro.delete(trackId);
  emit();
}

let hydratePromise: Promise<void> | null = null;

/**
 * Marca que o subsistema de downloads pode responder. NÃO abre mais arquivo.
 *
 * ESTA FUNÇÃO ERA O ESTOURO DE MEMÓRIA. Ela varria o registro inteiro no boot e
 * fazia, por faixa baixada, um `getAudioBlob` seguido de `createObjectURL` —
 * uma alça permanente para cada arquivo, todas de uma vez, antes de a primeira
 * tela pintar. Com 100 faixas offline de 8 MB isso são ~800 MB presos num
 * aparelho que talvez tenha 2 GB, e o navegador mata a aba. Pior: `playerStore`
 * espera por ela (`downloadsReady`) ANTES de cada carga de faixa, então o custo
 * era pago no caminho crítico do play, não num canto ocioso.
 *
 * O registro é síncrono (localStorage), então não há nada a hidratar: quem quer
 * saber se a faixa está baixada pergunta a `hasDownloadedAudio`, e quem vai
 * tocar chama `ensureDownloadedAudioUrl`, que abre UMA alça — a da faixa
 * pedida. A promessa continua existindo porque `playerStore` a aguarda e porque
 * ela é o ponto natural para o dia em que o registro deixar de ser síncrono;
 * resolver na hora é o comportamento certo, não um atalho.
 *
 * A poda de entradas cujos bytes o navegador despejou saiu daqui e virou
 * preguiçosa (ver `ensureDownloadedAudioUrl`). Varrer tudo no boot para achar
 * as despejadas custava exatamente o que este conserto veio remover, e a
 * resposta só importa na faixa que alguém pediu.
 */
export function hydrateDownloads(): Promise<void> {
  return (hydratePromise ??= Promise.resolve());
}
