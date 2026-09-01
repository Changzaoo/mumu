/**
 * O CACHE DE DADOS SOBREVIVE AO FECHAR DO APP — é isso que faz o menu pintar
 * na hora.
 *
 * O arnês de navegação (`e2e/navegacao.spec.ts`) mediu o clique → página de pé
 * com a rede cortada: pior caso 475ms no desktop, 380ms num celular fraco 6×.
 * Ou seja, o CLIENTE já é rápido — a demora que o usuário sente é a página
 * esperando DADOS da rede antes de trocar o esqueleto por conteúdo. E o cache
 * do TanStack Query vivia só em memória: todo boot começava vazio, e num
 * celular o sistema descarta a aba a toda hora, então "primeira visita" (=
 * esqueleto + espera de rede) acontecia o tempo todo.
 *
 * Persistido, o caminho vira: pinta JÁ com o que se sabia da última vez e
 * revalida por trás — o mesmo stale-while-revalidate que a troca de página
 * dentro de uma sessão já fazia (ver o comentário do `gcTime` em App.tsx).
 *
 * POR QUE INDEXEDDB E NÃO LOCALSTORAGE. O localStorage deste app é um terreno
 * disputado (~5 MB para biblioteca + letras + Firestore — ver cofreLocal.ts, que
 * existe porque ele já lotou e derrubou o cliente). O cache de páginas chega a
 * megabytes; jogá-lo lá seria reabrir exatamente aquele incêndio.
 */
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  persistQueryClient,
  persistQueryClientSave,
  type PersistedClient,
} from '@tanstack/react-query-persist-client';

const DB = 'aurial-query-cache';
const STORE = 'cache';
const CHAVE = 'dados';

let dbPromise: Promise<IDBDatabase> | null = null;
function abrirDb(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  }));
}

function noStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrirDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('transação abortada'));
      }),
  );
}

/**
 * O que NÃO entra no cache persistido:
 *  - `admin`, `uploads`, `upload-status`: telas privadas e estado em voo — um
 *    status "enviando" ressuscitado no boot seguinte seria mentira na tela;
 *  - `waveform`: vetores grandes por faixa, caro no JSON e barato de refazer;
 *  - `lyrics`: já tem cache próprio com teto e poda (lib/lyrics/lyrics.ts) —
 *    persistir de novo aqui seria pagar o mesmo byte duas vezes.
 */
const NUNCA_PERSISTIR = new Set(['admin', 'uploads', 'upload-status', 'waveform', 'lyrics']);

/**
 * Um dia de validade: reabrir o app de manhã ainda pinta com os dados de ontem
 * (e revalida por trás); mais que isso o conteúdo já é outro mundo.
 */
const VALIDADE_MS = 24 * 3600_000;

/**
 * Muda quando o FORMATO do que está em cache muda de um jeito incompatível —
 * o restaurador descarta tudo em vez de hidratar páginas com um shape antigo.
 */
const VERSAO = 'v1';

/**
 * Liga a persistência ao QueryClient. Chamado uma vez, no App. Devolve a
 * promise da restauração — quem precisar saber quando o cache voltou (os
 * testes) pode esperar por ela; o app não espera: as queries montadas durante
 * a restauração ficam em pausa por construção do próprio persistQueryClient.
 */
export function ligarCacheDePaginas(
  queryClient: QueryClient,
  /** Só os testes mexem: o throttle de verdade é o de produção. */
  opcoes: { throttleMs?: number } = {},
): Promise<unknown> | null {
  if (typeof indexedDB === 'undefined') return null; // SSR/teste sem IDB: segue sem persistir
  const persister = createAsyncStoragePersister({
    storage: {
      getItem: (k) => noStore<string | undefined>('readonly', (s) => s.get(k)).then((v) => v ?? null),
      setItem: (k, v) => noStore('readwrite', (s) => s.put(v, k)).then(() => undefined),
      removeItem: (k) => noStore('readwrite', (s) => s.delete(k)).then(() => undefined),
    },
    key: CHAVE,
    // A cada mudança o cache INTEIRO é serializado. Com folga de 3s, digitar
    // uma busca não vira uma rajada de JSON.stringify de megabytes.
    throttleTime: opcoes.throttleMs ?? 3_000,
  });

  const dehydrateOptions = {
    shouldDehydrateQuery: (query: { state: { status: string }; queryKey: readonly unknown[] }) => {
      if (query.state.status !== 'success') return false;
      const raiz = query.queryKey[0];
      return typeof raiz !== 'string' || !NUNCA_PERSISTIR.has(raiz);
    },
  };

  const [, restaurado] = persistQueryClient({
    queryClient,
    persister,
    maxAge: VALIDADE_MS,
    buster: VERSAO,
    dehydrateOptions,
  });
  // A JANELA DO BOOT: o persister só se INSCREVE depois que a restauração
  // termina — é assim que o persistQueryClient evita gravar por cima do que
  // ainda vai ler. Só que as queries montadas nesse meio-tempo já emitiram os
  // eventos delas; sem esta gravação única, uma sessão curta (abrir, olhar a
  // Home, fechar) podia terminar sem persistir NADA do que buscou.
  return restaurado.then(() =>
    persistQueryClientSave({ queryClient, persister, buster: VERSAO, dehydrateOptions }),
  );
}

/** Só para inspeção manual/diagnóstico. */
export type { PersistedClient };
