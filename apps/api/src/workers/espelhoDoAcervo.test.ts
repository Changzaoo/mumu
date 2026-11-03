import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  env: { AUDIO_BORDA_URL: 'https://musicas.radinho.online', ESPELHO_TOKEN: 'x'.repeat(32) },
}));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ listCatalog: vi.fn() }));

import { espelharUmaVez, esquecerUltimoEnvio } from './espelhoDoAcervo.worker.js';

const listagem =
  (n: number, etag = 'W/"a"') =>
  async () => ({
    entries: Array.from({ length: n }, (_, i) => ({ track: { id: `local:${i}`, title: `F${i}` } })),
    etag,
  });

const resposta = (status: number) => async () => ({ ok: status < 300, status }) as Response;

describe('espelho do acervo na borda', () => {
  beforeEach(() => esquecerUltimoEnvio());

  it('faz PUT /acervo com o token, o corpo { data } e só a listagem magra', async () => {
    const f = vi.fn(resposta(200));
    const r = await espelharUmaVez({ listar: listagem(3), fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ enviou: true, faixas: 3, etag: 'W/"a"' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://musicas.radinho.online/acervo');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'x'.repeat(32)}`);
    const corpo = JSON.parse(init.body as string) as { data: unknown[] };
    expect(corpo.data).toHaveLength(3);
  });

  it('mesmo ETag não reenvia; ETag novo reenvia', async () => {
    const f = vi.fn(resposta(200));
    await espelharUmaVez({ listar: listagem(2, 'e1'), fetch: f as unknown as typeof fetch });
    const r2 = await espelharUmaVez({
      listar: listagem(2, 'e1'),
      fetch: f as unknown as typeof fetch,
    });
    expect(r2).toEqual({ enviou: false, motivo: 'sem-mudanca' });
    const r3 = await espelharUmaVez({
      listar: listagem(2, 'e2'),
      fetch: f as unknown as typeof fetch,
    });
    expect(r3.enviou).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('borda que recusa não marca como enviado (tenta de novo na próxima)', async () => {
    const f = vi.fn(resposta(401));
    const r = await espelharUmaVez({
      listar: listagem(2, 'e1'),
      fetch: f as unknown as typeof fetch,
    });
    expect(r).toEqual({ enviou: false, motivo: 'http 401' });
    const f2 = vi.fn(resposta(200));
    const r2 = await espelharUmaVez({
      listar: listagem(2, 'e1'),
      fetch: f2 as unknown as typeof fetch,
    });
    expect(r2.enviou).toBe(true);
  });

  it('listagem vazia, sem token e sem borda não mandam nada; rede caída não lança', async () => {
    const f = vi.fn(resposta(200));
    expect(
      await espelharUmaVez({ listar: listagem(0), fetch: f as unknown as typeof fetch }),
    ).toEqual({
      enviou: false,
      motivo: 'vazio',
    });
    expect(
      await espelharUmaVez({
        listar: listagem(1),
        fetch: f as unknown as typeof fetch,
        token: null,
      }),
    ).toEqual({
      enviou: false,
      motivo: 'sem-token',
    });
    expect(
      await espelharUmaVez({
        listar: listagem(1),
        fetch: f as unknown as typeof fetch,
        bordaUrl: null,
      }),
    ).toEqual({ enviou: false, motivo: 'sem-borda' });
    expect(f).not.toHaveBeenCalled();
    const caida = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(
      await espelharUmaVez({ listar: listagem(1), fetch: caida as unknown as typeof fetch }),
    ).toEqual({
      enviou: false,
      motivo: 'falhou',
    });
  });
});
