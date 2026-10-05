/**
 * AUDIOCACHE: contrato de gravação e leitura do IndexedDB.
 *
 * "Gravei" só vale no commit; sem IndexedDB a escrita falha ALTO (nunca no-op
 * silencioso); áudio e capa dividem o store sem se pisar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as BlobDoNode } from 'node:buffer';

const bytes = (t = 'x'.repeat(32)): Blob =>
  new BlobDoNode([t], { type: 'audio/mpeg' }) as unknown as Blob;

beforeEach(() => {
  vi.stubGlobal('Blob', BlobDoNode);
  vi.stubGlobal('indexedDB', new IDBFactory()); // banco novo por teste
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('audioCache', () => {
  it('sem IndexedDB (contexto sem suporte): escrever REJEITA, ler responde "não tenho"', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const cache = await import('@/lib/offline/audioCache');

    expect(cache.cacheSupported()).toBe(false);
    await expect(cache.putAudio('a', bytes())).rejects.toBeTruthy();
    await expect(cache.putCover('a', bytes())).rejects.toBeTruthy();
    expect(await cache.hasAudio('a')).toBe(false);
    expect(await cache.getAudioBlob('a')).toBeNull();
    expect((await cache.allAudioIds()).size).toBe(0);
  });

  it('só resolve a escrita no COMMIT: transação abortada rejeita e nada fica gravado', async () => {
    const cache = await import('@/lib/offline/audioCache');
    const original = IDBObjectStore.prototype.put;
    const espia = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      ...a: Parameters<IDBObjectStore['put']>
    ) {
      const req = original.apply(this, a);
      this.transaction.abort();
      return req;
    });

    await expect(cache.putAudio('abortada', bytes())).rejects.toBeTruthy();
    espia.mockRestore();

    expect(await cache.hasAudio('abortada')).toBe(false);
  });

  it('áudio e capa do mesmo id coexistem; apagar o áudio preserva a capa e vice-versa', async () => {
    const cache = await import('@/lib/offline/audioCache');
    await cache.putAudio('t1', bytes('audio'));
    await cache.putCover('t1', bytes('capa'));

    await cache.deleteAudio('t1');
    expect(await cache.hasAudio('t1')).toBe(false);
    expect(await cache.getCoverBlob('t1')).not.toBeNull();

    await cache.putAudio('t1', bytes('audio'));
    await cache.deleteCover('t1');
    expect(await cache.hasAudio('t1')).toBe(true);
    expect(await cache.getCoverBlob('t1')).toBeNull();
  });

  it('duas gravações simultâneas da MESMA chave terminam íntegras (a última vence)', async () => {
    const cache = await import('@/lib/offline/audioCache');
    await Promise.all([
      cache.putAudio('dup', bytes('primeira')),
      cache.putAudio('dup', bytes('segunda!')),
    ]);
    const lido = await cache.getAudioBlob('dup');
    expect(lido?.size).toBeGreaterThan(0);
    expect((await cache.allAudioIds()).size).toBe(1);
  });

  it('1.000 chaves listam numa pergunta só (uma transação, não 1.000)', async () => {
    const cache = await import('@/lib/offline/audioCache');
    for (let i = 0; i < 1000; i++) await cache.putAudio(`id${i}`, bytes('a'));
    const espia = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const ids = await cache.allAudioIds();
    expect(ids.size).toBe(1000);
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it('banco já aberto numa versão ANTIGA do esquema (sem store) falha alto em vez de fingir', async () => {
    // Um banco `aurial-offline` v1 criado sem o object store (instalação
    // interrompida): a leitura tolera (null), a escrita precisa rejeitar.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('aurial-offline', 1);
      r.onupgradeneeded = () => undefined; // não cria o store
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    const cache = await import('@/lib/offline/audioCache');
    await expect(cache.putAudio('x', bytes())).rejects.toBeTruthy();
    expect(await cache.getAudioBlob('x')).toBeNull();
  });
});
