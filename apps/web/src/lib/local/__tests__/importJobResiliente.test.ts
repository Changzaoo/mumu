/**
 * O IMPORT POR JOB NÃO PODE PENDURAR NEM PERDER O QUE JÁ BAIXOU.
 *
 * O fluxo (start -> poll -> file) existe para sobreviver ao 524. Mas ele troca
 * "uma conexão longa" por "várias curtas", e cada uma é uma chance de a rede de
 * celular piscar. Aqui se prova que um blip em qualquer degrau não derruba o
 * job, e que um job que nunca termina acaba em erro em vez de segurar uma das
 * 3 vagas da fila para sempre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ getIdToken: async () => null }));

async function montar(): Promise<typeof import('@/lib/local/importerHelper')> {
  vi.resetModules();
  return await import('@/lib/local/importerHelper');
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mp3 = (n = 16): Response => new Response('x'.repeat(n), { status: 200 });

type Rota = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** fetch roteado por trecho da URL; /health sempre anuncia jobs. */
function rotear(rotas: Record<string, Rota>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/health')) return json({ ok: true, hosts: [], caps: ['jobs'] });
    if (url.includes('/import/start')) return json({ id: 'j1' });
    for (const [trecho, rota] of Object.entries(rotas)) {
      if (url.includes(trecho)) return rota(url, init);
    }
    throw new Error(`chamada inesperada: ${url}`);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Roda o import avançando o relógio até ele assentar, devolvendo o desfecho. */
async function rodar(url = 'https://youtu.be/abc', ms = 60_000) {
  const helper = await montar();
  const p = helper.importViaHelper(url).then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e: e as Error & { status?: number } }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

describe('import por job: blips não matam o job', () => {
  it('poll que erra (rede/5xx) e depois responde: o job conclui', async () => {
    let n = 0;
    rotear({
      '/import/job/': () => {
        n += 1;
        if (n === 1) throw new TypeError('rede piscou');
        if (n === 2) return json({}, 502);
        return json({ status: 'done', meta: { title: 'T' } });
      },
      '/import/file/': () => mp3(),
    });
    const r = await rodar();
    expect(r.ok).toBe(true);
  });

  it('poll com corpo que NÃO é JSON (túnel devolvendo HTML) é blip, não erro fatal', async () => {
    let n = 0;
    rotear({
      '/import/job/': () =>
        ++n === 1
          ? new Response('<html>Just a moment...</html>', { status: 200 })
          : json({ status: 'done', meta: {} }),
      '/import/file/': () => mp3(),
    });
    const r = await rodar();
    expect(r.ok).toBe(true);
  });

  it('poll que PENDURA (a conexão não responde) não congela o job para sempre', async () => {
    let n = 0;
    rotear({
      '/import/job/': (_u, init) =>
        ++n === 1
          ? new Promise<Response>((_res, rej) => {
              init?.signal?.addEventListener('abort', () =>
                rej(new DOMException('abort', 'AbortError')),
              );
            })
          : json({ status: 'done', meta: {} }),
      '/import/file/': () => mp3(),
    });
    const r = await rodar('https://youtu.be/abc', 120_000);
    expect(r.ok).toBe(true);
  });

  it('blip no download do arquivo pronto: tenta de novo em vez de perder o job', async () => {
    let n = 0;
    rotear({
      '/import/job/': () => json({ status: 'done', meta: {} }),
      '/import/file/': () => {
        if (++n === 1) throw new TypeError('Failed to fetch');
        return mp3();
      },
    });
    const r = await rodar();
    expect(r.ok).toBe(true);
  });
});

describe('import por job: finais honestos', () => {
  it('job que nunca termina estoura o teto e vira erro (não segura a vaga)', async () => {
    rotear({ '/import/job/': () => json({ status: 'running' }) });
    const r = await rodar('https://youtu.be/abc', 16 * 60_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.e.message).toMatch(/demorou demais/);
  });

  it('job que falha com defeito permanente chega como 422 (a fila não retenta)', async () => {
    rotear({
      '/import/job/': () => json({ status: 'error', error: 'Vídeo privado', permanent: true }),
    });
    const r = await rodar();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.e.status).toBe(422);
      expect(r.e.message).toBe('Vídeo privado');
    }
  });

  it('job sumido do servidor (404 no poll) pede para tentar de novo', async () => {
    rotear({ '/import/job/': () => json({}, 404) });
    const r = await rodar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.e.message).toMatch(/expirou/);
  });

  it('arquivo de 0 bytes é recusado, não gravado', async () => {
    rotear({
      '/import/job/': () => json({ status: 'done', meta: {} }),
      '/import/file/': () => new Response('', { status: 200 }),
    });
    const r = await rodar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.e.message).toMatch(/vazio/);
  });

  it('start recusado com 429 carrega Retry-After para a fila esperar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/health')
          ? json({ ok: true, caps: ['jobs'] })
          : new Response(JSON.stringify({ error: 'limite' }), {
              status: 429,
              headers: { 'Retry-After': '42' },
            }),
      ),
    );
    const r = await rodar();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.e.status).toBe(429);
      expect((r.e as unknown as { esperarSeg: number }).esperarSeg).toBe(42);
    }
  });
});
