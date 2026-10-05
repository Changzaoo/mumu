/**
 * Fonte fora do ar, lenta, com JSON quebrado, cache sujo e troca rápida de
 * faixa. Duas regras: (1) falha da FONTE nunca vira "essa faixa não tem letra"
 * (a entrada negativa dura uma semana); (2) a letra de uma faixa nunca aparece
 * em outra.
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
vi.mock('@/lib/conteudo/faixaEtaria', () => ({ registrarLetra: vi.fn() }));

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

const linhaBoa = {
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  syncedLyrics: '[00:01.00]letra certa',
};

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const erro = (status: number): Response =>
  ({ ok: false, status, json: () => Promise.resolve({}) }) as Response;

/** `modo` muda durante o teste: a fonte cai e volta. */
function fonte(modo: { atual: 'ok' | 'cai' | '500' | '404' | 'jsonQuebrado' }) {
  return vi.fn((url: string) => {
    const path = new URL(url).pathname;
    switch (modo.atual) {
      case 'cai':
        return Promise.reject(new TypeError('Failed to fetch'));
      case '500':
        return Promise.resolve(erro(500));
      case '404':
        return Promise.resolve(path.endsWith('/api/get') ? erro(404) : ok([]));
      case 'jsonQuebrado':
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        } as Response);
      default:
        return Promise.resolve(ok(path.endsWith('/api/get') ? linhaBoa : [linhaBoa]));
    }
  });
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  mockOutraFonte.mockReset();
  mockOutraFonte.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fonte fora do ar não vira "sem letra" por uma semana', () => {
  it.each(['cai', '500', 'jsonQuebrado'] as const)(
    '%s: a próxima tentativa refaz a busca',
    async (falha) => {
      const modo = { atual: falha } as { atual: 'ok' | 'cai' | '500' | '404' | 'jsonQuebrado' };
      const f = fonte(modo);
      vi.stubGlobal('fetch', f);
      const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

      expect(await fetchLyrics(faixa())).toBeNull();

      modo.atual = 'ok'; // a fonte voltou
      const letra = await fetchLyrics(faixa());
      expect(letra?.lines[0]?.text).toBe('letra certa');
    },
  );

  it('fonte que realmente NÃO tem a letra (404 / lista vazia) é lembrada: sem rede na 2ª vez', async () => {
    const f = fonte({ atual: '404' });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    expect(await fetchLyrics(faixa())).toBeNull();
    const chamadas = f.mock.calls.length;
    expect(chamadas).toBeGreaterThan(0);
    expect(await fetchLyrics(faixa())).toBeNull();
    expect(f.mock.calls.length).toBe(chamadas);
  });

  it('entrada negativa vencida (> 7 dias) volta a perguntar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const modo = { atual: '404' } as { atual: 'ok' | '404' };
    const f = fonte(modo);
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    expect(await fetchLyrics(faixa())).toBeNull();
    modo.atual = 'ok';
    expect(await fetchLyrics(faixa())).toBeNull(); // ainda no prazo
    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
    expect((await fetchLyrics(faixa()))?.lines[0]?.text).toBe('letra certa');
  });
});

describe('entradas do LRCLIB e da faixa', () => {
  it('duração 0 / NaN / negativa: não usa /api/get (duração é a prova); a busca solta segue', async () => {
    for (const durationMs of [0, Number.NaN, -5000]) {
      vi.resetModules();
      window.localStorage.clear();
      const f = fonte({ atual: 'ok' });
      vi.stubGlobal('fetch', f);
      const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

      await fetchLyrics(faixa({ durationMs }));

      const gets = f.mock.calls.filter(([u]) => new URL(u as string).pathname.endsWith('/api/get'));
      expect(gets, `durationMs=${durationMs}`).toHaveLength(0);
    }
  });

  it('preview de 30s: nunca manda duração e nunca aceita só pelo título', async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve(
        ok(
          new URL(url).pathname.endsWith('/api/get')
            ? {}
            : [{ ...linhaBoa, artistName: 'Outro Artista', syncedLyrics: '[00:01.00]alheia' }],
        ),
      ),
    );
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    const letra = await fetchLyrics(faixa({ previewOnly: true, durationMs: 30_000 }));

    expect(letra).toBeNull();
    for (const [u] of f.mock.calls)
      expect(new URL(u as string).searchParams.has('duration')).toBe(false);
  });

  it('crédito "Desconhecido" não vai para a busca como artista', async () => {
    const f = fonte({ atual: '404' });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    await fetchLyrics(
      faixa({ artists: [{ id: 'x', name: 'Desconhecido', slug: 'd', imageUrl: null }] }),
    );

    for (const [u] of f.mock.calls) {
      expect(new URL(u as string).searchParams.get('artist_name')).toBeNull();
    }
  });

  it.each([
    ['Warzone (feat. Fulano) - Remastered 2011', 'Warzone'],
    ['Warzone - 2011 Remaster', 'Warzone'],
    ['Warzone - Ao Vivo', 'Warzone'],
    ['Warzone [Official Video]', 'Warzone'],
    ['Warzone feat. Fulano', 'Warzone'],
  ])('título "%s" também é buscado como "%s"', async (titulo, limpo) => {
    const f = fonte({ atual: '404' });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    await fetchLyrics(faixa({ title: titulo }));

    const buscados = f.mock.calls.map(([u]) => new URL(u as string).searchParams.get('track_name'));
    expect(buscados).toContain(limpo);
  });

  it('título só de "(feat.)" não vira busca vazia', async () => {
    const f = fonte({ atual: '404' });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    await fetchLyrics(faixa({ title: '(feat. Fulano)' }));

    for (const [u] of f.mock.calls) {
      expect(new URL(u as string).searchParams.get('track_name')).toBeTruthy();
    }
  });

  it('LRCLIB devolve a música de OUTRO artista com letra sincronizada: recusa', async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve(
        ok(
          new URL(url).pathname.endsWith('/api/get')
            ? { ...linhaBoa, artistName: 'Fulano', duration: 300 }
            : [{ ...linhaBoa, artistName: 'Fulano', duration: 166 }],
        ),
      ),
    );
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    expect(await fetchLyrics(faixa())).toBeNull();
  });
});

