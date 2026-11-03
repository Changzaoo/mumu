/**
 * A volta do acervo fiel: host fora do cofre nunca é consultado e a sequência
 * longa de "mortas" interrompe a volta sem apagar nada.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
