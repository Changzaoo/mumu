/**
 * OUVIU, FICA NO APARELHO — o contrato do pedido de 27/10/2026.
 *
 * "Uma vez que o usuário escutar a música, ela fica no aparelho e toca
 * imediatamente" na próxima vez. Usa o IndexedDB e o registro (localStorage)
 * REAIS; só a rede é falsa. O que se prova:
 *
 *  1. ouvida → bytes no IndexedDB, registro marcado como automático, e o player
 *     passa a enxergar a faixa como "no aparelho" (`hasDownloadedAudio`) e a
 *     abrir a alça dela sob demanda — sem abrir alça NA HORA da guarda (RAM);
 *  2. orçamento com despejo LRU: quando não cabe, sai a MENOS usada; a que
 *     tocou de novo sobrevive; download que a pessoa pediu NUNCA sai;
 *  3. a pessoa pedir para baixar uma guardada só a promove (zero rede);
 *  4. não guarda o que não é arquivo: HLS, prévia, rádio (duração infinita),
 *     corpo cortado; e uma vez por faixa por sessão;
 *  5. a cota do navegador estourar na gravação despeja e tenta de novo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Blob as BlobDoNode } from 'node:buffer';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/api', () => ({ isFirstPartyUrl: () => false }));
vi.mock('@/lib/firebase', () => ({ getIdToken: async () => null }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));
vi.mock('@/stores/notificationsStore', () => ({ pushNotification: vi.fn() }));
vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));

const faixa = (id: string, extra: Partial<TrackDto> = {}): TrackDto =>
  ({
    id,
    title: `Faixa ${id}`,
    artists: [],
    durationMs: 200_000,
    downloadUrl: null,
    streamUrl: `https://importador.exemplo/stream?url=${id}&token=t`,
    ...extra,
  }) as unknown as TrackDto;

/** 200 s a 48 kbps = 1,2 MB é o mínimo para "veio inteira". */
const BYTES_INTEIRA = 200 * 48 * 125 + 1000;

function resposta(bytes: number, headers: Record<string, string> = {}): Response {
  const partes = [new Uint8Array(bytes)];
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'audio/mpeg', ...headers }),
    body: {
      getReader: () => ({
        read: async () => {
          const value = partes[i++];
          return value ? { done: false, value } : { done: true, value: undefined };
        },
      }),
    },
  } as unknown as Response;
}

