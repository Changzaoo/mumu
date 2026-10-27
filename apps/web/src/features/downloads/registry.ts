/**
 * Downloads registry — typed localStorage index of offline tracks.
 *
 * This is the metadata index (which tracks, when, how big). The actual audio
 * bytes live in the Cache Storage API (lib/offline/audioCache.ts), orchestrated
 * by features/downloads/downloadManager.ts. Track DTOs are stored here so the
 * library stays browsable while offline.
 */
import type { TrackDto } from '@radinho/shared';
import { gravarLocal } from '@/lib/local/cofreLocal';

const STORAGE_KEY = 'aurial:downloads';

export interface DownloadEntry {
  track: TrackDto;
  downloadedAt: string;
  /** Cached audio size in bytes (0 when unknown). */
  sizeBytes: number;
  /**
   * GUARDADA AO OUVIR, não pedida pela pessoa.
   *
   * A pessoa escutou a faixa e o app guardou os bytes sozinho para a próxima
   * vez sair do aparelho (ver `guardarAoOuvir` no downloadManager). Essas
   * entradas vivem sob um orçamento próprio e são as ÚNICAS que o despejo LRU
   * pode remover: um download que a pessoa pediu nunca some sozinho. Ausente =
   * download manual (as entradas antigas do registro não têm o campo).
   */
  automatico?: boolean;
  /** Último uso (play/pré-carga), ISO. Só importa para as automáticas (LRU). */
  usadaEm?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: DownloadEntry[] | null = null;

function read(): DownloadEntry[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Entrada torta (escrita parcial, esquema antigo) é descartada na leitura: um
    // único `null` aqui fazia `entry.track.id` lançar em toda consulta, e a
    // lista de faixas inteira quebrava no boot — com os bytes ainda no aparelho.
    cache = Array.isArray(parsed)
      ? (parsed as DownloadEntry[]).filter((e) => typeof e?.track?.id === 'string')
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

// O índice dos downloads é o mapa dos bytes que JÁ estão no aparelho: perdê-lo
// deixa áudio baixado órfão, ocupando espaço sem tocar. Ver lib/local/cofreLocal.ts.
function write(entries: DownloadEntry[]): void {
  cache = entries;
  gravarLocal(STORAGE_KEY, JSON.stringify(entries));
  for (const notify of listeners) notify();
}

export function getDownloads(): DownloadEntry[] {
  return read();
}

export function isDownloaded(trackId: string): boolean {
  return read().some((entry) => entry.track.id === trackId);
}

export function addDownload(
  track: TrackDto,
  sizeBytes = 0,
  opcoes: { automatico?: boolean } = {},
): void {
  if (isDownloaded(track.id)) return;
  const agora = new Date().toISOString();
  write([
    {
      track,
      downloadedAt: agora,
      sizeBytes,
      ...(opcoes.automatico ? { automatico: true, usadaEm: agora } : {}),
    },
    ...read(),
  ]);
}

export function entryOf(trackId: string): DownloadEntry | undefined {
  return read().find((entry) => entry.track.id === trackId);
}

/** A faixa está no aparelho só porque foi OUVIDA (não porque a pessoa pediu)? */
export function isAutomatico(trackId: string): boolean {
  return entryOf(trackId)?.automatico === true;
}

/**
 * A pessoa pediu para baixar uma faixa que já estava guardada por ter sido
 * ouvida: os bytes já estão aqui, só muda o dono. Sai do orçamento das
 * automáticas e passa a ser um download de verdade, que nunca é despejado.
 */
export function promoverParaManual(trackId: string): boolean {
  const entries = read();
  const alvo = entries.find((e) => e.track.id === trackId);
  if (!alvo?.automatico) return false;
  write(
    entries.map((e) =>
      e === alvo
        ? {
            ...e,
            automatico: undefined,
            usadaEm: undefined,
            downloadedAt: new Date().toISOString(),
          }
        : e,
    ),
  );
  return true;
}

/**
 * Marca uso de uma guardada automaticamente (toca de novo → vai para o fim da
 * fila de despejo). Sem efeito nas manuais — e sem gravar, se nada mudou.
 */
export function registrarUso(trackId: string): void {
  const entries = read();
  const alvo = entries.find((e) => e.track.id === trackId);
  if (!alvo?.automatico) return;
  const agora = new Date().toISOString();
  if (alvo.usadaEm === agora) return;
  write(entries.map((e) => (e === alvo ? { ...e, usadaEm: agora } : e)));
}

/** As guardadas ao ouvir, da MENOS usada recentemente para a mais (ordem de despejo). */
export function ouvidasGuardadas(): DownloadEntry[] {
  return read()
    .filter((e) => e.automatico === true)
    .sort((a, b) => (a.usadaEm ?? a.downloadedAt).localeCompare(b.usadaEm ?? b.downloadedAt));
}

/** Só os downloads que a pessoa PEDIU (a lista da página de Downloads). */
export function downloadsManuais(): DownloadEntry[] {
  return read().filter((e) => e.automatico !== true);
}

/** Bytes ocupados pelas guardadas ao ouvir. */
export function bytesDasOuvidas(): number {
  return read().reduce((sum, e) => (e.automatico ? sum + (e.sizeBytes || 0) : sum), 0);
}

/** Total bytes of all cached tracks. */
export function totalDownloadedBytes(): number {
  return read().reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
}

export function removeDownload(trackId: string): void {
  write(read().filter((entry) => entry.track.id !== trackId));
}

export function clearDownloads(): void {
  write([]);
}

/** Subscribe to registry changes (useSyncExternalStore-friendly). */
export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
