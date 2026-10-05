/**
 * O DOWNLOAD OFFLINE NÃO PODE MENTIR — registro e bytes andam juntos.
 *
 * Usa o IndexedDB e o registro (localStorage) REAIS; só a rede é falsa. O que
 * se prova aqui é o contrato do usuário: "baixada" significa que toca sem
 * internet, e falha tem causa dita de forma clara, sem ficar pendurada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Blob as BlobDoNode } from 'node:buffer';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/api', () => ({
  isFirstPartyUrl: (u: string) => u.startsWith('https://api.aurial'),
}));
const getIdToken = vi.fn(async () => 'TOKEN-NOSSO');
vi.mock('@/lib/firebase', () => ({ getIdToken: () => getIdToken() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));
vi.mock('@/stores/notificationsStore', () => ({ pushNotification: vi.fn() }));

const faixa = (id: string, downloadUrl = `https://cdn.exemplo/${id}.mp3`): TrackDto =>
  ({ id, title: `Faixa ${id}`, artists: [], durationMs: 1000, downloadUrl }) as unknown as TrackDto;

interface Resposta {
  status?: number;
  corpo?: Uint8Array[];
  headers?: Record<string, string>;
  /** Lança no meio da leitura do corpo (rede caiu). */
  quebraNoMeio?: boolean;
}

/** Response de mentira com `body.getReader()` — o que o downloadManager lê. */
function resposta(r: Resposta): Response {
  const status = r.status ?? 200;
  const partes = [...(r.corpo ?? [new Uint8Array(64)])];
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(r.headers ?? { 'Content-Type': 'audio/mpeg' }),
    body: {
      getReader: () => ({
        read: async () => {
          if (r.quebraNoMeio && i === 1) throw new TypeError('network error');
          const value = partes[i++];
          return value ? { done: false, value } : { done: true, value: undefined };
        },
      }),
    },
  } as unknown as Response;
}

let alcas = 0;
const abertas = new Set<string>();

async function montar() {
  vi.resetModules();
  window.localStorage.clear();
  const dm = await import('@/features/downloads/downloadManager');
  const reg = await import('@/features/downloads/registry');
  const cache = await import('@/lib/offline/audioCache');
  return { dm, reg, cache };
}

beforeEach(() => {
  vi.stubGlobal('Blob', BlobDoNode);
  alcas = 0;
  abertas.clear();
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const u = `blob:fake/${alcas++}`;
      abertas.add(u);
      return u;
    },
    revokeObjectURL: (u: string) => abertas.delete(u),
  });
  getIdToken.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('download: gravação com prova', () => {
  it('caminho feliz: bytes no IndexedDB E registro, mesma chave (track.id)', async () => {
    const { dm, reg, cache } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(100)] })),
    );

    await dm.downloadTrack(faixa('a'));

    expect(reg.isDownloaded('a')).toBe(true);
    expect(await cache.hasAudio('a')).toBe(true);
    expect(dm.downloadStateOf('a').status).toBe('downloaded');
  });

  it('QUOTA estourada na gravação: sem registro órfão, estado de erro e mensagem específica', async () => {
    const { dm, reg, cache } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(100)] })),
    );
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      void original;
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await expect(dm.downloadTrack(faixa('q'))).rejects.toThrow(/Sem espaço/);

    expect(reg.isDownloaded('q')).toBe(false);
    expect(dm.downloadStateOf('q').status).toBe('error');
    vi.restoreAllMocks();
    expect(await cache.hasAudio('q')).toBe(false);
  });

  it('quota que ABORTA a transação depois do put: rejeita, não registra', async () => {
    const { dm, reg } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(100)] })),
    );
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const req = original.apply(this, args);
      this.transaction.abort(); // o commit nunca acontece
      return req;
    });

    vi.useFakeTimers();
    const p = dm.downloadTrack(faixa('abort')).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeInstanceOf(Error);
    expect(reg.isDownloaded('abort')).toBe(false);
  });

  it('o MESMO id em paralelo baixa UMA vez só', async () => {
    const { dm } = await montar();
    const f = vi.fn(async () => resposta({ corpo: [new Uint8Array(100)] }));
    vi.stubGlobal('fetch', f);

    await Promise.all([dm.downloadTrack(faixa('p')), dm.downloadTrack(faixa('p'))]);

    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rede cai NO MEIO do corpo: tenta de novo e conclui, sem registro parcial', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        resposta({ corpo: [new Uint8Array(10), new Uint8Array(10)], quebraNoMeio: true }),
      )
      .mockResolvedValue(resposta({ corpo: [new Uint8Array(20)] }));
    vi.stubGlobal('fetch', f);

    const p = dm.downloadTrack(faixa('r'));
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(f).toHaveBeenCalledTimes(2);
    expect(reg.getDownloads().find((e) => e.track.id === 'r')?.sizeBytes).toBe(20);
  });

  it('sem Content-Length: progresso indeterminado (-1), nunca barra travada em 0', async () => {
    const { dm } = await montar();
    const vistos: number[] = [];
    dm.subscribeDownloadManager(() => vistos.push(dm.downloadStateOf('i').progress));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(5), new Uint8Array(5)] })),
    );

    await dm.downloadTrack(faixa('i'));

    expect(vistos).toContain(-1);
    expect(vistos.every((p) => p === -1 || p === 1 || p === 0)).toBe(true);
  });

  it('não manda o token nosso para CDN de terceiros, mas manda para a nossa API', async () => {
    const { dm } = await montar();
    const f = vi.fn(async () => resposta({ corpo: [new Uint8Array(8)] }));
    vi.stubGlobal('fetch', f);

    await dm.downloadTrack(faixa('terceiro', 'https://cdn.audius.co/x.mp3'));
    await dm.downloadTrack(faixa('nosso', 'https://api.aurial/stream/x'));

    const h = (n: number) => (f.mock.calls[n] as unknown as [string, RequestInit])[1].headers;
    expect(h(0)).toEqual({});
    expect(h(1)).toEqual({ Authorization: 'Bearer TOKEN-NOSSO' });
  });

  it('download que nunca responde é abortado por timeout (não fica pendurado)', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () =>
            rej(new DOMException('abort', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', f);

    const p = dm.downloadTrack(faixa('t')).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(290_000); // 3x90s + backoff, antes da retomada automática (3 min depois)
    const erro = await p;

    expect(erro).toBeInstanceOf(Error);
    expect(f).toHaveBeenCalledTimes(3);
    expect(reg.isDownloaded('t')).toBe(false);
    expect(dm.downloadStateOf('t').status).toBe('error');
  });
});

