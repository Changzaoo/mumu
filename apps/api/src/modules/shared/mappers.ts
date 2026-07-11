import type { Prisma } from '@prisma/client';
import type {
  AlbumDto,
  AlbumWithTracksDto,
  ArtistDto,
  AuditLogDto,
  CommentDto,
  EpisodeDto,
  ImportJobDto,
  ImportProvider,
  ListenSessionDto,
  MeDto,
  PlaylistDto,
  PlaylistTrackDto,
  PlaylistWithTracksDto,
  PodcastDto,
  RadioStationDto,
  TrackDto,
  UploadDto,
  UploadStatus,
  UserDto,
  UserRole,
} from '@aurial/shared';
import { env } from '../../config/index.js';
import { signStreamToken } from '../stream/streamToken.js';

// ─────────────────────────── include shapes ───────────────────────────
// Single source of truth for the Prisma `include`s each mapper expects.

export const trackInclude = {
  album: { select: { id: true, title: true, slug: true, coverUrl: true } },
  artists: {
    include: { artist: { select: { id: true, name: true, slug: true, imageUrl: true } } },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.TrackInclude;
export type TrackRow = Prisma.TrackGetPayload<{ include: typeof trackInclude }>;

export const artistInclude = {
  genres: { include: { genre: { select: { name: true } } } },
  _count: { select: { followers: true } },
} satisfies Prisma.ArtistInclude;
export type ArtistRow = Prisma.ArtistGetPayload<{ include: typeof artistInclude }>;

export const albumInclude = {
  artists: {
    include: { artist: { select: { id: true, name: true, slug: true, imageUrl: true } } },
    orderBy: { order: 'asc' },
  },
  genres: { include: { genre: { select: { name: true } } } },
  tracks: { select: { durationMs: true } },
} satisfies Prisma.AlbumInclude;
export type AlbumRow = Prisma.AlbumGetPayload<{ include: typeof albumInclude }>;

export const playlistInclude = {
  owner: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
  tracks: { select: { track: { select: { durationMs: true } } } },
  _count: { select: { followers: true } },
} satisfies Prisma.PlaylistInclude;
export type PlaylistRow = Prisma.PlaylistGetPayload<{ include: typeof playlistInclude }>;

export const userInclude = {
  _count: { select: { followers: true, following: true } },
} satisfies Prisma.UserInclude;
export type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export const podcastInclude = {
  _count: { select: { episodes: true } },
} satisfies Prisma.PodcastInclude;
export type PodcastRow = Prisma.PodcastGetPayload<{ include: typeof podcastInclude }>;

export const commentInclude = {
  user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
  _count: { select: { likes: true } },
} satisfies Prisma.CommentInclude;
export type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

export const listenSessionInclude = {
  members: {
    include: { user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } },
  },
} satisfies Prisma.ListenSessionInclude;
export type ListenSessionRow = Prisma.ListenSessionGetPayload<{
  include: typeof listenSessionInclude;
}>;

// ─────────────────────────── helpers ───────────────────────────

export interface TrackMapOptions {
  /** Track ids liked by the requesting user; omit to leave isLiked undefined. */
  likedSet?: Set<string>;
}

/** Signed, directly playable HLS manifest URL. */
export function streamUrlFor(trackId: string): string {
  return `${env.API_BASE_URL}/api/v1/stream/${trackId}/manifest.m3u8?token=${signStreamToken(trackId)}`;
}

/** Single-file download URL (auth-fetched) for offline caching. */
export function downloadUrlFor(trackId: string): string {
  return `${env.API_BASE_URL}/api/v1/tracks/${trackId}/download`;
}

const sumDurations = (rows: Array<{ durationMs: number }>): number =>
  rows.reduce((acc, r) => acc + r.durationMs, 0);

// ─────────────────────────── mappers ───────────────────────────

export function toTrackDto(row: TrackRow, opts: TrackMapOptions = {}): TrackDto {
  return {
    id: row.id,
    title: row.title,
    durationMs: row.durationMs,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    explicit: row.explicit,
    playsCount: row.playsCount,
    coverUrl: row.coverUrl ?? row.album?.coverUrl ?? null,
    dominantColor: row.dominantColor,
    loudnessLufs: row.loudnessLufs,
    ...(opts.likedSet !== undefined ? { isLiked: opts.likedSet.has(row.id) } : {}),
    album: row.album,
    artists: row.artists.map((ta) => ta.artist),
    streamUrl: row.hlsKey !== null && row.hlsKey !== '' ? streamUrlFor(row.id) : null,
    // Offline download needs a single-file source (the kept original).
    downloadUrl: row.originalKey !== null && row.originalKey !== '' ? downloadUrlFor(row.id) : null,
    uploadedByUserId: row.uploadedByUserId,
  };
}

export function toArtistDto(row: ArtistRow): ArtistDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.imageUrl,
    bannerUrl: row.bannerUrl,
    bio: row.bio,
    verified: row.verified,
    monthlyListeners: row.monthlyListeners,
    followersCount: row._count.followers,
    genres: row.genres.map((g) => g.genre.name),
  };
}

export function toAlbumDto(row: AlbumRow): AlbumDto {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    type: row.type,
    coverUrl: row.coverUrl,
    dominantColor: row.dominantColor,
    releaseDate: row.releaseDate?.toISOString() ?? null,
    trackCount: row.tracks.length,
    durationMs: sumDurations(row.tracks),
    artists: row.artists.map((aa) => aa.artist),
    genres: row.genres.map((g) => g.genre.name),
  };
}

