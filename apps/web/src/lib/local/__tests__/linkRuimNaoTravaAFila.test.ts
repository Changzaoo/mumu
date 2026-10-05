/**
 * LINK QUE NUNCA VAI FUNCIONAR NÃO PODE PAUSAR A FILA DOS OUTROS.
 *
 * A fila conta 3 falhas seguidas como "importador fora do ar" e pausa TUDO por
 * 5 minutos. Um link colado errado ("youtu.be" sem https, texto qualquer, link
 * de serviço que não importamos) é defeito do LINK, não do sistema — mas
 * `addByUrl` o recusava com um Error simples, que a fila trata como transitório:
 * três links ruins numa lista colada seguravam todos os bons atrás deles.
 * A fila já tem o contrato certo (status 400/404/422 = permanente, não conta no
 * breaker); falta `addByUrl` falar essa língua.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addByUrl = vi.fn<(url: string, opts?: { silent?: boolean }) => Promise<{ title: string }>>();
vi.mock('@/lib/local/localLibrary', () => ({
  findBySource: () => null,
  addByUrl: (url: string, opts?: { silent?: boolean }) => addByUrl(url, opts),
  list: () => [],
}));
vi.mock('@/lib/local/importerHelper', () => ({
  isPlaylistUrl: () => false,
  fetchPlaylistEntries: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ subscribeAuth: () => () => undefined }));
vi.mock('@/stores/notificationsStore', () => ({ pushNotification: vi.fn() }));
vi.mock('@/lib/local/importacoesNaConta', () => ({
  registrar: vi.fn(),
  marcar: vi.fn(),
  tocar: vi.fn(),
}));

async function carregar() {
  vi.resetModules();
  window.localStorage.clear();
  return import('../importQueue');
}

async function assentar() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function erroHttp(status: number, message = 'x'): Error {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  addByUrl.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fila de import: defeito de link não vira pausa geral', () => {
  it('três 404 seguidos (faixa apagada) não pausam a fila; o link bom depois baixa', async () => {
    const q = await carregar();
    addByUrl.mockImplementation(async (url) => {
      if (url.includes('bom')) return { title: 'Boa' };
      throw erroHttp(404);
    });

    q.enqueue([
      'https://youtu.be/ruim1',
      'https://youtu.be/ruim2',
      'https://youtu.be/ruim3',
      'https://youtu.be/bom',
    ]);
    await assentar();

    expect(q.pauseReason()).toBeNull();
    expect(q.list().find((i) => i.url.includes('bom'))?.status).toBe('done');
    expect(q.list().filter((i) => i.status === 'error' && i.permanent)).toHaveLength(3);
  });

  it('503 transitório do importador conta no breaker (3 seguidos pausam, e voltam sozinhos)', async () => {
    vi.useFakeTimers();
    const q = await carregar();
    addByUrl.mockRejectedValue(erroHttp(503, 'indisponível'));
    q.enqueue(['https://youtu.be/a', 'https://youtu.be/b', 'https://youtu.be/c']);
    await assentar();
    expect(q.pauseReason()).toBe('backoff');

    // O importador voltou: a pausa se desfaz sozinha em 5 min e a fila anda.
    addByUrl.mockResolvedValue({ title: 'ok' });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(q.pauseReason()).toBeNull();
    expect(q.list().every((i) => i.status === 'done')).toBe(true);
  });

  it('o que estava baixando quando a aba fechou volta para a fila no reload', async () => {
    vi.resetModules();
    window.localStorage.setItem(
      'aurial:import-queue',
      JSON.stringify([{ id: 'q7', url: 'https://youtu.be/meio', status: 'downloading' }]),
    );
    addByUrl.mockResolvedValue({ title: 'Meio' });
    const q = await import('../importQueue');
    expect(q.list()[0]?.status).toBe('pending');
    q.init();
    await assentar();
    expect(q.list()[0]?.status).toBe('done');
  });

  it('o mesmo vídeo com ?si= / &list= não entra duas vezes', async () => {
    const q = await carregar();
    addByUrl.mockImplementation(() => new Promise(() => undefined)); // fica em andamento
    q.enqueue('https://www.youtube.com/watch?v=abcdefghijk');
    q.enqueue('https://youtu.be/abcdefghijk?si=zzz');
    expect(q.list()).toHaveLength(1);
  });
});
