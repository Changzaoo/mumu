/**
 * UM BLIP NA SONDAGEM NÃO PODE DEVOLVER O IMPORT AO POST QUE O 524 MATA.
 *
 * `importViaHelper` decide entre dois caminhos perguntando `/health` do
 * importador: se ele anuncia a capacidade 'jobs', usa o fluxo por job (start →
 * poll → file), imune ao timeout de ~100s do Cloudflare; senão cai no POST
 * clássico, que fica mudo até o MP3 inteiro terminar e por isso morre em
 * downloads longos (524).
 *
 * A sondagem em si passa pela MESMA rede que falha — um blip nela não pode
 * silenciosamente decidir "não tem job" e mandar a faixa pro caminho frágil.
 * Este teste prova que, quando a sondagem falha de vez (todas as tentativas),
 * o import ainda escolhe o fluxo por job — o lado seguro do desconhecido.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ getIdToken: async () => null }));

async function montar(): Promise<typeof import('@/lib/local/importerHelper')> {
  vi.resetModules();
  return await import('@/lib/local/importerHelper');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('fluxo por job sobrevive a um blip na sondagem de capacidade', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sondagem falhando SEMPRE ainda escolhe /import/start, nunca o /import clássico', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        chamadas.push(url);
        if (url.includes('/health')) throw new Error('rede piscou'); // sondagem sempre falha
        if (url.includes('/import/start')) return jsonResponse({ id: 'job-1' });
        if (url.includes('/import/job/')) return jsonResponse({ status: 'done', meta: {} });
        if (url.includes('/import/file/')) {
          return new Response(new Blob(['mp3-bytes']), { status: 200 });
        }
        throw new Error(`chamada inesperada: ${url}`);
      }),
    );

    const helper = await montar();
    const resultado = await helper.importViaHelper('https://youtu.be/abc');

    expect(resultado.blob.size).toBeGreaterThan(0);
    // O caminho escolhido foi o de job — nunca o POST clássico de faixa única.
    expect(chamadas.some((u) => u.includes('/import/start'))).toBe(true);
    expect(chamadas.some((u) => u.endsWith('/import') || u.includes('/import '))).toBe(false);
  });

  it('sondagem bem-sucedida SEM a capacidade cai no /import clássico (comportamento real, não blip)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/health')) {
          return jsonResponse({ ok: true, hosts: [], caps: ['uploader', 'album'] }); // sem 'jobs'
        }
        if (url.endsWith('/import')) {
          return new Response(new Blob(['mp3-bytes']), {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
        throw new Error(`chamada inesperada: ${url}`);
      }),
    );

    const helper = await montar();
    const resultado = await helper.importViaHelper('https://youtu.be/abc');

    expect(resultado.blob.size).toBeGreaterThan(0);
  });
});
