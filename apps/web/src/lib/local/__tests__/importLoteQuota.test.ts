/**
 * COTA ESTOURA NO MEIO DE UM LOTE: as primeiras ficam, as últimas NÃO viram
 * faixa fantasma, e nada sobra órfão no disco.
 *
 * IndexedDB real (fake-indexeddb) e `importFiles` real; só a leitura de tags é
 * trocada, para dar a todas as faixas uma capa embutida — é a capa que prova o
 * vazamento: ela é gravada ANTES do áudio, então um áudio recusado deixava a
 * imagem para trás para sempre (nenhum registro aponta para ela, ninguém a apaga).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Blob as BlobDoNode, File as FileDoNode } from 'node:buffer';

vi.mock('@/lib/local/audioTags', async (orig) => {
  const real = await orig<typeof import('@/lib/local/audioTags')>();
  return {
    ...real,
    readAudioTags: vi.fn(async (f: File) => ({
      title: f.name.replace(/\.mp3$/, ''),
      artist: 'Banda',
      album: null,
      composer: null,
      publisher: null,
      year: null,
      trackNumber: null,
      // PNG 1x1 válido
      coverDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    })),
  };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** MP3 mínimo que passa no sniff (frame sync) e é único por nome (hash distinto). */
function mp3(nome: string): File {
  const bytes = new Uint8Array(2048);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  for (let i = 0; i < nome.length; i++) bytes[16 + i] = nome.charCodeAt(i);
  return new FileDoNode([bytes], `${nome}.mp3`, { type: 'audio/mpeg' }) as unknown as File;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake/${Math.random()}`,
    revokeObjectURL: () => undefined,
  });
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('importFiles com cota estourando no meio do lote', () => {
  it('a faixa recusada não entra no registro nem deixa capa órfã; a anterior fica íntegra', async () => {
    vi.stubGlobal('Blob', BlobDoNode);
    // Sem decodificador no jsdom: o elemento falha na hora em vez de esperar o
    // teto de 8s por arquivo.
    vi.stubGlobal(
      'Audio',
      class {
        preload = '';
        duration = NaN;
        addEventListener(ev: string, cb: () => void): void {
          if (ev === 'error') setTimeout(cb, 0);
        }
        set src(_v: string) {}
      },
    );
    // jsdom não resolve fetch(data:) — devolve a capa como Blob do Node.
    vi.stubGlobal('fetch', async () => ({
      blob: async () => new BlobDoNode(['x'.repeat(100)], { type: 'image/png' }),
    }));
    const cache = await import('@/lib/offline/audioCache');
    const lib = await import('@/lib/local/localLibrary');

    // Cota: o SEGUNDO áudio (chave que não é `cover:`) é recusado.
    const original = IDBObjectStore.prototype.put;
    let audios = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const chave = String(args[1]);
      if (!chave.startsWith('cover:') && ++audios === 2) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.apply(this, args);
    });

    const importadas = await lib.importFiles([mp3('um'), mp3('dois'), mp3('tres')]);

    expect(importadas.map((t) => t.title).sort()).toEqual(['tres', 'um']);
    const ids = new Set(lib.list().map((e) => e.track.id));
    expect(ids.size).toBe(2);
    // Toda faixa do registro TEM bytes no disco...
    for (const id of ids) expect(await cache.hasAudio(id)).toBe(true);
    // ...e todo byte de áudio no disco tem faixa no registro...
    expect([...(await cache.allAudioIds())].sort()).toEqual([...ids].sort());
    // ...e nenhuma capa ficou sem dono.
    const capas = await cache.allCoverIds();
    for (const id of capas) expect(ids.has(id)).toBe(true);
    // Guarda contra teste vazio: o cenário só vale se as capas foram mesmo gravadas.
    expect(capas.size).toBeGreaterThan(0);
  });
});

describe('http:// de LAN (sem Cache Storage): gravar nunca é no-op', () => {
  const meta = (id: string) => ({
    id,
    title: 'Recebida',
    artist: 'Amigo',
    album: null,
    durationMs: 1000,
    mimeType: 'audio/mpeg',
    coverDataUrl: null,
  });

  it('grava no IndexedDB, e depois de "recarregar" a faixa ainda abre', async () => {
    vi.stubGlobal('Blob', BlobDoNode);
    vi.stubGlobal('caches', undefined); // contexto inseguro: a API some
    const lib = await import('@/lib/local/localLibrary');
    const bytes = new BlobDoNode(['x'.repeat(256)], { type: 'audio/mpeg' }) as unknown as Blob;

    const track = await lib.saveReceivedTrack(meta('local:lan-1') as never, bytes);

    // Recarga: módulo novo, mesmo IndexedDB.
    vi.resetModules();
    const lib2 = await import('@/lib/local/localLibrary');
    expect(await lib2.hasStoredAudio(track.id)).toBe(true);
    expect(await lib2.ensureLocalAudioUrl(track.id)).toMatch(/^blob:/);
  });

  it('sem espaço no IndexedDB: FALHA ALTO e não registra a faixa', async () => {
    vi.stubGlobal('Blob', BlobDoNode);
    vi.stubGlobal('caches', undefined);
    const lib = await import('@/lib/local/localLibrary');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const bytes = new BlobDoNode(['x'.repeat(256)], { type: 'audio/mpeg' }) as unknown as Blob;

    await expect(lib.saveReceivedTrack(meta('local:lan-2') as never, bytes)).rejects.toBeTruthy();

    expect(lib.has('local:lan-2')).toBe(false);
  });
});
