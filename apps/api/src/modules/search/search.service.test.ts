/**
 * Busca da API: o que entra (schema) e o que sai (serviço) sem banco.
 * Repositório, cache e mapeadores são simulados — aqui só vale a regra:
 * consulta vazia não consulta, termos têm teto, o melhor resultado é o nome
 * exato, o cache nunca guarda "curtida" de um usuário para outro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchQuerySchema, suggestQuerySchema } from '@radinho/shared';

const repo = vi.hoisted(() => ({
  tracks: vi.fn(),
  tracksByArtist: vi.fn(),
  albums: vi.fn(),
  artists: vi.fn(),
  playlists: vi.fn(),
  podcasts: vi.fn(),
  radios: vi.fn(),
  users: vi.fn(),
  artistPrefix: vi.fn(),
  trackPrefix: vi.fn(),
  albumPrefix: vi.fn(),
}));
const store = vi.hoisted(() => new Map<string, unknown>());
const liked = vi.hoisted(() => vi.fn());

vi.mock('./search.repository.js', () => ({ searchRepository: repo }));
vi.mock('../library/library.repository.js', () => ({
  libraryRepository: { likedTrackIdSet: liked },
}));
vi.mock('../../infra/redis/cache.js', () => ({
  cacheKeys: { search: (q: string, t: string, l: number) => `${q}|${t}|${l}` },
  cacheTtl: { search: 60 },
  cache: {
    getJson: async (k: string) => store.get(k) ?? null,
    setJson: async (k: string, v: unknown) => void store.set(k, JSON.parse(JSON.stringify(v))),
  },
}));
vi.mock('../shared/mappers.js', () => ({
  toTrackDto: (r: unknown) => r,
  toAlbumDto: (r: unknown) => r,
  toArtistDto: (r: unknown) => r,
  toPlaylistDto: (r: unknown) => r,
  toPodcastDto: (r: unknown) => r,
  toRadioDto: (r: unknown) => r,
  toUserDto: (r: unknown) => r,
  applyLikedFlags: (tracks: Array<{ id: string }>, set: Set<string>) =>
    tracks.map((t) => ({ ...t, isLiked: set.has(t.id) })),
}));

import { searchService } from './search.service.js';

const input = (q: string, extra: Record<string, unknown> = {}) =>
  searchQuerySchema.parse({ q, ...extra });

beforeEach(() => {
  store.clear();
  for (const fn of Object.values(repo)) fn.mockReset().mockResolvedValue([]);
  liked.mockReset().mockResolvedValue(new Set());
});

describe('schema da busca', () => {
  it.each([
    [{ q: '' }],
    [{ q: 'a'.repeat(201) }],
    [{ q: ['a', 'b'] }],
    [{}],
    [{ q: 'a', limit: '0' }],
    [{ q: 'a', limit: '51' }],
    [{ q: 'a', limit: 'abc' }],
    [{ q: 'a', limit: '1.5' }],
    [{ q: 'a', type: 'track; DROP TABLE' }],
  ])('rejeita %j', (entrada) => {
    expect(searchQuerySchema.safeParse(entrada).success).toBe(false);
  });

  it('aceita o mínimo e aplica padrões; limite chega como número', () => {
    const r = searchQuerySchema.parse({ q: 'a', limit: '50' });
    expect(r).toMatchObject({ q: 'a', type: 'all', limit: 50 });
    expect(searchQuerySchema.parse({ q: 'a' }).limit).toBe(10);
  });

  it('sugestão: vazio e acima de 100 caracteres são rejeitados', () => {
    expect(suggestQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(suggestQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(suggestQuerySchema.safeParse({ q: 'a' }).success).toBe(true);
  });
});

describe('searchService.search', () => {
  it('consulta só de espaços não toca no banco e devolve vazio', async () => {
    const r = await searchService.search(input('   \t  '));
    expect(r.tracks).toEqual([]);
    expect(r.topResult).toBeNull();
    expect(repo.tracks).not.toHaveBeenCalled();
  });

  it('usa no máximo 6 termos e passa caracteres especiais intactos ao repositório', async () => {
    await searchService.search(input('a b c d e f g h (x* [y \\z'));
    const words = repo.tracks.mock.calls[0]?.[0] as string[];
    expect(words).toHaveLength(6);
    await searchService.search(input('(x* [y \\z %_'));
    expect(repo.tracks.mock.calls[1]?.[0]).toEqual(['(x*', '[y', '\\z', '%_']);
  });

  it('só consulta a entidade pedida em `type`', async () => {
    await searchService.search(input('abc', { type: 'artist' }));
    expect(repo.artists).toHaveBeenCalled();
    expect(repo.tracks).not.toHaveBeenCalled();
    expect(repo.albums).not.toHaveBeenCalled();
    expect(repo.tracksByArtist).not.toHaveBeenCalled();
  });

  it('melhor resultado: nome exato vence parcial, mesmo de entidade de menor peso', async () => {
    repo.artists.mockResolvedValue([{ id: 'ar1', name: 'Matuê Show' }]);
    repo.tracks.mockResolvedValue([{ id: 't1', title: 'Matuê' }]);
    const r = await searchService.search(input('matuê'));
    expect(r.topResult).toEqual({ type: 'track', id: 't1' });
  });

  it('empate de nome: artista antes de faixa', async () => {
    repo.artists.mockResolvedValue([{ id: 'ar1', name: 'Djavan' }]);
    repo.tracks.mockResolvedValue([{ id: 't1', title: 'Djavan' }]);
    const r = await searchService.search(input('DJAVAN'));
    expect(r.topResult).toEqual({ type: 'artist', id: 'ar1' });
  });

  it('sem resultado: topResult nulo', async () => {
    const r = await searchService.search(input('nada'));
    expect(r.topResult).toBeNull();
  });

  it('título raso completa com faixas do artista, sem repetir e respeitando o limite', async () => {
    repo.tracks.mockResolvedValue([{ id: 't1', title: 'x' }]);
    repo.tracksByArtist.mockResolvedValue([
      { id: 't1', title: 'x' },
      { id: 't2', title: 'y' },
    ]);
    const r = await searchService.search(input('x', { limit: '3' }));
    expect(r.tracks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(repo.tracksByArtist.mock.calls[0]?.[1]).toBe(2);
  });

  it('curtida de um usuário não vaza pelo cache para outro', async () => {
    repo.tracks.mockResolvedValue([
      { id: 't1', title: 'abc' },
      { id: 't2', title: 'abc2' },
      { id: 't3', title: 'abc3' },
    ]);
    liked.mockResolvedValueOnce(new Set(['t1']));
    const a = await searchService.search(input('abc'), 'user-a');
    expect(a.tracks.find((t) => t.id === 't1')).toMatchObject({ isLiked: true });
    // 2ª chamada vem do cache e sem usuário: sem flag nenhuma.
    const anonimo = await searchService.search(input('abc'));
    expect(anonimo.tracks.some((t) => 'isLiked' in t && (t as { isLiked?: boolean }).isLiked)).toBe(
      false,
    );
    expect(repo.tracks).toHaveBeenCalledTimes(1);
  });

  it('consultas que só diferem na caixa compartilham cache e devolvem a mesma lista', async () => {
    repo.tracks.mockResolvedValue([{ id: 't1', title: 'Abc' }]);
    await searchService.search(input('Abc'));
    const r = await searchService.search(input('aBC'));
    expect(repo.tracks).toHaveBeenCalledTimes(1);
    expect(r.tracks).toHaveLength(1);
  });
});

describe('searchService.suggest', () => {
  it('limita a 8 sugestões, artistas primeiro', async () => {
    repo.artistPrefix.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, imageUrl: null })),
    );
    repo.trackPrefix.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, coverUrl: null })),
    );
    repo.albumPrefix.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({ id: `l${i}`, title: `L${i}`, coverUrl: null })),
    );
    const r = await searchService.suggest('a');
    expect(r).toHaveLength(8);
    expect(r[0]?.type).toBe('artist');
  });
});
