/**
 * O CATÁLOGO NO DISCO É TEXTO EM BLOCOS — nunca um objeto de 2,6 MB.
 *
 * Telemetria do Moto G34 do dono: 353 ms numa tarefa (`IDBTransaction.oncomplete`)
 * gravando/lendo o catálogo inteiro como UM valor. Gravar um objeto com 5,7 mil
 * faixas serializa tudo na thread principal; gravar STRINGS é copiar bytes.
 *
 * O que continua valendo e é testado aqui:
 *  - o ETag vai junto, no mesmo registro, e 304 NÃO regrava nada;
 *  - o formato antigo (`{ etag, entradas }`) ainda é lido;
 *  - quem lê recebe exatamente as mesmas entradas que quem gravou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type * as CatalogoApi from '@/lib/sync/catalogoApi';

vi.mock('@/lib/firebase', () => ({ getIdToken: () => Promise.resolve(null) }));
vi.mock('@/lib/sync/syncStatus', () => ({
  registrarErro: vi.fn(),
  registrarSnapshot: vi.fn(),
}));

const faixa = (i: number): Record<string, unknown> => ({
  track: { id: `local:${i}`, title: `Faixa ${i}`, artists: [{ name: 'Banda' }] },
  addedAt: '2026-01-01T00:00:00.000Z',
});

function resposta(body: unknown, etag: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aurial-catalogo', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('snapshot'))
        req.result.createObjectStore('snapshot');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function lerBruto(): Promise<unknown> {
  const db = await abrir();
  const valor = await new Promise<unknown>((resolve) => {
    const req = db.transaction('snapshot', 'readonly').objectStore('snapshot').get('atual');
    req.onsuccess = () => resolve(req.result);
  });
  db.close();
  return valor;
}

async function gravarBruto(valor: unknown): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve) => {
    const tx = db.transaction('snapshot', 'readwrite');
    if (valor === undefined) tx.objectStore('snapshot').clear();
    else tx.objectStore('snapshot').put(valor, 'atual');
    tx.oncomplete = () => resolve();
  });
  db.close();
}

/** Espera uma condição assíncrona (o módulo grava na folga do navegador). */
async function ate(condicao: () => Promise<boolean> | boolean, ms = 5_000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condição não aconteceu a tempo');
}

describe('catálogo em disco: texto em blocos', () => {
  let api: typeof CatalogoApi;
  let fetchMock: ReturnType<typeof vi.fn>;
  let puts: unknown[];
  let put: { mockRestore: () => void };

  beforeEach(async () => {
    await gravarBruto(undefined);
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    puts = [];
    const original = IDBObjectStore.prototype.put;
    put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'snapshot') puts.push(args[0]);
      return original.apply(this, args);
    });
    api = await import('@/lib/sync/catalogoApi');
  });

  afterEach(() => {
    put.mockRestore();
    vi.unstubAllGlobals();
  });

  it('grava blocos de texto (strings) com o ETag junto — não um objeto gigante', async () => {
    const todas = Array.from({ length: 600 }, (_, i) => faixa(i));
    fetchMock.mockResolvedValueOnce(resposta({ data: todas }, 'W/"600-1"'));

    const recebidas: unknown[][] = [];
    const parar = api.subscribeCatalogo((e) => recebidas.push(e));
    await ate(() => puts.length > 0);
    parar();

    expect(recebidas).toHaveLength(1);
    const gravado = (await lerBruto()) as { formato: string; etag: string; blocos: unknown[] };
    expect(gravado.formato).toBe('blocos-json');
    expect(gravado.etag).toBe('W/"600-1"');
    expect(gravado.blocos).toHaveLength(Math.ceil(600 / api.FAIXAS_POR_BLOCO));
    // Texto: clonar string é copiar bytes, não percorrer 5,7 mil objetos.
    for (const bloco of gravado.blocos) expect(typeof bloco).toBe('string');
    // Nenhuma entrada solta no valor gravado.
    expect((gravado as unknown as { entradas?: unknown }).entradas).toBeUndefined();
  });

  it('entrega o acervo ANTES de gravar (a gravação não segura a lista)', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ data: [faixa(1)] }, 'W/"1-1"'));
    let gravadoAoEntregar = -1;
    const parar = api.subscribeCatalogo(() => {
      gravadoAoEntregar = puts.length;
    });
    await ate(() => puts.length > 0);
    parar();
    expect(gravadoAoEntregar).toBe(0);
  });

  it('o que foi gravado volta idêntico na abertura seguinte, e 304 não regrava nada', async () => {
    const todas = Array.from({ length: 600 }, (_, i) => faixa(i));
    fetchMock.mockResolvedValueOnce(resposta({ data: todas }, 'W/"600-1"'));
    const parar1 = api.subscribeCatalogo(() => undefined);
    await ate(() => puts.length > 0);
    parar1();
    const gravacoes = puts.length;

    // "Reabre o app": módulo novo, o disco é o que sobrou.
    vi.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(resposta(null, 'W/"600-1"', 304));
    const api2 = await import('@/lib/sync/catalogoApi');
    const recebidas: unknown[][] = [];
    const parar2 = api2.subscribeCatalogo((e) => recebidas.push(e));
    await ate(() => fetchMock.mock.calls.length > 0 && recebidas.length > 0);
    await new Promise((r) => setTimeout(r, 400)); // dá tempo de uma gravação indevida acontecer
    parar2();

    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]).toEqual(todas);
    // O ETag do disco foi para a rede: sem ele o servidor mandaria o corpo inteiro.
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: { 'If-None-Match': 'W/"600-1"' } });
    // 304 e disco já no formato novo: nada foi regravado.
    expect(puts.length).toBe(gravacoes);
  });

  it('lê o formato antigo e o regrava no novo, uma vez', async () => {
    const antigas = Array.from({ length: 10 }, (_, i) => faixa(i));
    await gravarBruto({ etag: 'W/"10-1"', entradas: antigas });
    puts.length = 0;
    fetchMock.mockResolvedValueOnce(resposta(null, 'W/"10-1"', 304));

    const recebidas: unknown[][] = [];
    const parar = api.subscribeCatalogo((e) => recebidas.push(e));
    await ate(() => recebidas.length > 0);
    await ate(() => puts.length > 0);
    parar();

    expect(recebidas[0]).toEqual(antigas);
    const gravado = (await lerBruto()) as { formato?: string; etag: string };
    expect(gravado.formato).toBe('blocos-json');
    expect(gravado.etag).toBe('W/"10-1"');
  });
});
