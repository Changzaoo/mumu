/**
 * Offline audio store — persists downloaded tracks so they play without a
 * network connection.
 *
 * Backed by IndexedDB (not the Cache Storage API): IndexedDB is available in
 * non-secure contexts too, so downloads work from anywhere — the HTTPS deploy,
 * a plain http:// LAN address on a phone, any device. Blobs are keyed by
 * trackId in a single object store.
 */
const DB_NAME = 'aurial-offline';
const DB_VERSION = 1;
const STORE = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

/** True when offline downloads are usable (IndexedDB present). */
export function cacheSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * True when the Cache Storage API is usable (secure context only). Used by the
 * local-library store, which keeps its own Cache Storage backend — unlike
 * downloads, which use IndexedDB so they work in non-secure contexts too.
 */
export function cacheStorageSupported(): boolean {
  return (
    typeof caches !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext === true
  );
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        // CRÍTICO: num write, `request.onsuccess` dispara ANTES do commit. Se a
        // transação depois abortar (pressão de quota), resolver no onsuccess
        // engoliria o abort — a faixa "baixa" mas nunca vai pro disco e some no
        // próximo boot. Só resolvemos quando a transação de fato commitou.
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
      }),
  );
}

export async function putAudio(trackId: string, blob: Blob): Promise<void> {
  await tx('readwrite', (store) => store.put(blob, trackId));
}

// ── capas ───────────────────────────────────────────────────────
// Capa embutida (ID3 APIC) NÃO pode virar data URL no registro: o registro é
// um JSON único no localStorage (~5 MB) e uma capa de 800 KB vira ~1 MB em
// base64. Cinco faixas estourariam a cota — e como a escrita falha em
// silêncio, a biblioteca INTEIRA pararia de persistir e voltaria ao estado
// anterior no próximo boot. Então a imagem vai para o IndexedDB, como o áudio,
// e o registro guarda apenas um marcador.
const coverKey = (trackId: string): string => `cover:${trackId}`;

export async function putCover(trackId: string, blob: Blob): Promise<void> {
  await tx('readwrite', (store) => store.put(blob, coverKey(trackId)));
}

export async function getCoverBlob(trackId: string): Promise<Blob | null> {
  if (!cacheSupported()) return null;
  const blob = await tx<Blob | undefined>('readonly', (store) =>
    store.get(coverKey(trackId)),
  ).catch(() => undefined);
  return blob instanceof Blob ? blob : null;
}

export async function deleteCover(trackId: string): Promise<void> {
  if (!cacheSupported()) return;
  await tx('readwrite', (store) => store.delete(coverKey(trackId))).catch(() => undefined);
}

export async function getAudioBlob(trackId: string): Promise<Blob | null> {
  if (!cacheSupported()) return null;
  const blob = await tx<Blob | undefined>('readonly', (store) => store.get(trackId)).catch(
    () => undefined,
  );
  return blob instanceof Blob ? blob : null;
}

export async function hasAudio(trackId: string): Promise<boolean> {
  if (!cacheSupported()) return false;
  const key = await tx<IDBValidKey | undefined>('readonly', (store) => store.getKey(trackId)).catch(
    () => undefined,
  );
  return key !== undefined;
}

export async function deleteAudio(trackId: string): Promise<void> {
  if (!cacheSupported()) return;
  await tx('readwrite', (store) => store.delete(trackId)).catch(() => undefined);
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/** Ask the browser to keep this origin's storage from being evicted under pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
