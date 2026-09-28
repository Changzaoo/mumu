/**
 * Rotação de nó de descoberta do Audius: um nó morto não pode derrubar o
 * catálogo inteiro. `nextAudiusHost` precisa achar um candidato ainda não
 * tentado e promovê-lo a host da sessão (para as PRÓXIMAS faixas já nascerem
 * apontando para um nó vivo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOSTS = ['https://node-a.audius.co', 'https://node-b.audius.co', 'https://node-c.audius.co'];

function mockDiscoveryList(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.audius.co')) {
        return new Response(JSON.stringify({ data: HOSTS }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

describe('nextAudiusHost', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('escolhe um nó ainda não tentado e o promove para a sessão', async () => {
    mockDiscoveryList();
    const { nextAudiusHost, audiusHost } = await import('@/lib/catalog/audius');
    const next = await nextAudiusHost(['https://node-a.audius.co']);
    expect(next).not.toBeNull();
    expect(next).not.toBe('https://node-a.audius.co');
    expect(HOSTS).toContain(next);
    // Promovido: a PRÓXIMA faixa já nasce apontando para o nó vivo.
    expect(audiusHost()).toBe(next);
  });

  it('cai no FALLBACK_HOST quando todos os nós da lista já foram tentados', async () => {
    mockDiscoveryList();
    const { nextAudiusHost } = await import('@/lib/catalog/audius');
    const next = await nextAudiusHost(HOSTS);
    expect(next).toBe('https://discoveryprovider.audius.co');
  });

  it('devolve null quando até o fallback já foi tentado (nada mais a rotacionar)', async () => {
    mockDiscoveryList();
    const { nextAudiusHost } = await import('@/lib/catalog/audius');
    const next = await nextAudiusHost([...HOSTS, 'https://discoveryprovider.audius.co']);
    expect(next).toBeNull();
  });

  it('descoberta indisponível: ainda tenta o FALLBACK_HOST antes de desistir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    const { nextAudiusHost } = await import('@/lib/catalog/audius');
    await expect(nextAudiusHost([])).resolves.toBe('https://discoveryprovider.audius.co');
    // Sem mais candidatos (fallback já tentado) e a lista de descoberta segue
    // fora do ar: aí sim desiste, sem lançar (best-effort).
    await expect(nextAudiusHost(['https://discoveryprovider.audius.co'])).resolves.toBeNull();
  });
});
