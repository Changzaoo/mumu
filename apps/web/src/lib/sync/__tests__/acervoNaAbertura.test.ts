/**
 * QUANTAS VEZES A BIBLIOTECA MUDA DE TAMANHO NA CARA DE QUEM ABRE O APP.
 *
 * O relato foi: "ao abrir, ele carrega 3 acervos antes de mostrar todas as
 * músicas". Não é o boot ser lento — é a lista aparecer em ONDAS. Primeiro as
 * poucas faixas do próprio aparelho, depois o acervo do disco, depois o acervo
 * da rede. Cada onda repinta a tela com uma contagem diferente, e é isso que se
 * vê como "carregando três vezes".
 *
 * A causa é estrutural e está em dois lugares:
 *
 *  1. O acervo NÃO mora no registro (`flushWrite` filtra `origem: 'catalogo'`
 *     de propósito — ver localLibrary.ts). Ele tem cofre próprio em disco, mas
 *     esse cofre só era lido DEPOIS da hidratação inteira.
 *  2. `catalogoBoot` esperava `hydrate()` completo — que inclui restaurar até
 *     150 capas em lotes com folga de quadro entre eles. O acervo, que para a
 *     maioria das pessoas É a biblioteca, entrava na fila atrás disso.
 *
 * Este arquivo não mede tempo (isso é o arnês de `desempenho.spec.ts`). Mede
 * ONDAS: cada notificação da biblioteca em que a contagem de faixas mudou. Um
 * boot honesto tem UMA — a tela nasce com tudo o que o aparelho já sabia.
 *
 * A segunda onda legítima existe e está testada aqui: quando o servidor
 * responde com acervo DIFERENTE do que estava em disco, a lista tem mesmo que
 * crescer. O que não pode é ela crescer quando nada mudou (304).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  authDisabled: true,
  getIdToken: () => Promise.resolve(null),
  subscribeAuth: () => () => undefined,
}));
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

/** Faixa do acervo: sem cópia local, tocável pelo bit (ver `temComoTocar`). */
function doAcervo(id: string): LibraryEntry {
  return {
    track: makeTrack(id, { streamUrl: null }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 4_000_000,
    mimeType: 'audio/mpeg',
    tocavel: true,
    origem: 'catalogo',
  };
}

/** Faixa importada pela pessoa: mora no registro do aparelho. */
function minha(id: string): LibraryEntry {
  return {
    track: makeTrack(id, { streamUrl: null }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 4_000_000,
    mimeType: 'audio/mpeg',
    remoteUrl: `https://importer.exemplo.test/blob/${id}`,
  };
}

function gravar(banco: string, store: string, chave: string, valor: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(banco, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(valor, chave);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Deixa o boot assentar: nada de novo por `quieto` ms seguidos. */
async function assentar(quieto = 700, teto = 6000): Promise<void> {
  const limite = Date.now() + teto;
  let ultimo = Date.now();
  const marcar = (): void => {
    ultimo = Date.now();
  };
  const { subscribe } = await import('@/lib/local/localLibrary');
  const parar = subscribe(marcar);
  while (Date.now() < limite && Date.now() - ultimo < quieto) {
    await new Promise((r) => setTimeout(r, 50));
  }
  parar();
}

const ACERVO = Array.from({ length: 120 }, (_, i) => doAcervo(`cat:${i}`));
const MINHAS = Array.from({ length: 8 }, (_, i) => minha(`local:${i}`));

interface Boot {
  /** Contagem da lista a cada notificação em que ela MUDOU de tamanho. */
  ondas: number[];
  total: number;
}

/**
 * Roda a abertura do app na MESMA ordem do App.tsx e devolve as ondas.
 *
 * `resposta` decide o que o servidor diz quando o app revalida o acervo.
 */
async function abrirOApp(resposta: 'sem-novidade' | 'acervo-maior'): Promise<Boot> {
  vi.resetModules();

  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: string) => {
      const url = String(entrada);
      if (!url.includes('/catalogo')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (resposta === 'sem-novidade') {
        return Promise.resolve(new Response(null, { status: 304 }));
      }
      const maior = [...ACERVO, doAcervo('cat:novissima')];
      return Promise.resolve(
        new Response(JSON.stringify({ data: maior }), {
          status: 200,
          headers: { ETag: '"v2"', 'Content-Type': 'application/json' },
        }),
      );
    }),
  );

  const biblioteca = await import('@/lib/local/localLibrary');
  const { initCatalogo } = await import('@/lib/sync/catalogoBoot');

  const ondas: number[] = [];
  let anterior = -1;
  const parar = biblioteca.subscribe(() => {
    const n = biblioteca.list().length;
    if (n !== anterior) {
      anterior = n;
      ondas.push(n);
    }
  });

  // A ORDEM DO App.tsx: hidrata a biblioteca, depois liga o acervo.
  await biblioteca.hydrate();
  initCatalogo();
  await assentar();
  parar();

  return { ondas, total: biblioteca.list().length };
}

describe('o acervo na abertura do app', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    // O aparelho de quem VOLTA ao app: registro com o que é dele, cofre do
    // acervo com o que o servidor já tinha mandado da última vez.
    await gravar('aurial-registro', 'biblioteca', 'entradas', MINHAS);
    await gravar('aurial-catalogo', 'snapshot', 'atual', { etag: '"v1"', entradas: ACERVO });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra tudo de uma vez, sem carregar o acervo em ondas', async () => {
    const { ondas, total } = await abrirOApp('sem-novidade');

    // O aparelho JÁ SABIA de tudo isto antes de abrir: as faixas dele no
    // registro e o acervo no cofre. Nada aqui depende da rede.
    expect(total).toBe(MINHAS.length + ACERVO.length);
    // UMA onda: a lista nasce completa. Duas ou três é o sintoma relatado.
    expect(ondas).toEqual([total]);
  });

  it('o servidor sem novidade (304) não repinta a biblioteca', async () => {
    const { ondas } = await abrirOApp('sem-novidade');
    expect(ondas).toHaveLength(1);
  });

  it('acervo que MUDOU de verdade continua chegando na tela', async () => {
    const { ondas, total } = await abrirOApp('acervo-maior');

    // Aqui a segunda onda é legítima: o admin publicou faixa nova.
    expect(total).toBe(MINHAS.length + ACERVO.length + 1);
    expect(ondas).toEqual([MINHAS.length + ACERVO.length, total]);
  });
});
