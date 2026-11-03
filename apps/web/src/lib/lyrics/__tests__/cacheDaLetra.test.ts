/**
 * O CACHE DA LETRA (auditoria 03/11/2026, 5.2):
 *   - 429/5xx/rede do importador NÃO viram "sem letra" por 7 dias;
 *   - letra achada vence em 30 dias e é conferida de novo (sem perder a antiga);
 *   - metadado mudou → busca de novo; offline não mostra letra de outro título;
 *   - letra carimbada (selada) vale pelo áudio, não pelo título.
 * LRCLIB e importador dublados; nada sai para a rede.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: (k: string, v: string) => window.localStorage.setItem(k, v),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/ai/ai', () => ({ aiCleanSongTitle: vi.fn(async () => null) }));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({ registrarLetra: vi.fn() }));
vi.mock('@/lib/local/saudeDoImportador', () => ({ circuitoAberto: () => false }));
vi.mock('@/lib/local/importerHelper', () => ({ helperUrl: () => 'http://importador.test' }));

type R = { status: number; corpo?: unknown } | 'rede';
let lrclibGet: R;
let lrclibSearch: R;
let importador: R;
let pedidos: string[];

const SYNC = '[00:17.00]Lembrei de tu\n[00:21.00]Na madrugada';
const SYNC_NOVA = '[00:28.60]Lembrei de tu\n[00:32.60]Na madrugada';
const row = (synced = SYNC) => ({
  id: 1,
  trackName: 'Lembrei de Tu',
  artistName: 'MC Meno K',
  duration: 173,
  syncedLyrics: synced,
  plainLyrics: 'Lembrei de tu\nNa madrugada',
});

function resposta(r: R): Response {
  if (r === 'rede') throw new TypeError('Failed to fetch');
  return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status });
}

vi.mock('@/lib/lyrics/portaoDoLrclib', () => ({
  pedirAoLrclib: async (url: string) => {
    pedidos.push(url);
    return resposta(url.includes('/api/get') ? lrclibGet : lrclibSearch);
  },
}));

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 't1',
    title: 'Lembrei de Tu',
    durationMs: 173_000,
    artists: [{ id: 'a', name: 'MC Meno K', slug: 'mc-meno-k', imageUrl: null }],
    album: null,
    streamUrl: null,
    ...over,
  }) as TrackDto;

let online: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  window.localStorage.clear();
  online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  pedidos = [];
  lrclibGet = { status: 404 };
  lrclibSearch = { status: 200, corpo: [] };
  importador = { status: 404 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      pedidos.push(url);
      return resposta(importador);
    }),
  );
});

afterEach(() => {
  online.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const lyrics = () => import('@/lib/lyrics/lyrics');
const dias = (n: number) => n * 24 * 3600_000;
const avancar = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe('negativo: só "não existe" de verdade dura 7 dias', () => {
  it.each([
    ['429 (taxa)', { status: 429 }],
    ['500', { status: 500 }],
    ['502', { status: 502 }],
    ['503', { status: 503 }],
    ['rede caída', 'rede' as const],
    ['200 com corpo quebrado', { status: 200 }],
  ])('importador %s: não grava "sem letra" — o próximo play pergunta de novo', async (_n, r) => {
    importador = r;
    const { fetchLyrics } = await lyrics();
    expect(await fetchLyrics(faixa())).toBeNull();
    const antes = pedidos.length;
    expect(await fetchLyrics(faixa())).toBeNull();
    expect(pedidos.length).toBeGreaterThan(antes);
  });

  it.each([
    ['LRCLIB search 500', { status: 500 }],
    ['LRCLIB search 429', { status: 429 }],
    ['LRCLIB rede', 'rede' as const],
  ])('%s: também não grava negativo', async (_n, r) => {
    lrclibSearch = r;
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    const antes = pedidos.length;
    await fetchLyrics(faixa());
    expect(pedidos.length).toBeGreaterThan(antes);
  });

  it('tudo respondeu "não tenho" (404): negativo por 7 dias, depois pergunta de novo', async () => {
    const { fetchLyrics } = await lyrics();
    expect(await fetchLyrics(faixa())).toBeNull();
    const antes = pedidos.length;
    avancar(dias(6));
    expect(await fetchLyrics(faixa())).toBeNull();
    expect(pedidos.length).toBe(antes);
    avancar(dias(1) + 1);
    await fetchLyrics(faixa());
    expect(pedidos.length).toBeGreaterThan(antes);
  });

  it('negativo vencido e offline: null sem rede', async () => {
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    avancar(dias(8));
    online.mockReturnValue(false);
    const antes = pedidos.length;
    expect(await fetchLyrics(faixa())).toBeNull();
    expect(pedidos.length).toBe(antes);
  });
});

describe('positivo: vence em 30 dias e é conferido de novo', () => {
  it('dentro do prazo: nada de rede', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics } = await lyrics();
    expect((await fetchLyrics(faixa()))?.lines[0]?.timeMs).toBe(17_000);
    const antes = pedidos.length;
    avancar(dias(29));
    expect((await fetchLyrics(faixa()))?.lines[0]?.timeMs).toBe(17_000);
    expect(pedidos.length).toBe(antes);
  });

  it('vencida: busca de novo e fica com a versão corrigida', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    avancar(dias(31));
    lrclibGet = { status: 200, corpo: row(SYNC_NOVA) };
    expect((await fetchLyrics(faixa()))?.lines[0]?.timeMs).toBe(28_600);
  });

  it.each([
    ['nada (404)', { status: 404 }],
    ['erro (500)', { status: 500 }],
  ])('vencida e a busca nova volta %s: a letra antiga fica', async (_n, r) => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics, cachedLyricsFor } = await lyrics();
    await fetchLyrics(faixa());
    avancar(dias(31));
    lrclibGet = r;
    expect((await fetchLyrics(faixa()))?.lines[0]?.timeMs).toBe(17_000);
    expect(cachedLyricsFor(faixa())?.lines[0]?.timeMs).toBe(17_000);
  });

  it('calibrada no áudio não vence (o relógio dela não é do LRCLIB)', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics, writeLyrics, cachedLyricsFor } = await lyrics();
    const achada = (await fetchLyrics(faixa()))!;
    writeLyrics('t1', { ...achada, calibrada: true }, faixa());
    avancar(dias(400));
    const antes = pedidos.length;
    expect((await fetchLyrics(faixa()))?.calibrada).toBe(true);
    expect(pedidos.length).toBe(antes);
    expect(cachedLyricsFor(faixa())?.calibrada).toBe(true);
  });

  it('entrada antiga (sem buscadaEm) começa a contar agora, sem rede', async () => {
    window.localStorage.setItem(
      'aurial:lyrics-cache',
      JSON.stringify({
        t1: {
          lyrics: { synced: true, source: null, lines: [{ timeMs: 1, text: 'velha' }] },
          fingerprint: 'lembrei de tu|mc meno k|173',
        },
      }),
    );
    const { fetchLyrics } = await lyrics();
    expect((await fetchLyrics(faixa()))?.lines[0]?.text).toBe('velha');
    expect(pedidos).toEqual([]);
    avancar(dias(31));
    lrclibGet = { status: 200, corpo: row() };
    expect((await fetchLyrics(faixa()))?.lines[0]?.text).toBe('Lembrei de tu');
  });
});

describe('metadado e offline', () => {
  it('título corrigido: busca de novo (online)', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    const antes = pedidos.length;
    await fetchLyrics(faixa({ title: 'Outra Música' }));
    expect(pedidos.length).toBeGreaterThan(antes);
  });

  it.each([
    ['título', { title: 'Outra Música' }],
    ['artista', { artists: [{ id: 'b', name: 'Outro Artista', slug: 'o', imageUrl: null }] }],
    ['duração', { durationMs: 240_000 }],
  ])('offline com %s mudado: NÃO devolve a letra do metadado antigo', async (_n, over) => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    online.mockReturnValue(false);
    expect(await fetchLyrics(faixa(over as Partial<TrackDto>))).toBeNull();
  });

  it('offline com o mesmo metadado: devolve a letra, mesmo vencida', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics } = await lyrics();
    await fetchLyrics(faixa());
    avancar(dias(90));
    online.mockReturnValue(false);
    const antes = pedidos.length;
    expect((await fetchLyrics(faixa()))?.lines).toHaveLength(2);
    expect(pedidos.length).toBe(antes);
  });

  it('carimbada (selada) vale pelo áudio: metadado novo não a troca, nem online', async () => {
    lrclibGet = { status: 200, corpo: row() };
    const { fetchLyrics, writeLyrics } = await lyrics();
    const achada = (await fetchLyrics(faixa()))!;
    writeLyrics('t1', { ...achada, calibrada: true, selada: true }, faixa());
    const antes = pedidos.length;
    expect((await fetchLyrics(faixa({ title: 'Lembrei de Tu (Ao Vivo)' })))?.selada).toBe(true);
    expect(pedidos.length).toBe(antes);
  });

  it('writeLyrics com a faixa grava o fingerprint dela (não vira entrada legada)', async () => {
    const { writeLyrics, cachedLyricsFor } = await lyrics();
    writeLyrics('t1', { synced: true, source: null, lines: [{ timeMs: 0, text: 'x' }] }, faixa());
    const bruto = JSON.parse(window.localStorage.getItem('aurial:lyrics-cache')!);
    expect(bruto.t1.fingerprint).toBe('lembrei de tu|mc meno k|173');
    expect(cachedLyricsFor(faixa({ title: 'Outra' }))).toBeNull();
  });
});

describe('a escolha entre as linhas da busca solta', () => {
  it('prefere a linha com duração mais perto, não a primeira que veio', async () => {
    lrclibSearch = {
      status: 200,
      corpo: [
        { ...row(), id: 1, duration: 176 },
        { ...row(SYNC_NOVA), id: 2, duration: 173 },
      ],
    };
    const { fetchLyrics } = await lyrics();
    expect((await fetchLyrics(faixa()))?.lines[0]?.timeMs).toBe(28_600);
  });

  it.each([
    ['outro artista', { artistName: 'Zé Neto e Cristiano' }],
    ['duração longe', { duration: 240 }],
    ['parte 2 de outra música', { trackName: 'Lembrei de Tu, Pt. 2', duration: null }],
    ['instrumental', { trackName: 'Lembrei de Tu (Instrumental)' }],
  ])('recusa %s', async (_n, over) => {
    lrclibSearch = { status: 200, corpo: [{ ...row(), ...over }] };
    const { fetchLyrics } = await lyrics();
    expect(await fetchLyrics(faixa())).toBeNull();
  });
});
