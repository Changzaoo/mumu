import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ track: { findFirst: vi.fn(), findMany: vi.fn() } }));
vi.mock('../../infra/db/prisma.js', () => ({ prisma: banco }));

const { socialRepository } = await import('./social.repository.js');

describe('socialRepository.trackExists', () => {
  beforeEach(() => vi.clearAllMocks());

  it('só enxerga faixa pública ou enviada pelo próprio usuário', async () => {
    banco.track.findFirst.mockResolvedValue(null);
    expect(await socialRepository.trackExists('t1', 'u1')).toBe(false);
    expect(banco.track.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', OR: [{ isPublic: true }, { uploadedByUserId: 'u1' }] },
      }),
    );
  });
});
