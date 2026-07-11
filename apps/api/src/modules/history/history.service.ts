import type { ContinueListeningDto, HistoryEntryDto, RecordPlayInput } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { eventBus } from '../../core/events/eventBus.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { cache, cacheKeys } from '../../infra/redis/cache.js';
import { toTrackDto } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { historyRepository, type HistoryRow } from './history.repository.js';

async function contextOf(row: HistoryRow): Promise<{ title: string | null; url: string | null }> {
  if (!row.sourceId) return { title: null, url: null };
  if (row.source === 'album') {
    const album = await historyRepository.albumTitle(row.sourceId);
    return { title: album?.title ?? null, url: album ? `/album/${row.sourceId}` : null };
  }
  if (row.source === 'playlist') {
    const playlist = await historyRepository.playlistTitle(row.sourceId);
    return { title: playlist?.title ?? null, url: playlist ? `/playlist/${row.sourceId}` : null };
  }
  return { title: null, url: null };
}

function toHistoryEntry(row: HistoryRow, likedSet?: Set<string>): HistoryEntryDto {
  return {
    id: row.id,
    playedAt: row.playedAt.toISOString(),
    playedMs: row.playedMs,
    source: row.source,
    track: toTrackDto(row.track, { likedSet }),
  };
}

export const historyService = {
  async record(userId: string, input: RecordPlayInput): Promise<{ id: string }> {
    const track = await historyRepository.trackTitle(input.trackId);
    if (!track) throw new NotFoundError('Track');
    const row = await historyRepository.record({
      userId,
      trackId: input.trackId,
      playedMs: input.playedMs,
      // Resume point only matters for unfinished long content.
      positionMs: input.completed ? null : input.playedMs,
      completed: input.completed,
      source: input.source,
      sourceId: input.sourceId ?? null,
    });
    // Lazy home invalidation (ARCHITECTURE §7).
    await cache.del(cacheKeys.home(userId));
    eventBus.emit('play.recorded', {
      userId,
      trackId: input.trackId,
      trackTitle: track.title,
      completed: input.completed,
    });
    return { id: row.id };
  },

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<HistoryEntryDto>> {
    const rows = await historyRepository.list(userId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.playedAt, id: r.id }));
    const likedSet = await libraryRepository.likedTrackIdSet(
      userId,
      page.items.map((r) => r.track.id),
    );
    return { items: page.items.map((r) => toHistoryEntry(r, likedSet)), meta: page.meta };
  },

  async clear(userId: string): Promise<{ deleted: number }> {
    const deleted = await historyRepository.clear(userId);
    await cache.del(cacheKeys.home(userId));
    return { deleted };
  },

  /** "Continue listening": most recent resume point per track. */
  async recent(userId: string, limit: number): Promise<ContinueListeningDto[]> {
    const rows = await historyRepository.resumable(userId, limit);
    const seen = new Set<string>();
    const unique: HistoryRow[] = [];
    for (const row of rows) {
      if (seen.has(row.track.id)) continue;
      seen.add(row.track.id);
      unique.push(row);
      if (unique.length >= limit) break;
    }
    const likedSet = await libraryRepository.likedTrackIdSet(
      userId,
      unique.map((r) => r.track.id),
    );
    return Promise.all(
      unique.map(async (row) => {
        const context = await contextOf(row);
        return {
          track: toTrackDto(row.track, { likedSet }),
          positionMs: row.positionMs ?? 0,
          contextTitle: context.title,
          contextUrl: context.url,
        };
      }),
    );
  },
};