export function toAlbumWithTracksDto(
  row: AlbumRow,
  trackRows: TrackRow[],
  opts: TrackMapOptions = {},
): AlbumWithTracksDto {
  return { ...toAlbumDto(row), tracks: trackRows.map((t) => toTrackDto(t, opts)) };
}

export function toPlaylistDto(row: PlaylistRow): PlaylistDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: row.coverUrl,
    dominantColor: row.dominantColor,
    isPublic: row.isPublic,
    isCollaborative: row.isCollaborative,
    trackCount: row.tracks.length,
    durationMs: sumDurations(row.tracks.map((t) => t.track)),
    followersCount: row._count.followers,
    owner: row.owner,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PlaylistEntryRow {
  id: string;
  position: number;
  addedAt: Date;
  addedBy: { id: string; handle: string; displayName: string } | null;
  track: TrackRow;
}

export function toPlaylistTrackDto(
  entry: PlaylistEntryRow,
  opts: TrackMapOptions = {},
): PlaylistTrackDto {
  return {
    entryId: entry.id,
    position: entry.position,
    addedAt: entry.addedAt.toISOString(),
    addedBy: entry.addedBy,
    track: toTrackDto(entry.track, opts),
  };
}

export function toPlaylistWithTracksDto(
  row: PlaylistRow,
  entries: PlaylistEntryRow[],
  opts: TrackMapOptions = {},
): PlaylistWithTracksDto {
  return { ...toPlaylistDto(row), tracks: entries.map((e) => toPlaylistTrackDto(e, opts)) };
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    bio: row.bio,
    role: row.role as UserRole,
    isPremium: row.isPremium,
    followersCount: row._count.followers,
    followingCount: row._count.following,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMeDto(row: UserRow): MeDto {
  return {
    ...toUserDto(row),
    email: row.email,
    // Json columns validated on write (updateMeSchema) — safe to narrow here.
    socialLinks: (row.socialLinks as Record<string, string> | null) ?? null,
    settings: (row.settings as MeDto['settings']) ?? null,
  };
}

export function toPodcastDto(row: PodcastRow): PodcastDto {
  return {
    id: row.id,
    title: row.title,
    publisher: row.publisher,
    coverUrl: row.coverUrl,
    description: row.description,
    episodeCount: row._count.episodes,
  };
}

export function toEpisodeDto(row: {
  id: string;
  podcastId: string;
  title: string;
  description: string | null;
  durationMs: number;
  audioUrl: string;
  coverUrl: string | null;
  publishedAt: Date;
}): EpisodeDto {
  return {
    id: row.id,
    podcastId: row.podcastId,
    title: row.title,
    description: row.description,
    durationMs: row.durationMs,
    publishedAt: row.publishedAt.toISOString(),
    streamUrl: row.audioUrl,
    coverUrl: row.coverUrl,
  };
}

export function toRadioDto(row: {
  id: string;
  name: string;
  streamUrl: string;
  imageUrl: string | null;
  genre: string | null;
  country: string | null;
  isLive: boolean;
}): RadioStationDto {
  return {
    id: row.id,
    name: row.name,
    streamUrl: row.streamUrl,
    imageUrl: row.imageUrl,
    genre: row.genre,
    country: row.country,
    isLive: row.isLive,
  };
}

export function toUploadDto(
  row: {
    id: string;
    fileName: string;
    sizeBytes: bigint;
    status: string;
    error: string | null;
    trackId: string | null;
    createdAt: Date;
  },
  progress: number,
): UploadDto {
  return {
    id: row.id,
    fileName: row.fileName,
    // BigInt → Number: fine below 2^53 (files are capped at 500 MB).
    sizeBytes: Number(row.sizeBytes),
    status: row.status as UploadStatus,
    progress,
    error: row.error,
    trackId: row.trackId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toImportJobDto(row: {
  id: string;
  provider: string;
  status: string;
  totalFiles: number;
  importedFiles: number;
  error: string | null;
  createdAt: Date;
}): ImportJobDto {
  return {
    id: row.id,
    provider: row.provider as ImportProvider,
    status: row.status as ImportJobDto['status'],
    totalFiles: row.totalFiles,
    importedFiles: row.importedFiles,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCommentDto(row: CommentRow, opts: { likedSet?: Set<string> } = {}): CommentDto {
  return {
    id: row.id,
    body: row.body,
    user: row.user,
    createdAt: row.createdAt.toISOString(),
    likesCount: row._count.likes,
    ...(opts.likedSet !== undefined ? { isLiked: opts.likedSet.has(row.id) } : {}),
  };
}

export function toListenSessionDto(
  row: ListenSessionRow,
  currentTrack: TrackDto | null,
): ListenSessionDto {
  return {
    id: row.id,
    hostUserId: row.hostUserId,
    participants: row.members.map((m) => m.user),
    currentTrack,
    positionMs: row.positionMs,
    isPlaying: row.isPlaying,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAuditLogDto(row: {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Overlays personal like flags onto (possibly cached) track DTOs. */
export function applyLikedFlags(tracks: TrackDto[], likedSet: Set<string>): TrackDto[] {
  return tracks.map((t) => ({ ...t, isLiked: likedSet.has(t.id) }));
}
