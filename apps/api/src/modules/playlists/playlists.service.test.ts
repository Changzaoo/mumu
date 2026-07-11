import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';

vi.mock('./playlists.repository.js', () => ({
  playlistsRepository: {
    findAccess: vi.fn(),
    findById: vi.fn(),
    entries: vi.fn(),
    entryIdsOrdered: vi.fn(),
    replacePositions: vi.fn(),
    usersByIds: vi.fn(),
  },
}));
vi.mock('../library/library.repository.js', () => ({
  libraryRepository: { likedTrackIdSet: vi.fn() },
}));

const { playlistsRepository } = await import('./playlists.repository.js');
const { libraryRepository } = await import('../library/library.repository.js');
const { computeReorderedIds, playlistsService } = await import('./playlists.service.js');

const repo = vi.mocked(playlistsRepository);
const library = vi.mocked(libraryRepository);

describe('computeReorderedIds (pure)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('moves an entry forward', () => {
    expect(computeReorderedIds(ids, 'b', 3)).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('moves an entry backward', () => {
    expect(computeReorderedIds(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('clamps out-of-range target positions', () => {
    expect(computeReorderedIds(ids, 'a', 999)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(computeReorderedIds(ids, 'e', -5)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('is a no-op when moving to the same position', () => {
    expect(computeReorderedIds(ids, 'c', 2)).toEqual(ids);
  });

  it('throws NotFoundError for unknown entries', () => {
    expect(() => computeReorderedIds(ids, 'zz', 1)).toThrow(NotFoundError);
  });
});

describe('playlistsService.reorder', () => {
  const access = {
    id: 'pl1',
    ownerId: 'user-1',
    isPublic: true,
    isCollaborative: false,
    collaboratorIds: [] as string[],
  };
  const playlistRow = {
    id: 'pl1',
    title: 'Mix',
    description: null,
    coverUrl: null,
    dominantColor: null,
    isPublic: true,
    isCollaborative: false,
    ownerId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    owner: { id: 'user-1', handle: 'u1', displayName: 'User One', avatarUrl: null },
    tracks: [],
    _count: { followers: 0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repo.findAccess.mockResolvedValue(access);
    repo.entryIdsOrdered.mockResolvedValue(['e1', 'e2', 'e3']);
    repo.replacePositions.mockResolvedValue(undefined);
    repo.findById.mockResolvedValue(playlistRow as never);
    repo.entries.mockResolvedValue([]);
    repo.usersByIds.mockResolvedValue([]);
    library.likedTrackIdSet.mockResolvedValue(new Set());
  });

  it('persists the recomputed order for the owner', async () => {
    const result = await playlistsService.reorder('pl1', 'user-1', {
      entryId: 'e3',
      toPosition: 0,
    });
    expect(repo.replacePositions).toHaveBeenCalledWith('pl1', ['e3', 'e1', 'e2']);
    expect(result.id).toBe('pl1');
    expect(result.tracks).toEqual([]);
  });

  it('lets collaborators reorder collaborative playlists', async () => {
    repo.findAccess.mockResolvedValue({
      ...access,
      isCollaborative: true,
      collaboratorIds: ['user-2'],
    });
    await playlistsService.reorder('pl1', 'user-2', { entryId: 'e1', toPosition: 2 });
    expect(repo.replacePositions).toHaveBeenCalledWith('pl1', ['e2', 'e3', 'e1']);
  });

  it('rejects strangers', async () => {
    await expect(
      playlistsService.reorder('pl1', 'someone-else', { entryId: 'e1', toPosition: 1 }),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.replacePositions).not.toHaveBeenCalled();
  });

  it('404s on a missing playlist', async () => {
    repo.findAccess.mockResolvedValue(null);
    await expect(
      playlistsService.reorder('nope', 'user-1', { entryId: 'e1', toPosition: 1 }),
    ).rejects.toThrow(NotFoundError);
  });
});
