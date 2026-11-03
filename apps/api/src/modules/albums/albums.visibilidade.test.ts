import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ track: { findMany: vi.fn() } }));
vi.mock('../../infra/db/prisma.js', () => ({ prisma: banco }));

const { albumsRepository } = await import('./albums.repository.js');

describe('albumsRepository.tracksOf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve só faixas públicas e com teto de 200 (o resultado é cacheado para todos)', async () => {
    banco.track.findMany.mockResolvedValue([]);
    await albumsRepository.tracksOf('a1');
    expect(banco.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { albumId: 'a1', isPublic: true }, take: 200 }),
    );
  });
});
