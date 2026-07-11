import type { LibraryDto, TrackDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { eventBus } from '../../core/events/eventBus.js';
import { encodeCursor, type CursorPage } from '../../core/http/pagination.js';
import { toAlbumDto, toArtistDto, toPlaylistDto, toTrackDto } from '../shared/mappers.js';
import { artistsRepository } from '../artists/artists.repository.js';
import { libraryRepository } from './library.repository.js';

const LIBRARY_SECTION_LIMIT = 50;

export const libraryService = {
  async getLibrary(userId: string): Promise<LibraryDto> {
    const [playlists, albums, artists, likedTracksCount] = await Promise.all([
      libraryRepository.playlists(userId, LIBRARY_SECTION_LIMIT),
      libraryRepository.likedAlbums(userId, LIBRARY_SECTION_LIMIT),
      libraryRepository.followedArtists(userId, LIBRARY_SECTION_LIMIT),
      libraryRepository.likedTracksCount(userId),
    ]);
    return {
      playlists: playlists.map(toPlaylistDto),
      likedTracksCount,
      albums: albums.map(toAlbumDto),
      artists: artists.map(toArtistDto),
    };
  },

  async likedTracks(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<TrackDto>> {
    const rows = await libraryRepository.likedTracks(userId, cursor, limit);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    return {
      items: items.map((r) => ({ ...toTrackDto(r.track), isLiked: true })),
      meta: {
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor({ date: last.createdAt, id: last.track.id })
            : null,
        hasMore,
      },
    };
  },

  async likeTrack(userId: string, trackId: string): Promise<void> {
    const track = await libraryRepository.trackTitle(trackId);
    if (!track) throw new NotFoundError('Track');
    await libraryRepository.likeTrack(userId, trackId);
    eventBus.emit('track.liked', { userId, trackId, trackTitle: track.title });
  },

  async unlikeTrack(userId: string, trackId: string): Promise<void> {
    await libraryRepository.unlikeTrack(userId, trackId);
  },

  async likeAlbum(userId: string, albumId: string): Promise<void> {
    const exists = await libraryRepository.albumExists(albumId);
    if (!exists) throw new NotFoundError('Album');
    await libraryRepository.likeAlbum(userId, albumId);
  },

  async unlikeAlbum(userId: string, albumId: string): Promise<void> {
    await libraryRepository.unlikeAlbum(userId, albumId);
  },

  /** Library "follow artist" mirrors the artists module follow (same rows). */
  async followArtist(userId: string, artistId: string): Promise<void> {
    const artist = await artistsRepository.findById(artistId);
    if (!artist) throw new NotFoundError('Artist');
    await artistsRepository.follow(userId, artistId);
    eventBus.emit('artist.followed', { userId, artistId, artistName: artist.name });
  },

  async unfollowArtist(userId: string, artistId: string): Promise<void> {
    await artistsRepository.unfollow(userId, artistId);
  },
};
