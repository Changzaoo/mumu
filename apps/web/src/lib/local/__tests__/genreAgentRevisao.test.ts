/**
 * A REVISÃO ÚNICA DE GÊNEROS TRAVAVA A THREAD POR ~165 S num Moto G34 emulado
 * (acervo de 5.744 faixas): `revisarGeneros` era O(N²) e rodava de uma vez, 25 s
 * depois do boot. Estes testes fixam o lado do app: o laço cede a thread, o
 * progresso é gravado por etapa (fechar o app no meio não recomeça do zero) e o
 * voto do artista sai do índice, com o mesmo resultado de antes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Entrada {
  origem: 'local' | 'catalogo';
  track: { id: string; title: string; genre: string | null; artists: { name: string }[] };
}

const PROGRESSO = 'aurial:genreRevisaoProgresso';
const FEITA = 'aurial:genreRevisao';

let entradas: Entrada[] = [];
const setTrackGenre = vi.fn((id: string, genre: string | null) => {
  const e = entradas.find((x) => x.track.id === id);
  if (e) e.track.genre = genre;
});
const aiClassifyGenre = vi.fn(async () => null as string | null);

vi.mock('@/lib/local/localLibrary', () => ({
  list: () => entradas,
  setTrackGenre: (id: string, genre: string | null) => setTrackGenre(id, genre),
  subscribe: () => () => undefined,
}));
vi.mock('@/lib/ai/ai', () => ({
  aiClassifyGenre: (...args: unknown[]) => aiClassifyGenre(...(args as [])),
}));
vi.mock('@/lib/perf/dispositivo', () => ({ modoLeve: () => false }));
vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: (chave: string, texto: string) => {
    window.localStorage.setItem(chave, texto);
    return true;
  },
  registrarDescartavel: () => undefined,
}));

const faixa = (id: string, genre: string | null, artista: string): Entrada => ({
  origem: 'local',
  track: { id, title: `Faixa ${id}`, genre, artists: [{ name: artista }] },
});

/** N faixas com rótulo cru ("sertaneja") — cada uma vira uma revisão `normalizado`. */
function acervoParaRevisar(n: number): Entrada[] {
  return Array.from({ length: n }, (_, i) => faixa(`r${i}`, 'sertaneja', `Artista ${i}`));
}

async function ligarAgente(): Promise<void> {
  vi.resetModules();
  const { initGenreAgent } = await import('../genreAgent');
  initGenreAgent();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  setTrackGenre.mockClear();
  aiClassifyGenre.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('revisão única de gêneros — progresso por etapa', () => {
  it('aplica tudo, marca a versão como feita e apaga o checkpoint', async () => {
    entradas = acervoParaRevisar(45);
    await ligarAgente();
    await vi.advanceTimersByTimeAsync(25_000 + 45 * 60 + 2_000);

    expect(setTrackGenre).toHaveBeenCalledTimes(45);
    expect(entradas.every((e) => e.track.genre === 'Sertanejo')).toBe(true);
    expect(window.localStorage.getItem(FEITA)).toBe('1');
    expect(window.localStorage.getItem(PROGRESSO)).toBeNull();
  });

  it('grava checkpoint no meio: fechar o app antes do fim não perde o que foi aplicado', async () => {
    entradas = acervoParaRevisar(60);
    await ligarAgente();
    // Para a meio caminho: ~30 das 60 aplicadas.
    await vi.advanceTimersByTimeAsync(25_000 + 30 * 60);

    expect(window.localStorage.getItem(FEITA)).toBeNull();
    const salvo = JSON.parse(window.localStorage.getItem(PROGRESSO) ?? 'null') as {
      v: number;
      ids: string[];
    };
    expect(salvo.v).toBe(1);
    expect(salvo.ids.length).toBeGreaterThanOrEqual(20);
    expect(salvo.ids.length).toBeLessThan(60);
  });

  it('no boot seguinte pula o que o checkpoint diz que já foi aplicado', async () => {
    entradas = acervoParaRevisar(30);
    const jaFeitas = entradas.slice(0, 20).map((e) => e.track.id);
    window.localStorage.setItem(PROGRESSO, JSON.stringify({ v: 1, ids: jaFeitas }));
    await ligarAgente();
    await vi.advanceTimersByTimeAsync(25_000 + 30 * 60 + 2_000);

    const aplicadas = setTrackGenre.mock.calls.map((c) => c[0]);
    expect(aplicadas).toHaveLength(10);
    expect(aplicadas.some((id) => jaFeitas.includes(id))).toBe(false);
    expect(window.localStorage.getItem(FEITA)).toBe('1');
  });

  it('checkpoint de outra versão da revisão é ignorado', async () => {
    entradas = acervoParaRevisar(5);
    window.localStorage.setItem(PROGRESSO, JSON.stringify({ v: 0, ids: ['r0', 'r1', 'r2'] }));
    await ligarAgente();
    await vi.advanceTimersByTimeAsync(25_000 + 5 * 60 + 2_000);
    expect(setTrackGenre).toHaveBeenCalledTimes(5);
  });
});

describe('o voto do artista sai do índice', () => {
  it('faixa sem gênero herda do artista sem consultar a IA, e a herdada já vota na seguinte', async () => {
    // Duas faixas Trap firmes + duas sem gênero do mesmo artista. A 1ª herda; a 2ª
    // precisa enxergar a 1ª (índice atualizado no lugar) — com 3 votos o total
    // continua firme.
    entradas = [
      faixa('a1', 'Trap', 'Alee'),
      faixa('a2', 'Trap', 'ALEE'),
      faixa('a3', null, 'Alee'),
      faixa('a4', null, 'alee'),
    ];
    await ligarAgente();
    await vi.advanceTimersByTimeAsync(25_000 + 2_000);

    expect(entradas.find((e) => e.track.id === 'a3')?.track.genre).toBe('Trap');
    expect(entradas.find((e) => e.track.id === 'a4')?.track.genre).toBe('Trap');
    expect(aiClassifyGenre).not.toHaveBeenCalled();
  });
});

describe('cederThread', () => {
  it('usa scheduler.yield quando o navegador tem', async () => {
    vi.useRealTimers();
    vi.resetModules();
    const yieldFn = vi.fn(() => Promise.resolve());
    (globalThis as { scheduler?: unknown }).scheduler = { yield: yieldFn };
    try {
      const { cederThread } = await import('../genreAgent');
      await cederThread();
      expect(yieldFn).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { scheduler?: unknown }).scheduler;
    }
  });

  it('sem scheduler.yield, cede por MessageChannel/setTimeout e resolve', async () => {
    vi.useRealTimers();
    vi.resetModules();
    const { cederThread } = await import('../genreAgent');
    await expect(cederThread()).resolves.toBeUndefined();
  });
});
