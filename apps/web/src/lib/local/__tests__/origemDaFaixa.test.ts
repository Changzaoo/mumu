/**
 * O CLIPE ACHA O VÍDEO MESMO QUANDO A FAIXA NÃO ESTÁ NA BIBLIOTECA DAQUI.
 *
 * `origemDaFaixa` respondia "não tem clipe" sem perguntar ao acervo sempre que
 * a faixa não tinha entrada local (veio da busca, de um link compartilhado).
 * Agora o acervo é consultado do mesmo jeito; a resposta — inclusive o "não
 * tem" — fica guardada para não se perguntar duas vezes, e duas chamadas
 * simultâneas (a tela cheia adiantando e o clipe no clique) viram UMA busca.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/localLibrary', () => ({
  list: () => [],
  hidratarEntrada: vi.fn(),
}));
vi.mock('@/lib/apiBase', () => ({ API_BASE_URL: 'https://api.test/api/v1' }));
vi.mock('@/lib/perf/dispositivo', () => ({ modoLeve: () => false }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function resposta(corpo: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, json: () => Promise.resolve(corpo) } as Response);
}

describe('origemDaFaixa', () => {
  it('pergunta ao acervo por uma faixa que não está na biblioteca e devolve o link', async () => {
    fetchMock.mockReturnValueOnce(
      resposta({ data: { sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }),
    );
    const { origemDaFaixa } = await import('../detalheDaFaixa');
    await expect(origemDaFaixa('cat:1')).resolves.toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.test/api/v1/catalogo/cat%3A1');
  });

  it('guarda a resposta e junta chamadas simultâneas numa busca só', async () => {
    fetchMock.mockReturnValue(resposta({ data: { sourceUrl: null } }));
    const { origemDaFaixa } = await import('../detalheDaFaixa');
    const [a, b] = await Promise.all([origemDaFaixa('cat:2'), origemDaFaixa('cat:2')]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    await expect(origemDaFaixa('cat:2')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('acervo fora do ar: responde null sem estourar', async () => {
    fetchMock.mockRejectedValueOnce(new Error('rede'));
    const { origemDaFaixa } = await import('../detalheDaFaixa');
    await expect(origemDaFaixa('cat:3')).resolves.toBeNull();
  });
});
