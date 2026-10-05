/**
 * A LEITURA DO REGISTRO NÃO PODE SER UMA TAREFA LONGA.
 *
 * Telemetria do Moto G34 do dono: tarefas de 636, 457 e 457 ms em
 * `IDBRequest.onsuccess`, todas no mesmo instante do boot, na leitura paginada
 * do registro (5,7 mil faixas). O custo é a desserialização (structured clone)
 * dos registros de cada página, na thread principal. Páginas de 400 eram
 * grandes demais e nada devolvia a vez entre elas.
 *
 * Aqui se trava o contrato, sem medir tempo (isso é a bancada `perf:g34`):
 *   1. nenhuma página lê mais que `LEITURA_PAGINA_MAX` registros;
 *   2. a thread é cedida ENTRE as páginas;
 *   3. o resultado é idêntico ao da leitura antiga (mesma ordem, mesmo conteúdo);
 *   4. o tamanho da página se adapta ao custo medido, sem nunca passar do teto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { makeTrack } from '@/test/factories';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibrary from '@/lib/local/localLibrary';

vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
  subscribeCatalogo: () => () => undefined,
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));

/** Conta quantas vezes a thread foi cedida (e ainda cede de verdade). */
const cedidas = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/perf/ceder', () => ({
  cederAThread: () => {
    cedidas.n += 1;
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  },
}));

const TOTAL = 1_000;

function entrada(i: number): LibraryEntry {
  return {
    track: makeTrack(`local:${String(i).padStart(5, '0')}`, { title: `Faixa ${i}` }),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000 + i,
    mimeType: 'audio/mpeg',
    remoteUrl: `https://importer.exemplo.test/blob/${i}`,
  };
}

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aurial-registro-faixas', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('faixas')) req.result.createObjectStore('faixas');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function semear(entradas: LibraryEntry[]): Promise<void> {
  const db = await abrirBanco();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('faixas', 'readwrite');
    const store = tx.objectStore('faixas');
    store.clear();
    // Fora de ordem de propósito: quem manda é a ordem das CHAVES do banco.
    for (const e of [...entradas].reverse()) store.put(e, e.track.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** A leitura ANTIGA, como oráculo: um `getAll` só, tudo de uma vez. */
async function lerComoAntes(): Promise<LibraryEntry[]> {
  const db = await abrirBanco();
  const tudo = await new Promise<LibraryEntry[]>((resolve, reject) => {
    const req = db.transaction('faixas', 'readonly').objectStore('faixas').getAll();
    req.onsuccess = () => resolve(req.result as LibraryEntry[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return tudo;
}

async function montar(): Promise<typeof LocalLibrary> {
  vi.resetModules();
  return import('@/lib/local/localLibrary');
}

describe('leitura do registro em páginas pequenas', () => {
  let paginas: number[];
  let getAll: { mockRestore: () => void };

  beforeEach(async () => {
    window.localStorage.clear();
    cedidas.n = 0;
    paginas = [];
    const original = IDBObjectStore.prototype.getAll;
    getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['getAll']>
    ) {
      if (this.name === 'faixas') paginas.push(Number(args[1] ?? Infinity));
      return original.apply(this, args);
    });
    await semear(Array.from({ length: TOTAL }, (_, i) => entrada(i)));
  });

  afterEach(() => {
    getAll.mockRestore();
  });

  it('nenhuma página lê mais que o teto', async () => {
    const lib = await montar();
    await lib.hydrate();

    expect(paginas.length).toBeGreaterThan(1);
    for (const tamanho of paginas) {
      expect(tamanho).toBeLessThanOrEqual(lib.LEITURA_PAGINA_MAX);
    }
    // E o teto é bem menor que as 400 de antes, que mediram 457–636 ms no g34.
    expect(lib.LEITURA_PAGINA_MAX).toBeLessThanOrEqual(200);
    // `Infinity` seria uma leitura sem limite.
    expect(paginas.every((p) => Number.isFinite(p))).toBe(true);
  });

  it('cede a thread entre as páginas', async () => {
    const lib = await montar();
    await lib.hydrate();

    // Uma cedida por página (menos a última) — o resto vem de outras fases.
    expect(cedidas.n).toBeGreaterThanOrEqual(paginas.length - 1);
  });

  it('o resultado é idêntico ao da leitura antiga: mesma ordem, mesmo conteúdo', async () => {
    const antes = await lerComoAntes();
    expect(antes).toHaveLength(TOTAL);

    const lib = await montar();
    const hidratando = lib.hydrate();
    // Logo que o registro cai do disco — antes das fases seguintes da hidratação.
    await lib.registroPronto();
    const lido = lib.list();
    await hidratando;

    expect(lido).toEqual(antes);
    expect(lido.map((e) => e.track.id)).toEqual(antes.map((e) => e.track.id));
  });

  it('o tamanho da página se adapta ao custo medido e respeita piso e teto', async () => {
    const lib = await montar();
    // Aparelho rápido (0,1 ms por registro → página de 40 custou 4 ms): cresce até o teto.
    expect(lib.tamanhoDaProximaPagina(40, 0.4)).toBe(lib.LEITURA_PAGINA_MAX);
    // Página que "custou 0" (relógio grosso) não manda o tamanho para o infinito.
    expect(lib.tamanhoDaProximaPagina(40, 0)).toBeLessThanOrEqual(lib.LEITURA_PAGINA_MAX);
    // A página seguinte é dimensionada para custar ~`LEITURA_ALVO_MS`: se 40
    // registros custaram 20 ms (0,5 ms cada), 40 continua sendo o tamanho certo;
    // se custaram 40 ms, metade.
    expect(lib.tamanhoDaProximaPagina(40, lib.LEITURA_ALVO_MS)).toBe(40);
    expect(lib.tamanhoDaProximaPagina(100, lib.LEITURA_ALVO_MS)).toBe(100);
    expect(lib.tamanhoDaProximaPagina(80, 2 * lib.LEITURA_ALVO_MS)).toBe(40);
    // Muito lento: o piso segura (uma página nunca vira zero registros).
    expect(lib.tamanhoDaProximaPagina(40, 10_000)).toBe(lib.LEITURA_PAGINA_MIN);
  });
});
