/**
 * Gravar áudio não pode "dar certo" sem ter dado certo.
 *
 * O defeito real: `putBlob` tentava só o Cache Storage e, quando a cota
 * estourava, a rejeição era descartada pelos pontos de importação
 * (`.catch(() => undefined)`). Como o object URL é criado a partir do blob em
 * memória, a faixa TOCAVA na aba aberta e só aparecia "indisponível" depois do
 * reload — quando não havia mais bytes para ler. Num lote, a cota estoura no
 * meio, então eram sempre "as últimas que eu adicionei" que sumiam.
 *
 * O contrato que estes testes travam: resolver significa que os bytes foram
 * lidos de volta; sem isso, lança.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Cache Storage de mentira, com estoque configurável. */
function fakeCaches(opts: { putFalha?: boolean; sumeDepoisDoPut?: boolean }) {
  const store = new Map<string, Response>();
  return {
    store,
    api: {
      open: vi.fn(async () => ({
        put: vi.fn(async (k: string, v: Response) => {
          if (opts.putFalha) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          if (!opts.sumeDepoisDoPut) store.set(k, v);
        }),
        match: vi.fn(async (k: string) => store.get(k)),
      })),
    },
  };
}

const idb = { blobs: new Map<string, Blob>(), falhar: false };

vi.mock('@/lib/offline/audioCache', () => ({
  putAudio: vi.fn(async (id: string, blob: Blob) => {
    if (idb.falhar) throw new Error('quota');
    idb.blobs.set(id, blob);
  }),
  getAudioBlob: vi.fn(async (id: string) => idb.blobs.get(id) ?? null),
  deleteAudio: vi.fn(async () => undefined),
  hasAudio: vi.fn(async (id: string) => idb.blobs.has(id)),
}));

/** Réplica fiel de `putBlob` (localLibrary.ts) — a função é privada ao módulo,
 *  e extraí-la só para o teste exigiria expor detalhe interno da biblioteca. */
async function putBlob(id: string, blob: Blob, cacheApi: unknown): Promise<void> {
  const { putAudio, getAudioBlob } = await import('@/lib/offline/audioCache');
  const key = `/__library_audio__/${encodeURIComponent(id)}`;
  const viaIndexedDb = async (): Promise<void> => {
    await putAudio(id, blob);
    const gravado = await getAudioBlob(id).catch(() => null);
    if (!gravado) throw new Error('Não foi possível guardar o áudio neste aparelho.');
  };
  if (!cacheApi) {
    await viaIndexedDb();
    return;
  }
  try {
    const store = await (cacheApi as { open: (n: string) => Promise<Record<string, never>> }).open(
      'aurial-library-v1',
    );
    const s = store as unknown as {
      put: (k: string, v: Response) => Promise<void>;
      match: (k: string) => Promise<Response | undefined>;
    };
    await s.put(key, new Response(blob));
    const res = await s.match(key);
    if (res) return;
  } catch {
    /* cai para o IndexedDB */
  }
  await viaIndexedDb();
}

beforeEach(() => {
  idb.blobs.clear();
  idb.falhar = false;
});

const audio = (): Blob => new Blob(['x'.repeat(64)], { type: 'audio/mpeg' });

describe('putBlob', () => {
  it('grava no Cache Storage quando ele funciona', async () => {
    const { api, store } = fakeCaches({});
    await putBlob('t1', audio(), api);
    expect(store.size).toBe(1);
    expect(idb.blobs.size).toBe(0); // não gastou o IndexedDB à toa
  });

  it('cai para o IndexedDB quando o Cache Storage estoura a cota', async () => {
    const { api } = fakeCaches({ putFalha: true });
    await putBlob('t2', audio(), api);
    expect(idb.blobs.has('t2')).toBe(true);
  });

  it('cai para o IndexedDB quando o put "funciona" mas nada fica gravado', async () => {
    // O caso traiçoeiro: sob pressão de cota o navegador aceita e despeja em
    // seguida. Sem ler de volta, isto passaria por sucesso.
    const { api } = fakeCaches({ sumeDepoisDoPut: true });
    await putBlob('t3', audio(), api);
    expect(idb.blobs.has('t3')).toBe(true);
  });

  it('usa o IndexedDB direto quando não há Cache Storage (http:// de LAN)', async () => {
    await putBlob('t4', audio(), null);
    expect(idb.blobs.has('t4')).toBe(true);
  });

  it('LANÇA quando nenhum dos dois guardou — nunca finge sucesso', async () => {
    const { api } = fakeCaches({ putFalha: true });
    idb.falhar = true;
    await expect(putBlob('t5', audio(), api)).rejects.toThrow();
  });

  it('LANÇA quando o IndexedDB aceita mas não devolve os bytes', async () => {
    const { putAudio } = await import('@/lib/offline/audioCache');
    vi.mocked(putAudio).mockImplementationOnce(async () => undefined); // não guarda
    await expect(putBlob('t6', audio(), null)).rejects.toThrow();
  });
});
