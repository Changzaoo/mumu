/**
 * O PORTÃO DO LRCLIB — não atrasa ninguém enquanto o servidor está bem; quando
 * ele reclama (429/5xx), pausa, depois tem cautela, e avisa quando voltou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAUTELA_MS,
  ESPACO_NA_CAUTELA_MS,
  PAUSA_BASE_MS,
  PAUSA_MAXIMA_MS,
  estadoDoLrclib,
  ouvirLrclib,
  pedirAoLrclib,
  zerarPortaoDoLrclib,
  type EventoDoLrclib,
} from '../portaoDoLrclib';

interface Pendente {
  url: string;
  responder: (resposta: Partial<Response>) => void;
}

const resposta = (status: number, cabecalhos: Record<string, string> = {}): Partial<Response> =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(cabecalhos) }) as Response;

describe('o portão do LRCLIB', () => {
  let pendentes: Pendente[];
  let eventos: EventoDoLrclib[];

  beforeEach(() => {
    vi.useFakeTimers();
    zerarPortaoDoLrclib();
    pendentes = [];
    eventos = [];
    ouvirLrclib((e) => eventos.push(e));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise<Partial<Response>>((resolve) => {
            pendentes.push({ url: String(url), responder: resolve });
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const url = (n: number) => `https://lrclib.net/api/search?track_name=${n}`;

  it('com o servidor bem, os pedidos saem TODOS juntos — nada de fila', async () => {
    const promessas = [1, 2, 3, 4, 5].map((n) => pedirAoLrclib(url(n)));
    await Promise.resolve();
    expect(pendentes).toHaveLength(5);
    for (const p of pendentes) p.responder(resposta(200));
    const respostas = await Promise.all(promessas);
    expect(respostas.every((r) => r?.ok)).toBe(true);
    expect(eventos).toEqual([]);
  });

  it('429 pausa pelo Retry-After; na pausa o pedido volta null SEM ir à rede', async () => {
    const primeiro = pedirAoLrclib(url(1));
    await Promise.resolve();
    pendentes[0]?.responder(resposta(429, { 'retry-after': '3' }));
    expect((await primeiro)?.status).toBe(429);
    expect(eventos).toEqual([{ tipo: 'lotado', status: 429, esperaMs: 3_000 }]);
    expect(estadoDoLrclib().doente).toBe(true);

    const chamadas = vi.mocked(fetch).mock.calls.length;
    expect(await pedirAoLrclib(url(2))).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(chamadas);

    // Passada a pausa, o pedido sai de novo.
    await vi.advanceTimersByTimeAsync(3_000);
    const depois = pedirAoLrclib(url(3));
    await Promise.resolve();
    expect(vi.mocked(fetch).mock.calls.length).toBe(chamadas + 1);
    pendentes[pendentes.length - 1]?.responder(resposta(200));
    expect((await depois)?.ok).toBe(true);
  });

  it('uma rajada de 429 é UM episódio; episódios seguidos dobram a pausa até o teto', async () => {
    const lotar = async (): Promise<void> => {
      const p = pedirAoLrclib(url(9));
      await Promise.resolve();
      pendentes[pendentes.length - 1]?.responder(resposta(429));
      await p;
    };
    const esperas: number[] = [];
    for (let i = 0; i < 5; i++) {
      await lotar();
      const ultimo = eventos[eventos.length - 1];
      if (ultimo?.tipo === 'lotado') esperas.push(ultimo.esperaMs);
      // Mais um 429 DURANTE a pausa não vira episódio novo.
      const antes = eventos.length;
      expect(await pedirAoLrclib(url(9))).toBeNull();
      expect(eventos.length).toBe(antes);
      await vi.advanceTimersByTimeAsync(esperas[esperas.length - 1] ?? 0);
    }
    expect(esperas).toEqual([
      PAUSA_BASE_MS,
      PAUSA_BASE_MS * 2,
      PAUSA_BASE_MS * 4,
      PAUSA_MAXIMA_MS,
      PAUSA_MAXIMA_MS,
    ]);
  });

  it('depois da pausa vem a CAUTELA: no máximo dois em voo, espaçados', async () => {
    const p = pedirAoLrclib(url(1));
    await Promise.resolve();
    pendentes[0]?.responder(resposta(503));
    await p;
    await vi.advanceTimersByTimeAsync(PAUSA_BASE_MS);
    pendentes = [];

    const promessas = [1, 2, 3, 4].map((n) => pedirAoLrclib(url(n)));
    await Promise.resolve();
    expect(pendentes).toHaveLength(1); // o primeiro sai na hora…
    await vi.advanceTimersByTimeAsync(ESPACO_NA_CAUTELA_MS);
    expect(pendentes).toHaveLength(2); // …o segundo depois do espaço…
    await vi.advanceTimersByTimeAsync(ESPACO_NA_CAUTELA_MS * 4);
    expect(pendentes).toHaveLength(2); // …e o terceiro espera um lugar, não só o tempo

    pendentes[0]?.responder(resposta(200));
    await vi.advanceTimersByTimeAsync(ESPACO_NA_CAUTELA_MS);
    expect(pendentes).toHaveLength(3); // liberou um lugar

    for (const q of pendentes.slice(1, 3)) q.responder(resposta(200));
    await vi.advanceTimersByTimeAsync(ESPACO_NA_CAUTELA_MS * 2);
    expect(pendentes).toHaveLength(4);
    pendentes[3]?.responder(resposta(200));
    await Promise.all(promessas);

    // A primeira resposta boa depois da lotação avisa que voltou.
    expect(eventos.some((e) => e.tipo === 'voltou')).toBe(true);
    expect(estadoDoLrclib().doente).toBe(false);

    // Passada a cautela, volta a sair tudo junto.
    await vi.advanceTimersByTimeAsync(CAUTELA_MS);
    pendentes = [];
    const soltos = [1, 2, 3].map((n) => pedirAoLrclib(url(n)));
    await Promise.resolve();
    expect(pendentes).toHaveLength(3);
    for (const q of pendentes) q.responder(resposta(200));
    await Promise.all(soltos);
  });

  it('404 é resposta de verdade ("não tenho"): também conta como voltou', async () => {
    const p = pedirAoLrclib(url(1));
    await Promise.resolve();
    pendentes[0]?.responder(resposta(429));
    await p;
    await vi.advanceTimersByTimeAsync(PAUSA_BASE_MS);
    const q = pedirAoLrclib(url(2));
    await Promise.resolve();
    pendentes[1]?.responder(resposta(404));
    await q;
    expect(eventos[eventos.length - 1]).toEqual({ tipo: 'voltou', status: 404 });
  });
});