describe('download: o que chega NÃO é áudio de verdade', () => {
  it('corpo de 0 bytes não vira faixa "baixada"', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [] })),
    );

    const p = dm.downloadTrack(faixa('z')).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(reg.isDownloaded('z')).toBe(false);
  });

  it('corpo MENOR que o Content-Length declarado (conexão cortada limpo) não é salvo', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        resposta({
          corpo: [new Uint8Array(40)],
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '1000' },
        }),
      ),
    );

    const p = dm.downloadTrack(faixa('cut')).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(reg.isDownloaded('cut')).toBe(false);
  });

  it('200 com página HTML (portal cativo / erro do CDN) não é guardado como áudio', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        resposta({ corpo: [new Uint8Array(500)], headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const p = dm.downloadTrack(faixa('html')).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(reg.isDownloaded('html')).toBe(false);
  });

  it('404 (faixa apagada) não gasta 3 tentativas com backoff', async () => {
    const { dm } = await montar();
    vi.useFakeTimers();
    const f = vi.fn(async () => resposta({ status: 404 }));
    vi.stubGlobal('fetch', f);

    const p = dm.downloadTrack(faixa('n')).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(f).toHaveBeenCalledTimes(1);
  });

  it('503 (cofre reconstruindo) É transitório: tenta de novo e conclui', async () => {
    const { dm, reg } = await montar();
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(resposta({ status: 503 }))
      .mockResolvedValue(resposta({ corpo: [new Uint8Array(30)] }));
    vi.stubGlobal('fetch', f);

    const p = dm.downloadTrack(faixa('s'));
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    expect(reg.isDownloaded('s')).toBe(true);
  });
});

describe('download: apagar e reler', () => {
  it('apagar ENQUANTO baixa: a faixa não ressuscita quando o download termina', async () => {
    const { dm, reg, cache } = await montar();
    let liberar: () => void = () => undefined;
    const trava = new Promise<void>((r) => (liberar = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await trava;
        return resposta({ corpo: [new Uint8Array(50)] });
      }),
    );

    const p = dm.downloadTrack(faixa('d'));
    await dm.removeDownloadedTrack('d');
    liberar();
    await p.catch(() => undefined);

    expect(reg.isDownloaded('d')).toBe(false);
    expect(await cache.hasAudio('d')).toBe(false);
  });

  it('registro existe e o blob sumiu: ensure poda o registro e devolve null (não toca silêncio)', async () => {
    const { dm, reg } = await montar();
    reg.addDownload(faixa('fantasma'), 10);

    expect(await dm.ensureDownloadedAudioUrl('fantasma')).toBeNull();
    expect(reg.isDownloaded('fantasma')).toBe(false);
  });

  it('recarregar: registro+bytes gravados antes continuam tocáveis (mesma chave no hydrate)', async () => {
    const a = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(64)] })),
    );
    await a.dm.downloadTrack(faixa('boot'));

    // "Reload": módulos novos, mesmo localStorage e mesmo IndexedDB.
    vi.resetModules();
    const dm2 = await import('@/features/downloads/downloadManager');
    await dm2.hydrateDownloads();

    expect(dm2.hasDownloadedAudio('boot')).toBe(true);
    expect(await dm2.ensureDownloadedAudioUrl('boot')).toMatch(/^blob:/);
  });

  it('remover revoga a alça aberta', async () => {
    const { dm } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta({ corpo: [new Uint8Array(64)] })),
    );
    await dm.downloadTrack(faixa('rv'));
    expect(abertas.size).toBe(1);

    await dm.removeDownloadedTrack('rv');

    expect(abertas.size).toBe(0);
  });
});