let alcasAbertas = 0;

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
  alcasAbertas = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      alcasAbertas += 1;
      return `blob:fake/${alcasAbertas}`;
    },
    revokeObjectURL: () => {
      alcasAbertas -= 1;
    },
  });
  // Sem `navigator.storage`: o orçamento é o teto do módulo (testável).
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Cada teste começa com o cofre de bytes vazio.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('aurial-offline');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('guardada ao ouvir', () => {
  it('ouvida → bytes no aparelho, marcada como automática, sem abrir alça agora', async () => {
    const { dm, reg, cache } = await montar();
    const fetchMock = vi.fn(async () => resposta(BYTES_INTEIRA));
    vi.stubGlobal('fetch', fetchMock);

    expect(await dm.guardarAoOuvir(faixa('a'), 200)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dm.hasDownloadedAudio('a')).toBe(true);
    expect(reg.isAutomatico('a')).toBe(true);
    expect(await cache.hasAudio('a')).toBe(true);
    expect(alcasAbertas).toBe(0); // a RAM da aba é comida por alça, não por bytes em disco

    // No play seguinte a alça abre sob demanda — é dela que o motor toca.
    const url = await dm.ensureDownloadedAudioUrl('a');
    expect(url).toMatch(/^blob:/);
    expect(alcasAbertas).toBe(1);
    // A entrada aparece na lista de "guardadas ao ouvir", não nos downloads manuais.
    expect(reg.ouvidasGuardadas().map((e) => e.track.id)).toEqual(['a']);
    expect(reg.downloadsManuais()).toEqual([]);
  });

  it('uma vez por faixa por sessão, e nunca para o que já está no aparelho', async () => {
    const { dm } = await montar();
    const fetchMock = vi.fn(async () => resposta(BYTES_INTEIRA));
    vi.stubGlobal('fetch', fetchMock);

    await dm.guardarAoOuvir(faixa('a'), 200);
    expect(await dm.guardarAoOuvir(faixa('a'), 200)).toBe(false);
    dm.esquecerGuardasPedidas();
    expect(await dm.guardarAoOuvir(faixa('a'), 200)).toBe(false); // já baixada
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não guarda HLS, prévia, rádio ao vivo (duração infinita) nem sem rede', async () => {
    const { dm } = await montar();
    const fetchMock = vi.fn(async () => resposta(BYTES_INTEIRA));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      await dm.guardarAoOuvir(faixa('hls', { streamUrl: 'https://x/manifest.m3u8' }), 200),
    ).toBe(false);
    expect(await dm.guardarAoOuvir(faixa('previa', { previewOnly: true }), 30)).toBe(false);
    expect(await dm.guardarAoOuvir(faixa('radio'), Number.POSITIVE_INFINITY)).toBe(false);
    expect(await dm.guardarAoOuvir(faixa('zero'), 0)).toBe(false);

    vi.stubGlobal('navigator', { onLine: false });
    expect(await dm.guardarAoOuvir(faixa('offline'), 200)).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('arquivo que veio cortado é descartado, não registrado', async () => {
    const { dm, cache } = await montar();
    // 200 s de música em 10 KB: impossível, o stream caiu no meio.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(10_000)),
    );

    expect(await dm.guardarAoOuvir(faixa('cortada'), 200)).toBe(false);
    expect(dm.hasDownloadedAudio('cortada')).toBe(false);
    expect(await cache.hasAudio('cortada')).toBe(false);
  });

  it('transmissão sem fim é abortada no teto de bytes, sem registrar', async () => {
    const { dm } = await montar();
    // Corpo infinito: cada leitura devolve mais 1 MB, para sempre.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
            body: {
              getReader: () => ({
                read: async () => ({ done: false, value: new Uint8Array(1_000_000) }),
              }),
            },
          }) as unknown as Response,
      ),
    );

    expect(await dm.guardarAoOuvir(faixa('semfim'), 10)).toBe(false);
    expect(dm.hasDownloadedAudio('semfim')).toBe(false);
  });

  it('orçamento: despeja a MENOS usada; a que tocou de novo fica; manual nunca sai', async () => {
    const { dm, reg, cache } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(BYTES_INTEIRA)),
    );
    // Cabem duas e meia guardadas.
    dm.definirTetoDasOuvidas(Math.floor(BYTES_INTEIRA * 2.5));

    // Download que a pessoa PEDIU: fora do orçamento e do despejo.
    await dm.downloadTrack(faixa('manual', { downloadUrl: 'https://cdn/manual.mp3' }));
    expect(reg.isAutomatico('manual')).toBe(false);

    expect(await dm.guardarAoOuvir(faixa('a'), 200)).toBe(true);
    await new Promise((r) => setTimeout(r, 5)); // ISO com segundo diferente não é garantido; ordem por inserção basta
    expect(await dm.guardarAoOuvir(faixa('b'), 200)).toBe(true);
    // 'a' toca de novo: deixa de ser a menos usada.
    await new Promise((r) => setTimeout(r, 1100));
    await dm.ensureDownloadedAudioUrl('a');
    expect(await dm.guardarAoOuvir(faixa('c'), 200)).toBe(true);

    expect(reg.ouvidasGuardadas().map((e) => e.track.id)).toEqual(['a', 'c']);
    expect(dm.hasDownloadedAudio('b')).toBe(false);
    expect(await cache.hasAudio('b')).toBe(false);
    expect(dm.hasDownloadedAudio('manual')).toBe(true); // intocado
    expect(reg.bytesDasOuvidas()).toBeLessThanOrEqual(BYTES_INTEIRA * 2.5);
  });

  it('uma faixa maior que o orçamento inteiro não entra nem despeja ninguém', async () => {
    const { dm, reg } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(BYTES_INTEIRA)),
    );
    dm.definirTetoDasOuvidas(BYTES_INTEIRA * 2);
    await dm.guardarAoOuvir(faixa('a'), 200);
    dm.definirTetoDasOuvidas(BYTES_INTEIRA - 1);

    expect(await dm.guardarAoOuvir(faixa('gigante'), 200)).toBe(false);
    expect(reg.ouvidasGuardadas().map((e) => e.track.id)).toEqual(['a']);
  });

  it('"Baixar para ouvir offline" numa guardada só a promove: zero rede, protegida do despejo', async () => {
    const { dm, reg } = await montar();
    const fetchMock = vi.fn(async () => resposta(BYTES_INTEIRA));
    vi.stubGlobal('fetch', fetchMock);
    await dm.guardarAoOuvir(faixa('a'), 200);
    fetchMock.mockClear();

    await dm.downloadTrack(faixa('a'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reg.isAutomatico('a')).toBe(false);
    expect(reg.downloadsManuais().map((e) => e.track.id)).toEqual(['a']);
    expect(dm.downloadStateOf('a').status).toBe('downloaded');
  });

  it('cota do navegador estourada na gravação: despeja as mais antigas e tenta de novo', async () => {
    const { dm, reg } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(BYTES_INTEIRA)),
    );
    await dm.guardarAoOuvir(faixa('velha1'), 200);
    await dm.guardarAoOuvir(faixa('velha2'), 200);

    const original = IDBObjectStore.prototype.put;
    let falhas = 1;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (falhas > 0) {
        falhas -= 1;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.apply(this, args);
    });

    expect(await dm.guardarAoOuvir(faixa('nova'), 200)).toBe(true);
    expect(dm.hasDownloadedAudio('nova')).toBe(true);
    // As duas mais antigas saíram para abrir espaço.
    expect(reg.ouvidasGuardadas().map((e) => e.track.id)).toEqual(['nova']);
  });

  it('remover uma guardada apaga bytes e registro, como qualquer download', async () => {
    const { dm, cache } = await montar();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(BYTES_INTEIRA)),
    );
    await dm.guardarAoOuvir(faixa('a'), 200);

    await dm.removeDownloadedTrack('a');

    expect(dm.hasDownloadedAudio('a')).toBe(false);
    expect(await cache.hasAudio('a')).toBe(false);
  });
});
