/**
 * A volta do acervo fiel: host fora do cofre nunca é consultado e a sequência
 * longa de "mortas" interrompe a volta sem apagar nada.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, unknown> = {};
vi.mock('../config/index.js', () => ({ env }));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
const findMany = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const update = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../infra/db/prisma.js', () => ({ prisma: { catalogTrack: { findMany, update } } }));

const { conferirLote, conferirCopia } = await import('./acervoFiel.worker.js');

let servidor: Server;
let base = '';
beforeAll(async () => {
  servidor = createServer((req, res) => {
    res.writeHead(req.url?.startsWith('/viva') ? 206 : 404).end();
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => {
  findMany.mockReset();
  update.mockReset();
  env.IMPORTER_URL = base;
});

const linha = (id: string, remoteUrl: string) => ({
  id,
  data: { remoteUrl, track: { streamUrl: remoteUrl } },
});

describe('conferirCopia', () => {
  it('host fora do cofre é incerta, sem rede', async () => {
    expect(await conferirCopia('http://169.254.169.254/blob/x')).toBe('incerta');
    expect(await conferirCopia(`${base}/viva/1`)).toBe('viva');
    expect(await conferirCopia(`${base}/sumiu/1`)).toBe('morta');
  });
});

describe('conferirLote', () => {
  it('apaga poucas mortas', async () => {
    findMany.mockResolvedValueOnce([linha('a', `${base}/sumiu/a`), linha('b', `${base}/viva/b`)]);
    const r = await conferirLote();
    expect(r.mortas).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('8 mortas seguidas: interrompe sem apagar nada', async () => {
    findMany.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => linha(`m${i}`, `${base}/sumiu/${i}`)),
    );
    const r = await conferirLote();
    expect(r.mortas).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('host alheio não é morta', async () => {
    findMany.mockResolvedValueOnce([linha('x', 'http://10.0.0.5/blob/x')]);
    const r = await conferirLote();
    expect(r.mortas).toBe(0);
  });
});

describe('conferirLote com a borda', () => {
  const REMOTE = (n: string) => `https://importer.radinho.online/blob/local%3A${n}?k=t`;
  afterEach(() => vi.unstubAllGlobals());

  function fetchDe(borda: (n: string) => number, origem: (n: string) => number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const n = /local%3A([^?]+)/.exec(url)?.[1] ?? '';
        const status = url.startsWith('https://musicas.radinho.online') ? borda(n) : origem(n);
        return new Response(null, { status });
      }),
    );
  }

  beforeEach(() => {
    env.AUDIO_BORDA_URL = 'https://musicas.radinho.online';
  });

  it('origem 404 mas borda viva: nenhuma morta, nada apagado', async () => {
    fetchDe(
      () => 206,
      () => 404,
    );
    findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => linha(`local:${i}`, REMOTE(String(i)))),
    );
    const r = await conferirLote();
    expect(r).toEqual({ conferidas: 20, mortas: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it('borda 404 e origem 404: morta e apagada (poucas)', async () => {
    fetchDe(
      () => 404,
      () => 404,
    );
    findMany.mockResolvedValueOnce([linha('local:a', REMOTE('a'))]);
    const r = await conferirLote();
    expect(r.mortas).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('borda 404 e origem viva: viva', async () => {
    fetchDe(
      () => 404,
      () => 206,
    );
    findMany.mockResolvedValueOnce([linha('local:a', REMOTE('a'))]);
    expect((await conferirLote()).mortas).toBe(0);
  });

  it('borda 403/503/416 com origem 404: incerta, nada apagado', async () => {
    for (const s of [403, 503, 416]) {
      update.mockReset();
      fetchDe(
        () => s,
        () => 404,
      );
      findMany.mockResolvedValueOnce([linha('local:a', REMOTE('a'))]);
      expect((await conferirLote()).mortas).toBe(0);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('freio de 8 mortas seguidas continua valendo com a borda', async () => {
    fetchDe(
      () => 404,
      () => 404,
    );
    findMany.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => linha(`local:${i}`, REMOTE(String(i)))),
    );
    expect((await conferirLote()).mortas).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('mortas intercaladas com vivas (menos de 8 seguidas) são apagadas', async () => {
    const st = (n: string) => (Number(n) % 2 ? 206 : 404);
    fetchDe(st, st);
    findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => linha(`local:${i}`, REMOTE(String(i)))),
    );
    expect((await conferirLote()).mortas).toBe(10);
  });

  it('host alheio nunca chega à borda', async () => {
    fetchDe(
      () => 404,
      () => 404,
    );
    findMany.mockResolvedValueOnce([linha('x', 'http://10.0.0.5/blob/x?k=1')]);
    expect((await conferirLote()).mortas).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
