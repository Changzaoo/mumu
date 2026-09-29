/**
 * LER O ÁUDIO BAIXADO: "não existe" e "não consegui ler" são respostas DIFERENTES.
 *
 * O registro de downloads mora no localStorage e é podado quando os bytes
 * somem do IndexedDB (despejo do navegador). O defeito: a leitura engolia
 * QUALQUER erro e respondia "não existe" — e a promessa de abertura do banco
 * ficava memoizada rejeitada para o resto da sessão. Um único tropeço do
 * IndexedDB (sistema derrubando a conexão com o app em segundo plano, WebView
 * acordando sem memória) fazia cada faixa baixada que se tentava tocar ser
 * apagada do registro. Offline, isso é a música baixada deixando de existir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Blob as BlobDoNode } from 'node:buffer';

// O Blob do jsdom não sobrevive ao `structuredClone` do IndexedDB falso (volta
// como objeto vazio); o do Node sobrevive — e é o que o banco real devolveria.
const bytes = (): Blob =>
  new BlobDoNode(['x'.repeat(32)], { type: 'audio/mpeg' }) as unknown as Blob;

beforeEach(() => {
  vi.stubGlobal('Blob', BlobDoNode);
  vi.resetModules(); // cada teste com a conexão memoizada zerada
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lerAudio', () => {
  it('distingue ausência (null) de falha (rejeita)', async () => {
    const cache = await import('@/lib/offline/audioCache');
    await cache.putAudio('t-existe', bytes());

    expect(await cache.lerAudio('t-existe')).toBeInstanceOf(BlobDoNode);
    expect(await cache.lerAudio('t-nunca-gravada')).toBeNull();

    const falha = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('conexão fechando', 'InvalidStateError');
    });
    await expect(cache.lerAudio('t-existe')).rejects.toThrow();
    falha.mockRestore();

    // E a conexão morta foi esquecida: a próxima leitura reabre e acha.
    expect(await cache.lerAudio('t-existe')).toBeInstanceOf(BlobDoNode);
  });

  it('uma falha ao ABRIR o banco não fica memoizada para a sessão inteira', async () => {
    const cache = await import('@/lib/offline/audioCache');
    await cache.putAudio('t-a', bytes());
    vi.resetModules();
    const fresco = await import('@/lib/offline/audioCache');

    const abrirOriginal = indexedDB.open.bind(indexedDB);
    const abrir = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      // Pedido de abertura que falha, do jeito que o navegador falha.
      const req = abrirOriginal('__banco-que-nao-importa__');
      const falso = {
        result: undefined,
        error: new DOMException('sem memória', 'UnknownError'),
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
      };
      req.onsuccess = () => {
        req.result.close();
        falso.onerror?.();
      };
      return falso as unknown as IDBOpenDBRequest;
    });

    await expect(fresco.lerAudio('t-a')).rejects.toThrow();
    abrir.mockRestore();

    // Antes: a promessa rejeitada ficava guardada e TODA leitura seguinte da
    // sessão falhava — as faixas baixadas "sumiam" até fechar o app.
    expect(await fresco.lerAudio('t-a')).toBeInstanceOf(BlobDoNode);
  });
});
