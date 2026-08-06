/**
 * O ACERVO SAIU DO FIRESTORE — o que precisa continuar valendo.
 *
 * A troca foi por custo: a coleção inteira era lida a cada abertura do app, por
 * cada pessoa, e o limite grátis de 50 mil leituras/dia é do PROJETO — quando
 * estourava, caíam junto acervo, sincronia e curtidas. Aconteceu três vezes.
 *
 * Mas o SDK do Firestore dava duas coisas de graça, e perder qualquer uma delas
 * seria trocar um defeito por outro:
 *
 *   1. o acervo aparecer NO BOOT e continuar aparecendo SEM REDE;
 *   2. mudança do admin chegar sem custar uma leitura por faixa a cada pergunta.
 *
 * Estes testes travam as duas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CatalogoApi from '@/lib/sync/catalogoApi';

vi.mock('@/lib/firebase', () => ({ getIdToken: () => Promise.resolve('token-de-teste') }));
vi.mock('@/lib/sync/syncStatus', () => ({
  registrarErro: vi.fn(),
  registrarSnapshot: vi.fn(),
}));

const faixa = (id: string): Record<string, unknown> => ({
  track: { id, title: `Faixa ${id}`, artists: [] },
  addedAt: '2026-01-01T00:00:00.000Z',
});

/** Uma resposta HTTP de mentira, com ETag. */
function resposta(body: unknown, etag: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Espera as promessas pendentes escoarem (o módulo trabalha em background). */
const escoar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('acervo servido pelo nosso servidor', () => {
  let api: typeof CatalogoApi;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    // Sem IndexedDB nos testes: o módulo tem que degradar para "só rede", nunca
    // quebrar — é o caso real de navegador em aba privada.
    vi.stubGlobal('indexedDB', undefined);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = await import('@/lib/sync/catalogoApi');
  });

  it('entrega o acervo e guarda o ETag da resposta', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ data: [faixa('a'), faixa('b')] }, 'W/"2-100"'));
    const recebidas: unknown[][] = [];
    const parar = api.subscribeCatalogo((e) => recebidas.push(e));
    await escoar();
    parar();

    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]).toHaveLength(2);
    // Primeira ida sem ETag: não há o que revalidar ainda.
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: {} });
  });

  it('304 não acorda ninguém — é o que torna barato perguntar de novo', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta({ data: [faixa('a')] }, 'W/"1-100"'))
      .mockResolvedValueOnce(resposta(null, 'W/"1-100"', 304));

    const recebidas: unknown[][] = [];
    const parar = api.subscribeCatalogo((e) => recebidas.push(e));
    await escoar();

    // Simula a revalidação que o timer faria (voltar para a aba).
    document.dispatchEvent(new Event('visibilitychange'));
    await escoar();
    parar();

    // Duas idas à rede, UMA entrega ao app: repetir o mesmo conteúdo repintaria
    // a biblioteca inteira de graça, várias vezes por sessão.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recebidas).toHaveLength(1);
    // A segunda ida levou o ETag — sem ele o servidor mandaria o corpo inteiro.
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { 'If-None-Match': 'W/"1-100"' } });
  });

  it('servidor fora do ar não apaga o que está na tela', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    const recebidas: unknown[][] = [];
    const parar = api.subscribeCatalogo((e) => recebidas.push(e));
    await escoar();
    parar();
    // Nunca entregar lista vazia por falha de rede: quem consome isto APAGA o
    // que não veio no snapshot. Silêncio é a resposta certa.
    expect(recebidas).toHaveLength(0);
  });

  it('cancelar a assinatura para de perguntar', async () => {
    fetchMock.mockResolvedValue(resposta({ data: [] }, 'W/"0-0"'));
    const parar = api.subscribeCatalogo(() => undefined);
    await escoar();
    parar();
    const antes = fetchMock.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await escoar();
    expect(fetchMock.mock.calls.length).toBe(antes);
  });

  // ── escrita ──────────────────────────────────────────────────────────────

  it('publicar manda o token — o servidor é quem decide quem pode', async () => {
    fetchMock.mockResolvedValueOnce(resposta(null, '', 204));
    await api.publicarEntrada(faixa('x') as never);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/catalogo/x');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-de-teste');
  });

  it('lote é UMA requisição, não uma por faixa', async () => {
    // Trezentas faixas seriam trezentas idas e voltas pelo túnel de casa.
    fetchMock.mockResolvedValueOnce(resposta({ data: { publicadas: 3 } }, ''));
    const enviadas = await api.publicarLote([faixa('a'), faixa('b'), faixa('c')] as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enviadas).toBe(3);
  });

  it('lote vazio não gasta requisição nenhuma', async () => {
    expect(await api.publicarLote([])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa do servidor vira erro de verdade, não silêncio', async () => {
    // Falha silenciosa aqui já custou dias de procura no lugar errado.
    fetchMock.mockResolvedValueOnce(resposta(null, '', 403));
    await expect(api.publicarEntrada(faixa('x') as never)).rejects.toThrow('403');
  });
});
