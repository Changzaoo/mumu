import type { Episode } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import { podcastInclude, type PodcastRow } from '../shared/mappers.js';

export const podcastsRepository = {
  list(cursor: string | undefined, limit: number): Promise<PodcastRow[]> {
    return prisma.podcast.findMany({
      where: cursorWhere(cursor),
      include: podcastInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  findById(id: string): Promise<PodcastRow | null> {
    return prisma.podcast.findUnique({ where: { id }, include: podcastInclude });
  },

  episodes(podcastId: string, cursor: string | undefined, limit: number): Promise<Episode[]> {
    return prisma.episode.findMany({
      where: { AND: [{ podcastId }, cursorWhere(cursor, 'publishedAt') ?? {}] },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },
};
