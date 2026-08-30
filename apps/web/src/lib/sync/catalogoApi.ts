/**
 * O ACERVO vem do NOSSO SERVIDOR agora, não do Firestore.
 *
 * POR QUE MUDOU. A coleção inteira era lida a cada abertura do app, por cada
 * pessoa, mais a varredura horária do worker. O limite grátis do Firestore é de
 * 50 mil leituras por DIA e vale para o PROJETO todo — então, quando estourava,
 * caía tudo junto: acervo, sincronia entre aparelhos, curtidas. Aconteceu três
 * vezes, e a terceira foi conferida na mão (429 RESOURCE_EXHAUSTED na coleção).
 *
 * O QUE NÃO SE PERDE. A máquina que serve isto JÁ era dependência dura para
 * ouvir: todo áudio sai dela pelo `remoteUrl`. Se ela cai, ninguém toca nada,
 * não importa onde a listagem esteja. Trazer a listagem para cá não cria
 * nenhum ponto de falha novo — ele já existia.
 *
 * O QUE PRECISOU SER RECONSTRUÍDO. O SDK do Firestore dava duas coisas de
 * graça, e as duas estão aqui:
 *
 *  1. CACHE OFFLINE — o acervo fica no IndexedDB (gigabytes disponíveis, ao
 *     contrário dos ~5 MB do localStorage que já nos custaram uma queda) e é
 *     entregue INSTANTANEAMENTE no boot, antes de qualquer rede. Sem isto, abrir
 *     o app sem sinal mostraria uma biblioteca vazia.
 *  2. AVISO DE MUDANÇA — no lugar do `onSnapshot`, revalidação periódica com
 *     ETag. No caso normal (nada mudou) a resposta é `304 Not Modified`: um
 *     cabeçalho, sem corpo. É isto que torna barato perguntar de novo — no
 *     Firestore, cada pergunta custava uma leitura POR DOCUMENTO.
 */
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { getIdToken } from '@/lib/firebase';
import { registrarErro, registrarSnapshot } from '@/lib/sync/syncStatus';
import { API_BASE_URL } from '@/lib/apiBase';

const BASE_URL = API_BASE_URL;
const COLECAO = 'catalogo';

/** De quanto em quanto tempo perguntamos "mudou?". Barato: quase sempre 304. */
const REVALIDA_MS = 3 * 60_000;

// ── cache em disco (IndexedDB) ──────────────────────────────────────────────
const DB_NAME = 'aurial-catalogo';
const DB_VERSION = 1;
const STORE = 'snapshot';
const CHAVE = 'atual';

interface CachePersistido {
  etag: string | null;
  entradas: LibraryEntry[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function abrirDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
  return dbPromise;
}

async function lerCache(): Promise<CachePersistido | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await abrirDb();
    return await new Promise<CachePersistido | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(CHAVE);
      req.onsuccess = () => resolve((req.result as CachePersistido | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function gravarCache(valor: CachePersistido): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await abrirDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(valor, CHAVE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // cache é conforto, nunca bloqueia
      tx.onabort = () => resolve();
    });
  } catch {
    /* sem IndexedDB o app segue: só perde o acervo offline */
  }
}

// ── rede ────────────────────────────────────────────────────────────────────

async function cabecalhoAutenticado(): Promise<Record<string, string>> {
  const token = await getIdToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface Resposta {
  /** `null` quando o servidor respondeu 304 — nada mudou, mantenha o que tem. */
  entradas: LibraryEntry[] | null;
  etag: string | null;
}

async function buscar(etagAtual: string | null): Promise<Resposta> {
  const res = await fetch(`${BASE_URL}/catalogo`, {
    headers: etagAtual ? { 'If-None-Match': etagAtual } : {},
  });
  if (res.status === 304) return { entradas: null, etag: etagAtual };
  if (!res.ok) throw new Error(`acervo: HTTP ${res.status}`);
  const corpo = (await res.json()) as { data?: unknown };
  const entradas = Array.isArray(corpo.data) ? (corpo.data as LibraryEntry[]) : [];
  return { entradas, etag: res.headers.get('ETag') };
}

// ── assinatura ──────────────────────────────────────────────────────────────

/**
 * Assina o acervo. Vale para TODO usuário, inclusive visitante sem conta — é o
 * acervo que dá o que ouvir antes de criar conta.
 *
 * O callback dispara primeiro com o que estava no disco (instantâneo, funciona
 * sem rede) e depois a cada mudança de verdade. Nada de repetir o mesmo
 * conteúdo: uma revalidação sem novidade não acorda ninguém.
 */
export function subscribeCatalogo(callback: (entradas: LibraryEntry[]) => void): () => void {
  let cancelado = false;
  let etag: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const revalidar = async (): Promise<void> => {
    if (cancelado) return;
    try {
      const { entradas, etag: novo } = await buscar(etag);
      etag = novo;
      if (cancelado || !entradas) return; // 304: nada mudou
      registrarSnapshot(COLECAO, entradas.length, 'servidor');
      await gravarCache({ etag, entradas });
      callback(entradas);
    } catch (erro) {
      // Sem rede o app continua com o que já está na tela e no disco.
      registrarErro(COLECAO, erro);
    }
  };

  const agendar = (): void => {
    if (cancelado) return;
    timer = setTimeout(() => {
      void revalidar().finally(agendar);
    }, REVALIDA_MS);
  };

  void (async () => {
    // 1. O DISCO PRIMEIRO. É o que faz o acervo aparecer no boot e continuar
    //    aparecendo sem sinal — o papel que o cache do Firestore fazia.
    const cache = await lerCache();
    if (cancelado) return;
    if (cache?.entradas.length) {
      etag = cache.etag;
      registrarSnapshot(COLECAO, cache.entradas.length, 'cache');
      callback(cache.entradas);
    }
    // 2. Depois a rede, para pegar o que mudou.
    await revalidar();
    agendar();
  })();

  // Voltou de segundo plano ou reconectou: confere na hora em vez de esperar.
  const acordar = (): void => {
    if (document.visibilityState === 'visible') void revalidar();
  };
  document.addEventListener('visibilitychange', acordar);
  window.addEventListener('online', acordar);

  return () => {
    cancelado = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', acordar);
    window.removeEventListener('online', acordar);
  };
}

// ── escrita ─────────────────────────────────────────────────────────────────

/** Publica (ou atualiza) uma faixa no acervo. Lança em caso de recusa. */
export async function publicarEntrada(entry: LibraryEntry): Promise<void> {
  const res = await fetch(`${BASE_URL}/catalogo/${encodeURIComponent(entry.track.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await cabecalhoAutenticado()) },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`acervo: HTTP ${res.status}`);
}

/**
 * Publica várias de uma vez.
 *
 * A reconciliação sobe o que falta, e um aparelho com trezentas faixas faria
 * trezentas requisições — cada uma com ida e volta pelo túnel. Em lote é uma só.
 */
export async function publicarLote(entradas: LibraryEntry[]): Promise<number> {
  if (entradas.length === 0) return 0;
  const res = await fetch(`${BASE_URL}/catalogo/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await cabecalhoAutenticado()) },
    body: JSON.stringify({ entradas }),
  });
  if (!res.ok) throw new Error(`acervo: HTTP ${res.status}`);
  const corpo = (await res.json()) as { data?: { publicadas?: number } };
  return corpo.data?.publicadas ?? entradas.length;
}

/** Tira uma faixa do acervo (o admin apagou de vez). */
export async function removerEntrada(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/catalogo/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await cabecalhoAutenticado(),
  });
  if (!res.ok) throw new Error(`acervo: HTTP ${res.status}`);
}
