import { eventBus } from '../../core/events/eventBus.js';
import { logger } from '../../core/logger.js';
import { socialRepository } from './social.repository.js';

let registered = false;

/**
 * Projects domain events into FeedEvent rows (ARCHITECTURE: feed is built
 * from events emitted by services). Registered once at app bootstrap.
 */
export function registerFeedProjection(): void {
  if (registered) return;
  registered = true;

  const write = (data: Parameters<typeof socialRepository.createFeedEvent>[0]): void => {
    socialRepository
      .createFeedEvent(data)
      .catch((err) => logger.warn({ err }, 'feed projection failed'));
  };

  eventBus.on('track.liked', (e) =>
    write({
      actorId: e.userId,
      type: 'LIKED_TRACK',
      trackId: e.trackId,
      targetTitle: e.trackTitle,
    }),
  );
  eventBus.on('playlist.created', (e) =>
    write({
      actorId: e.userId,
      type: 'CREATED_PLAYLIST',
      targetId: e.playlistId,
      targetTitle: e.title,
    }),
  );
  eventBus.on('artist.followed', (e) =>
    write({
      actorId: e.userId,
      type: 'FOLLOWED_ARTIST',
      targetId: e.artistId,
      targetTitle: e.artistName,
    }),
  );
  eventBus.on('user.followed', (e) =>
    write({
      actorId: e.followerId,
      type: 'FOLLOWED_USER',
      targetId: e.followeeId,
      targetTitle: e.followeeName,
    }),
  );
  // Only completed plays hit the feed — skipping avoids feed spam.
  eventBus.on('play.recorded', (e) => {
    if (e.completed) {
      write({
        actorId: e.userId,
        type: 'PLAYED_TRACK',
        trackId: e.trackId,
        targetTitle: e.trackTitle,
      });
    }
  });
}
