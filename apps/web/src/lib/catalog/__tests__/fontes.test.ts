/**
 * Fontes do catálogo (Audius + iTunes) diante de terceiros que mentem:
 * campo ausente, JSON/HTML errado, nó pendurado, lista de nós que falhou uma
 * vez. "Fonte caída" precisa virar `CatalogError` (a UI diferencia de "nada
 * achado"), nunca TypeError solto nem espera infinita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audiusTrackToDto, streamUrlFor, type AudiusTrack } from '@/lib/catalog/map';
import { appleSongToDto } from '@/lib/catalog/mapApple';
import type { AppleSong } from '@/lib/catalog/itunes';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const faixa = (over: Record<string, unknown> = {}): AudiusTrack =>
  ({
    id: 't1',
    title: 'Faixa',
    duration: 100,
    user: { id: 'u1', name: 'Artista', handle: 'art' },
    ...over,
  }) as AudiusTrack;

/** fetch que nunca responde; só rejeita quando o chamador aborta. */
const fetchPendurado = () =>
  vi.fn(
    (_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('abort')));
      }),
  );

describe('audiusTrackToDto com dados de terceiros quebrados', () => {
  it('faixa sem `user` não lança — vira artista vazio', () => {
    const dto = audiusTrackToDto(faixa({ user: undefined }));
    expect(dto.id).toBe('audius:t1');
    expect(dto.artists).toHaveLength(1);
    expect(dto.artists[0]?.name).toBe('');
  });

  it('duração negativa, string ou Infinity vira 0, nunca valor inválido', () => {
    for (const d of [-5, '200', Infinity, null, NaN]) {
      const dto = audiusTrackToDto(faixa({ duration: d }));
      expect(dto.durationMs).toBe(0);
    }
  });

  it('título ausente vira string (a UI chama .length/.toLowerCase)', () => {
    expect(typeof audiusTrackToDto(faixa({ title: undefined })).title).toBe('string');
  });

  it('id é sempre namespaced e a streamUrl aceita outro nó', () => {
    expect(audiusTrackToDto(faixa()).id.startsWith('audius:')).toBe(true);
    expect(streamUrlFor('abc', 'https://n.audius.co')).toBe(
      'https://n.audius.co/v1/tracks/abc/stream?app_name=Aurial',
    );
  });
});

describe('appleSongToDto: prévia nunca vaza para download/offline/P2P', () => {
  const song = (over: Partial<AppleSong> = {}): AppleSong => ({
    trackId: 7,
    trackName: 'Hit',
    artistName: 'Fulano',
    artistId: 9,
    collectionName: 'Disco',
    collectionId: 3,
    artworkUrl100: 'https://x/100x100bb.jpg',
    previewUrl: 'https://p/7.m4a',
    trackTimeMillis: 200000,
    trackExplicitness: 'notExplicit',
    primaryGenreName: 'Pop',
    ...over,
  });

  it('previewOnly, sem downloadUrl e id namespaced, mesmo sem metadado opcional', () => {
    const dto = appleSongToDto(
      song({ collectionName: undefined, artworkUrl100: undefined, artistName: undefined } as never),
    );
    expect(dto.previewOnly).toBe(true);
    expect(dto.downloadUrl).toBeNull();
    expect(dto.id).toBe('itunes:7');
    expect(dto.coverUrl).toBeNull();
    expect(typeof (dto.album?.title ?? '')).toBe('string');
    expect(typeof (dto.artists[0]?.name ?? '')).toBe('string');
  });
});

describe('audius.ts: rede e formato', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem('aurial:audius-host', 'https://n.audius.co');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('503 e HTML no lugar de JSON viram CatalogError', async () => {
    const { searchTracks, CatalogError } = await import('@/lib/catalog/audius');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 503 })),
    );
    await expect(searchTracks('a')).rejects.toBeInstanceOf(CatalogError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>cloudflare</html>', { status: 200 })),
    );
    await expect(searchTracks('a')).rejects.toBeInstanceOf(CatalogError);
  });

  it('`data` que não é lista (objeto/null) vira CatalogError, não TypeError', async () => {
    const { searchTracks, trending, CatalogError } = await import('@/lib/catalog/audius');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: { error: 'rate limited' } })),
    );
    await expect(searchTracks('a')).rejects.toBeInstanceOf(CatalogError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: null })),
    );
    await expect(trending()).rejects.toBeInstanceOf(CatalogError);
  });

  it('nó pendurado: aborta no teto de tempo e rejeita com CatalogError', async () => {
    vi.useFakeTimers();
    const { searchTracks, CatalogError } = await import('@/lib/catalog/audius');
    vi.stubGlobal('fetch', fetchPendurado());
    const assertion = expect(searchTracks('a')).rejects.toBeInstanceOf(CatalogError);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('lista de nós que falhou UMA vez não condena a sessão sem rotação', async () => {
    const { nextAudiusHost } = await import('@/lib/catalog/audius');
    let ligado = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ligado ? json({ data: ['https://vivo.audius.co'] }) : new Response('x', { status: 502 }),
      ),
    );
    // 1ª rotação: descoberta fora do ar, só o fallback.
    await nextAudiusHost([]);
    ligado = true;
    // 2ª: a descoberta voltou; o nó vivo tem que aparecer.
    await expect(nextAudiusHost(['https://discoveryprovider.audius.co'])).resolves.toBe(
      'https://vivo.audius.co',
    );
  });

  it('id com barra não escapa do caminho do endpoint', async () => {
    const { playlist } = await import('@/lib/catalog/audius');
    const f = vi.fn(async (_u: string) => json({ data: [] }));
    vi.stubGlobal('fetch', f);
    await playlist('../users/x?y=1');
    const url = String(f.mock.calls[0]?.[0]);
    expect(url).not.toContain('/../');
    expect(url).not.toContain('?y=1');
  });
});

describe('itunes.ts: rede', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resposta que não é JSON ou 5xx vira CatalogError', async () => {
    const { searchSongs } = await import('@/lib/catalog/itunes');
    const { CatalogError } = await import('@/lib/catalog/audius');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    await expect(searchSongs('a')).rejects.toBeInstanceOf(CatalogError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    await expect(searchSongs('a')).rejects.toBeInstanceOf(CatalogError);
  });

  it('descarta linhas sem previewUrl e consulta vazia nem chama a rede', async () => {
    const { searchSongs } = await import('@/lib/catalog/itunes');
    const f = vi.fn(async () =>
      json({
        results: [{ trackId: 1, previewUrl: '' }, { trackId: 2, previewUrl: 'https://p' }, {}],
      }),
    );
    vi.stubGlobal('fetch', f);
    await expect(searchSongs('   ')).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
    const r = await searchSongs('x', 'us');
    expect(r.map((s) => s.trackId)).toEqual([2]);
  });

  it('servidor pendurado: tem teto de tempo (a UI não espera para sempre)', async () => {
    vi.useFakeTimers();
    const { searchSongs } = await import('@/lib/catalog/itunes');
    const { CatalogError } = await import('@/lib/catalog/audius');
    vi.stubGlobal('fetch', fetchPendurado());
    const assertion = expect(searchSongs('a')).rejects.toBeInstanceOf(CatalogError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