describe('troca rápida de faixa', () => {
  it('a letra da faixa lenta não vaza para a rápida, e cada uma fica na sua chave', async () => {
    const porTitulo: Record<string, string> = {
      Lenta: 'letra da lenta',
      Rapida: 'letra da rapida',
    };
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      const titulo = u.searchParams.get('track_name') ?? '';
      if (titulo === 'Lenta') await new Promise((r) => setTimeout(r, 40));
      const row = {
        trackName: titulo,
        artistName: 'Brandão85',
        duration: 166,
        syncedLyrics: `[00:01.00]${porTitulo[titulo] ?? '?'}`,
      };
      return ok(u.pathname.endsWith('/api/get') ? row : [row]);
    });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics, cachedLyrics } = await import('@/lib/lyrics/lyrics');

    const lenta = fetchLyrics(faixa({ id: 'a', title: 'Lenta' }));
    const rapida = fetchLyrics(faixa({ id: 'b', title: 'Rapida' }));

    expect((await rapida)?.lines[0]?.text).toBe('letra da rapida');
    expect((await lenta)?.lines[0]?.text).toBe('letra da lenta');
    expect(cachedLyrics('a')?.lines[0]?.text).toBe('letra da lenta');
    expect(cachedLyrics('b')?.lines[0]?.text).toBe('letra da rapida');
  });

  it('metadado corrigido (título novo) invalida a letra antiga em cache', async () => {
    const f = fonte({ atual: 'ok' });
    vi.stubGlobal('fetch', f);
    const { fetchLyrics } = await import('@/lib/lyrics/lyrics');

    await fetchLyrics(faixa());
    const antes = f.mock.calls.length;
    await fetchLyrics(faixa({ title: 'Outro Título' }));
    expect(f.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe('cache sujo no localStorage', () => {
  it('entrada nula, texto ou sem linhas não derruba leitura nem a busca por trecho', async () => {
    window.localStorage.setItem(
      'aurial:lyrics-cache',
      JSON.stringify({
        nula: null,
        texto: 'quebrado',
        numero: 7,
        semLinhas: { synced: true, source: null },
        linhasErradas: { lyrics: { synced: true, source: null, lines: 'x' }, fingerprint: 'f' },
        boa: { synced: false, source: null, lines: [{ timeMs: 0, text: 'tudo certo aqui' }] },
      }),
    );
    const { cachedLyrics, lyricsCacheEntries } = await import('@/lib/lyrics/lyrics');

    for (const id of ['nula', 'texto', 'numero', 'semLinhas', 'linhasErradas']) {
      expect(() => cachedLyrics(id), id).not.toThrow();
      expect(cachedLyrics(id), id).toBeNull();
    }
    expect(lyricsCacheEntries().map(([id]) => id)).toEqual(['boa']);
  });

  it('JSON inválido no armazenamento vira cache vazio, não exceção', async () => {
    window.localStorage.setItem('aurial:lyrics-cache', '{quebrado');
    const { cachedLyrics, lyricsCacheEntries } = await import('@/lib/lyrics/lyrics');
    expect(cachedLyrics('x')).toBeNull();
    expect(lyricsCacheEntries()).toEqual([]);
  });
});
