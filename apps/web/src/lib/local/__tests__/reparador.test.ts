import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FalhaRegistrada } from '../faixasQueFalharam';

const enqueue = vi.fn();
const pauseReason = vi.fn<() => 'auth' | 'backoff' | null>(() => null);
const reparaveis = vi.fn<() => FalhaRegistrada[]>(() => []);
const anotarTentativaDeReparo = vi.fn();

vi.mock('@/lib/local/importQueue', () => ({
  enqueue: (...a: unknown[]) => enqueue(...a),
  pauseReason: () => pauseReason(),
}));
vi.mock('@/lib/local/faixasQueFalharam', () => ({
  reparaveis: (...a: unknown[]) => reparaveis(...(a as [])),
  anotarTentativaDeReparo: (...a: unknown[]) => anotarTentativaDeReparo(...a),
}));

function caso(id: string, sourceUrl?: string): FalhaRegistrada {
  return {
    trackId: id,
    titulo: id,
    artista: 'A',
    motivo: 'fonte-morta',
    tinhaAudioLocal: false,
    tinhaCopiaRemota: false,
    sourceUrl,
    primeiraEm: '2026-08-30T00:00:00.000Z',
    ultimaEm: '2026-08-30T00:00:00.000Z',
    vezes: 1,
  };
}

async function carregar() {
  vi.resetModules();
  return import('../reparador');
}

describe('reparador', () => {
  beforeEach(() => {
    enqueue.mockClear();
    anotarTentativaDeReparo.mockClear();
    pauseReason.mockReturnValue(null);
    reparaveis.mockReturnValue([]);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  it('enfileira o link de origem das faixas que têm conserto', async () => {
    reparaveis.mockReturnValue([caso('local:1', 'https://youtu.be/a')]);
    const r = await carregar();
    expect(r.repararUmaRodada()).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(['https://youtu.be/a']);
  });

  it('anota a tentativa ANTES do resultado', async () => {
    // Se a anotação dependesse do sucesso, uma fila travada faria a mesma faixa
    // ser reenfileirada em toda rodada, para sempre.
    reparaveis.mockReturnValue([caso('local:1', 'https://youtu.be/a')]);
    const r = await carregar();
    r.repararUmaRodada();
    expect(anotarTentativaDeReparo).toHaveBeenCalledWith('local:1');
  });

  it('não despeja a lista inteira de uma vez', async () => {
    // No dia em que o cofre podar muita coisa, a lista tem centenas de faixas.
    reparaveis.mockReturnValue(
      Array.from({ length: 50 }, (_, i) => caso(`local:${i}`, `https://youtu.be/${i}`)),
    );
    const r = await carregar();
    expect(r.repararUmaRodada()).toBe(3);
    expect((enqueue.mock.calls[0]![0] as string[]).length).toBe(3);
  });

  it('respeita a fila pausada — não engorda fila travada', async () => {
    reparaveis.mockReturnValue([caso('local:1', 'https://youtu.be/a')]);
    const r = await carregar();
    for (const motivo of ['auth', 'backoff'] as const) {
      pauseReason.mockReturnValue(motivo);
      expect(r.repararUmaRodada()).toBe(0);
    }
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('offline não tenta nada', async () => {
    reparaveis.mockReturnValue([caso('local:1', 'https://youtu.be/a')]);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const r = await carregar();
    expect(r.repararUmaRodada()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sem candidatas, não chama a fila', async () => {
    const r = await carregar();
    expect(r.repararUmaRodada()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ignora caso sem link de origem', async () => {
    reparaveis.mockReturnValue([caso('local:1')]);
    const r = await carregar();
    expect(r.repararUmaRodada()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('parar o reparador impede rodadas futuras', async () => {
    vi.useFakeTimers();
    reparaveis.mockReturnValue([caso('local:1', 'https://youtu.be/a')]);
    const r = await carregar();
    const parar = r.iniciarReparador();
    parar();
    vi.advanceTimersByTime(60 * 60_000);
    expect(enqueue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
