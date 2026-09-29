/**
 * `navigator.onLine` NÃO É A RESPOSTA — a sonda é.
 *
 * No Android sem sinal (dados ligados, pacote acabado, Wi-Fi sem saída) o
 * `onLine` continua `true`. Estes testes fixam o que conta como "rede morta":
 * só a falta de resposta. Qualquer status HTTP, até 404, prova que a rede chega.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmarRedeMorta,
  esquecerVeredito,
  redeSabidamenteMorta,
} from '@/lib/offline/redeMorta';

beforeEach(() => {
  vi.useFakeTimers();
  esquecerVeredito();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('redeMorta', () => {
  it('onLine=false basta: morta sem nem perguntar à rede', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);

    expect(redeSabidamenteMorta()).toBe(true);
    expect(await confirmarRedeMorta()).toBe(true);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('onLine=true mentindo: a sonda que não sai do aparelho desmente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    expect(redeSabidamenteMorta()).toBe(false); // sem sonda, não se sabe
    expect(await confirmarRedeMorta()).toBe(true);
    expect(redeSabidamenteMorta()).toBe(true); // e o veredito fica valendo
  });

  it('qualquer resposta HTTP — até 404 — prova rede viva', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 404 })),
    );
    expect(await confirmarRedeMorta()).toBe(false);
  });

  it('a sonda tem teto: rede que não responde nem erra conta como morta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const resposta = confirmarRedeMorta();
    await vi.advanceTimersByTimeAsync(4_100);
    expect(await resposta).toBe(true);
  });

  it('o evento `online` do navegador apaga o veredito de morte', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await confirmarRedeMorta();
    expect(redeSabidamenteMorta()).toBe(true);

    window.dispatchEvent(new Event('online'));
    expect(redeSabidamenteMorta()).toBe(false);
  });

  it('o veredito vence: passado o prazo, pergunta de novo', async () => {
    const buscar = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', buscar);
    await confirmarRedeMorta();
    await confirmarRedeMorta();
    expect(buscar).toHaveBeenCalledTimes(1); // dentro do prazo: sem nova sonda

    vi.advanceTimersByTime(46_000);
    expect(redeSabidamenteMorta()).toBe(false);
    await confirmarRedeMorta();
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});
