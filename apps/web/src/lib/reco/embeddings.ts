/**
 * Vetores de faixa — rede + cache. A matemática pura fica em semantic.ts.
 *
 * Cada faixa vira um vetor via NVIDIA (proxy do importer, chave server-side).
 * O vetor é CARO de obter e nunca muda enquanto o texto da faixa não mudar,
 * então ele é cacheado em IndexedDB. localStorage não serve: 2048 floats por
 * faixa em JSON estouraria a cota com poucas centenas de músicas.
 *
 * Guardamos o vetor TRUNCADO. O modelo é Matryoshka — as primeiras dimensões
 * concentram a informação, então cortar em 512 e renormalizar preserva quase
 * toda a qualidade com 1/4 do espaço (5 mil faixas ≈ 10 MB em vez de 40 MB).
 */
import type { TrackDto } from '@aurial/shared';
import { aiEmbed } from '@/lib/local/importerHelper';
import { normalize, trackEmbeddingText } from '@/lib/reco/semantic';

const DB_NAME = 'aurial-vectors';
const DB_VERSION = 1;
const STORE = 'tracks';

/** Dimensões guardadas (corte Matryoshka do vetor de 2048). */
const DIMS = 512;
/** Lote por requisição — casado com o teto do proxy. */
const BATCH = 32;

interface StoredVector {
  /** Hash do texto que gerou o vetor: texto mudou → vetor obsoleto. */
  hash: string;
  vector: number[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function supported(): boolean {
  return typeof indexedDB !== 'undefined';
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
        // Igual ao cofre de áudio: num write, só o commit prova que gravou.
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
      }),
  );
}

/** Hash estável e barato (FNV-1a) do texto da faixa. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Espelho em memória: a Home consulta a cada render e ir ao IndexedDB
// sincronamente não é possível.
const memory = new Map<string, StoredVector>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/** Carrega os vetores já conhecidos. Idempotente. */
export function hydrateVectors(): Promise<void> {
  return (hydratePromise ??= (async () => {
    if (!supported()) {
      hydrated = true;
      return;
    }
    try {
      const db = await openDb();
      await new Promise<void>((resolve) => {
        const transaction = db.transaction(STORE, 'readonly');
        const cursorReq = transaction.objectStore(STORE).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as StoredVector | undefined;
          if (value?.vector?.length) memory.set(String(cursor.key), value);
          cursor.continue();
        };
        cursorReq.onerror = () => resolve(); // cache é otimização, não requisito
        transaction.onabort = () => resolve();
      });
    } catch {
      /* sem cache: seguimos só com a heurística */
    }
    hydrated = true;
  })());
}

/** Vetor já conhecido de uma faixa (síncrono), ou null. */
export function vectorOf(track: TrackDto): number[] | null {
  const stored = memory.get(track.id);
  if (!stored) return null;
  // Texto mudou (metadata corrigida): o vetor antigo descreve outra coisa.
  if (stored.hash !== hashText(trackEmbeddingText(track))) return null;
  return stored.vector;
}

/** Quantas faixas já têm vetor — usado para decidir se vale usar o modo semântico. */
export function vectorCount(): number {
  return memory.size;
}

export function vectorsReady(): boolean {
  return hydrated;
}

async function persist(id: string, entry: StoredVector): Promise<void> {
  memory.set(id, entry);
  if (!supported()) return;
  await tx('readwrite', (store) => store.put(entry, id)).catch(() => undefined);
}

/**
 * Garante vetor para as faixas dadas, buscando só as que faltam.
 *
 * Silencioso por natureza: sem importer, sem login ou offline o `aiEmbed`
 * devolve null e simplesmente não haverá modo semântico — a recomendação
 * heurística continua valendo. Isso NÃO é engolir erro: é um recurso extra
 * que degrada, e o chamador enxerga isso pelo `vectorCount()`.
 */
export async function ensureVectors(
  tracks: readonly TrackDto[],
  opts: { max?: number } = {},
): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  await hydrateVectors();

  const pending: Array<{ track: TrackDto; text: string; hash: string }> = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    const text = trackEmbeddingText(track);
    const hash = hashText(text);
    const stored = memory.get(track.id);
    if (stored && stored.hash === hash) continue;
    pending.push({ track, text, hash });
  }
  if (pending.length === 0) return 0;

  // Teto por rodada: vetorizar uma biblioteca de milhares de faixas de uma vez
  // seria uma rajada enorme na primeira abertura do app.
  const limited = pending.slice(0, opts.max ?? 120);

  let embedded = 0;
  for (let i = 0; i < limited.length; i += BATCH) {
    const slice = limited.slice(i, i + BATCH);
    const vectors = await aiEmbed(slice.map((p) => p.text));
    if (!vectors) break; // IA indisponível: para a rodada, tenta de novo depois
    for (let j = 0; j < slice.length; j++) {
      const raw = vectors[j];
      const entry = slice[j];
      if (!raw || !entry || raw.length === 0) continue;
      // Corte Matryoshka + renormalização (o corte muda a norma).
      const vector = normalize(raw.slice(0, DIMS));
      await persist(entry.track.id, { hash: entry.hash, vector });
      embedded++;
    }
  }
  return embedded;
}
