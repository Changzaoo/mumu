/**
 * A ORDEM DE PREFERÊNCIA QUANDO O LRCLIB NÃO TEM TEMPO.
 *
 * `fetchLyrics` só pergunta ao importador por outras fontes (NetEase,
 * lyrics.ovh — via `apps/importer/outrasFontesDeLetra.mjs`) quando o LRCLIB
 * não devolveu uma versão COM TEMPO. E mesmo aí a resposta não entra de
 * qualquer jeito: uma fonte externa com tempo pode substituir um texto puro
 * (ou o vazio) do LRCLIB, mas um texto puro externo NUNCA derruba um texto
 * puro que o LRCLIB já tinha — o LRCLIB passou pela checagem estrita de
 * `rowMatches`; a fonte externa é busca livre, menos verificada.
 *
 * Ordem: LRCLIB com tempo > outra fonte com tempo > LRCLIB texto puro > outra
 * fonte texto puro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { fetchOutraFonteDeLetra } from '@/lib/local/importerHelper';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/ai/ai', () => ({
  aiCleanSongTitle: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  fetchOutraFonteDeLetra: vi.fn(),
}));

const mockOutraFonte = vi.mocked(fetchOutraFonteDeLetra);

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 'local:t1',
    title: 'Warzone',
    durationMs: 166_000,
    previewOnly: false,
    artists: [{ id: 'a1', name: 'Brandão85', slug: 'brandao85', imageUrl: null }],
    album: { id: 'al1', title: 'Álbum', slug: 'album', coverUrl: null },
    ...over,
  }) as TrackDto;

/** Um `Response` mínimo o bastante para o que `lrclibGet` lê. */
const respostaJson = (body: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve(body) }) as Response;

/**
 * Stub de fetch para o LRCLIB: `/api/get` devolve `getRow` (ou `{}`, que
 * `rowMatches` sempre recusa) para TODA tentativa exata; `/api/search` devolve
 * `searchRows` para a busca solta. Não precisamos diferenciar candidato a
 * candidato aqui — só o resultado final de `lrclibGet` importa a este arquivo
 * (a fila de candidatos já tem seu próprio teste em letraSemFilaIndiana).
 */
function stubLrclib(opts: { getRow?: Record<string, unknown>; searchRows?: unknown[] }) {
  return vi.fn((url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/api/get')) return Promise.resolve(respostaJson(opts.getRow ?? {}));
    if (path.endsWith('/api/search')) return Promise.resolve(respostaJson(opts.searchRows ?? []));
    return Promise.resolve(respostaJson(null));
  });
}

const linhaSincronizada = {
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  syncedLyrics: '[00:01.00]do lrclib, com tempo',
};
const linhaTextoPuro = {
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  plainLyrics: 'do lrclib, texto puro',
};

describe('outras fontes só entram quando o LRCLIB não tem tempo', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    mockOutraFonte.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('LRCLIB com tempo: nem pergunta ao importador', async () => {
    vi.stubGlobal('fetch', stubLrclib({ getRow: linhaSincronizada }));
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa());

    expect(letra?.synced).toBe(true);
    expect(letra?.lines[0]?.text).toBe('do lrclib, com tempo');
    expect(mockOutraFonte).not.toHaveBeenCalled();
  });

  it('sem nada no LRCLIB + outra fonte com tempo: usa a outra fonte', async () => {
    vi.stubGlobal('fetch', stubLrclib({}));
    mockOutraFonte.mockResolvedValue({
      synced: true,
      lrc: '[00:02.00]da netease, com tempo',
      fonte: 'netease',
    });
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa());

    expect(letra?.synced).toBe(true);
    expect(letra?.lines[0]?.text).toBe('da netease, com tempo');
  });

  it('LRCLIB só texto puro + outra fonte com tempo: a outra fonte vence', async () => {
    vi.stubGlobal('fetch', stubLrclib({ getRow: linhaTextoPuro }));
    mockOutraFonte.mockResolvedValue({
      synced: true,
      lrc: '[00:03.00]da netease, com tempo',
      fonte: 'netease',
    });
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa());

    expect(letra?.synced).toBe(true);
    expect(letra?.lines[0]?.text).toBe('da netease, com tempo');
  });

  it('LRCLIB só texto puro + outra fonte só texto puro: o LRCLIB fica (é o mais verificado)', async () => {
    vi.stubGlobal('fetch', stubLrclib({ getRow: linhaTextoPuro }));
    mockOutraFonte.mockResolvedValue({
      synced: false,
      plain: 'da netease, texto puro',
      fonte: 'netease',
    });
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa());

    expect(letra?.synced).toBe(false);
    expect(letra?.lines[0]?.text).toBe('do lrclib, texto puro');
  });

  it('sem nada no LRCLIB + outra fonte só texto puro: usa o texto puro da outra fonte', async () => {
    vi.stubGlobal('fetch', stubLrclib({}));
    mockOutraFonte.mockResolvedValue({
      synced: false,
      plain: 'da netease, texto puro',
      fonte: 'netease',
    });
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa());

    expect(letra?.synced).toBe(false);
    expect(letra?.lines[0]?.text).toBe('da netease, texto puro');
  });

  it('nada nas duas fontes: null', async () => {
    vi.stubGlobal('fetch', stubLrclib({}));
    mockOutraFonte.mockResolvedValue(null);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    expect(await fetchLyrics(faixa())).toBeNull();
  });

  it('faixa de preview (30s): nem pergunta ao importador — os timestamps seriam da música inteira', async () => {
    vi.stubGlobal('fetch', stubLrclib({}));
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa({ previewOnly: true, durationMs: 30_000 }));

    expect(letra).toBeNull();
    expect(mockOutraFonte).not.toHaveBeenCalled();
  });
});
