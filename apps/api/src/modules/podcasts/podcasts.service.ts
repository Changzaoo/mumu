import type { EpisodeDto, PodcastDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { toEpisodeDto, toPodcastDto } from '../shared/mappers.js';
import { podcastsRepository } from './podcasts.repository.js';

export const podcastsService = {
  async list(cursor: string | undefined, limit: number): Promise<CursorPage<PodcastDto>> {
    const rows = await podcastsRepository.list(cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toPodcastDto), meta: page.meta };
  },

  async getById(id: string): Promise<PodcastDto> {
    const row = await podcastsRepository.findById(id);
    if (!row) throw new NotFoundError('Podcast');
    return toPodcastDto(row);
  },

  async episodes(
    podcastId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<EpisodeDto>> {
    const podcast = await podcastsRepository.findById(podcastId);
    if (!podcast) throw new NotFoundError('Podcast');
    const rows = await podcastsRepository.episodes(podcastId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.publishedAt, id: r.id }));
    return { items: page.items.map(toEpisodeDto), meta: page.meta };
  },
};
