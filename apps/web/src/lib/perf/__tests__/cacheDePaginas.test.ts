/**
 * O CACHE DE PÁGINAS TEM QUE VOLTAR NO PRÓXIMO BOOT — e voltar CERTO.
 *
 * A promessa do módulo é uma só: o que uma página mostrou hoje pinta na hora
 * amanhã, sem esperar rede. Este arquivo trava as três partes dessa promessa:
 *
 *  1. dado com sucesso persiste e um QueryClient NOVO (o "boot seguinte")
 *     acorda com ele já em cache;
 *  2. o que não pode ressuscitar (admin, upload em voo…) fica de fora — um
 *     status "enviando" restaurado no boot seguinte seria mentira na tela;
 *  3. sem IndexedDB nenhum, o app segue de pé, só sem persistência.
 *
 * Cada teste zera o IndexedDB e REIMPORTA o módulo: a conexão com o banco é
 * memoizada lá dentro, e reaproveitá-la entre testes seria testar a memória do
 * teste anterior, não o boot seguinte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { QueryClient } from '@tanstack/react-query';

type Modulo = typeof import('@/lib/perf/cacheDePaginas');

function novoCliente(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 3_600_000, staleTime: 3_600_000 } },
  });
}

/** O throttle nos testes é 20ms; 300ms é folga de sobra para a gravação sair. */
const esperarGravacao = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

let ligarCacheDePaginas: Modulo['ligarCacheDePaginas'];

beforeEach(async () => {
  indexedDB = new IDBFactory(); // banco zerado: cada teste é um "aparelho" novo
  vi.resetModules();
  ({ ligarCacheDePaginas } = await import('@/lib/perf/cacheDePaginas'));
});

describe('cache de páginas persistido', () => {
  it('o que uma página buscou hoje já está lá no boot seguinte', async () => {
    const hoje = novoCliente();
    ligarCacheDePaginas(hoje, { throttleMs: 20 });
    await hoje.prefetchQuery({
      queryKey: ['home'],
      queryFn: () => Promise.resolve({ prateleiras: ['novidades'] }),
    });
    await esperarGravacao();
    // Nada de `hoje.clear()`: o persister continua inscrito no cliente antigo,
    // e limpar o cache dele gravaria um cache VAZIO por cima do que se quer
    // testar. No app de verdade não existe "clear" — existe fechar a aba.

    // "Boot seguinte": outro QueryClient, mesmo IndexedDB.
    const amanha = novoCliente();
    const restaurado = ligarCacheDePaginas(amanha, { throttleMs: 20 });
    expect(restaurado).not.toBeNull();
    await restaurado;
    expect(amanha.getQueryData(['home'])).toEqual({ prateleiras: ['novidades'] });
  });

  it('o que não pode ressuscitar fica de fora', async () => {
    const hoje = novoCliente();
    ligarCacheDePaginas(hoje, { throttleMs: 20 });
    await hoje.prefetchQuery({
      queryKey: ['upload-status', 'x'],
      queryFn: () => Promise.resolve({ enviando: true }),
    });
    await hoje.prefetchQuery({
      queryKey: ['catalog', 'trending', null],
      queryFn: () => Promise.resolve([{ id: 't1' }]),
    });
    await esperarGravacao();

    const amanha = novoCliente();
    await ligarCacheDePaginas(amanha, { throttleMs: 20 });
    expect(amanha.getQueryData(['catalog', 'trending', null])).toEqual([{ id: 't1' }]);
    expect(amanha.getQueryData(['upload-status', 'x'])).toBeUndefined();
  });

  it('sem IndexedDB (SSR/teste), não liga e não quebra', () => {
    const guardado = globalThis.indexedDB;
    // @ts-expect-error — simulando ambiente sem IDB
    delete globalThis.indexedDB;
    try {
      expect(ligarCacheDePaginas(novoCliente())).toBeNull();
    } finally {
      globalThis.indexedDB = guardado;
    }
  });
});
