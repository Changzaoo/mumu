import type { MeDto, PlaylistDto, UpdateMeInput, UserDto, UserStatsDto } from '@aurial/shared';
import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { eventBus } from '../../core/events/eventBus.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { toMeDto, toPlaylistDto, toUserDto } from '../shared/mappers.js';
import { usersRepository } from './users.repository.js';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

export const usersService = {
  async getMe(userId: string): Promise<MeDto> {
    const user = await usersRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toMeDto(user);
  },

  async updateMe(userId: string, input: UpdateMeInput): Promise<MeDto> {
    const data: Prisma.UserUpdateInput = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.handle !== undefined ? { handle: input.handle } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
      ...(input.socialLinks !== undefined ? { socialLinks: input.socialLinks } : {}),
      // Validated by updateMeSchema; cast because typed partials with optional
      // keys don't structurally satisfy Prisma.InputJsonObject.
      ...(input.settings !== undefined
        ? { settings: input.settings as Prisma.InputJsonValue }
        : {}),
    };
    try {
      return toMeDto(await usersRepository.update(userId, data));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Handle is already taken');
      throw err;
    }
  },

  async getUser(id: string, viewerId?: string): Promise<UserDto> {
    const user = await usersRepository.findById(id);
    if (!user) throw new NotFoundError('User');
    const dto = toUserDto(user);
    if (!viewerId || viewerId === id) return dto;
    return { ...dto, isFollowing: await usersRepository.isFollowedBy(viewerId, id) };
  },

  async getUserPlaylists(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<PlaylistDto>> {
    const user = await usersRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    const rows = await usersRepository.publicPlaylists(userId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toPlaylistDto), meta: page.meta };
  },

  async follow(followerId: string, followeeId: string): Promise<void> {
    if (followerId === followeeId) throw new ValidationError('Cannot follow yourself');
    const followee = await usersRepository.findById(followeeId);
    if (!followee) throw new NotFoundError('User');
    await usersRepository.follow(followerId, followeeId);
    eventBus.emit('user.followed', { followerId, followeeId, followeeName: followee.displayName });
  },

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await usersRepository.unfollow(followerId, followeeId);
  },

  async getStats(userId: string): Promise<UserStatsDto> {
    const [agg, topPlays, badgeRows] = await Promise.all([
      usersRepository.listeningAggregate(userId),
      usersRepository.topPlayedTrackIds(userId, 50),
      usersRepository.badges(userId),
    ]);

    const playsByTrack = new Map(topPlays.map((t) => [t.trackId, t.plays]));
    const tracks = await usersRepository.tracksWithRelations(topPlays.map((t) => t.trackId));

    const artistPlays = new Map<
      string,
      { id: string; name: string; imageUrl: string | null; plays: number }
    >();
    const genrePlays = new Map<string, number>();
    for (const track of tracks) {
      const plays = playsByTrack.get(track.id) ?? 0;
      for (const ta of track.artists) {
        const entry = artistPlays.get(ta.artist.id);
        if (entry) entry.plays += plays;
        else artistPlays.set(ta.artist.id, { ...ta.artist, plays });
      }
      for (const tg of track.genres) {
        genrePlays.set(tg.genre.name, (genrePlays.get(tg.genre.name) ?? 0) + plays);
      }
    }

    const topTracks = topPlays
      .slice(0, 10)
      .map(({ trackId, plays }) => {
        const t = tracks.find((x) => x.id === trackId);
        return t ? { id: t.id, title: t.title, coverUrl: t.coverUrl, plays } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    return {
      totalListeningMs: agg._sum.playedMs ?? 0,
      tracksPlayed: agg._count,
      topGenres: [...genrePlays.entries()]
        .map(([genre, count]) => ({ genre, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      topArtists: [...artistPlays.values()].sort((a, b) => b.plays - a.plays).slice(0, 5),
      topTracks,
      badges: badgeRows.map((b) => ({
        id: b.badge.id,
        name: b.badge.name,
        icon: b.badge.icon,
        earnedAt: b.earnedAt.toISOString(),
      })),
    };
  },
};
