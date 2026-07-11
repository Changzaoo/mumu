import type {
  AddPlaylistTracksInput,
  CreatePlaylistInput,
  PlaylistDto,
  PlaylistWithTracksDto,
  ReorderPlaylistInput,
  UpdatePlaylistInput,
} from '@aurial/shared';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { eventBus } from '../../core/events/eventBus.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import {
  toPlaylistDto,
  toPlaylistWithTracksDto,
  type PlaylistEntryRow,
} from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { playlistsRepository, type PlaylistAccessRecord } from './playlists.repository.js';

/**
 * Pure reorder computation — exported for unit tests.
 * Moves `entryId` to `toPosition` (clamped) and returns the new id order.
 */
export function computeReorderedIds(
  orderedIds: string[],
  entryId: string,
  toPosition: number,
): string[] {
  const from = orderedIds.indexOf(entryId);
  if (from === -1) throw new NotFoundError('Playlist entry');
  const target = Math.max(0, Math.min(toPosition, orderedIds.length - 1));
  const next = [...orderedIds];
  next.splice(from, 1);
  next.splice(target, 0, entryId);
  return next;
}

function canRead(access: PlaylistAccessRecord, userId?: string): boolean {
  if (access.isPublic) return true;
  if (!userId) return false;
  return access.ownerId === userId || access.collaboratorIds.includes(userId);
}

function canEditTracks(access: PlaylistAccessRecord, userId: string): boolean {
  if (access.ownerId === userId) return true;
  return access.isCollaborative && access.collaboratorIds.includes(userId);
}

async function requireAccess(playlistId: string): Promise<PlaylistAccessRecord> {
  const access = await playlistsRepository.findAccess(playlistId);
  if (!access) throw new NotFoundError('Playlist');
  return access;
}

async function buildWithTracks(
  playlistId: string,
  userId?: string,
): Promise<PlaylistWithTracksDto> {
  const row = await playlistsRepository.findById(playlistId);
  if (!row) throw new NotFoundError('Playlist');
  const entries = await playlistsRepository.entries(playlistId);

  const adderIds = [
    ...new Set(entries.map((e) => e.addedById).filter((v): v is string => v !== null)),
  ];
  const adders = adderIds.length > 0 ? await playlistsRepository.usersByIds(adderIds) : [];
  const adderById = new Map(adders.map((u) => [u.id, u]));

  const likedSet = userId
    ? await libraryRepository.likedTrackIdSet(
        userId,
        entries.map((e) => e.track.id),
      )
    : undefined;

  const entryRows: PlaylistEntryRow[] = entries.map((e) => ({
    id: e.id,
    position: e.position,
    addedAt: e.addedAt,
    addedBy: e.addedById !== null ? (adderById.get(e.addedById) ?? null) : null,
    track: e.track,
  }));

  return toPlaylistWithTracksDto(row, entryRows, { likedSet });
}

export const playlistsService = {
  async listMine(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<PlaylistDto>> {
    const rows = await playlistsRepository.listForUser(userId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toPlaylistDto), meta: page.meta };
  },

  async create(userId: string, input: CreatePlaylistInput): Promise<PlaylistDto> {
    const row = await playlistsRepository.create(userId, {
      title: input.title,
      description: input.description ?? null,
      isPublic: input.isPublic,
      isCollaborative: input.isCollaborative,
    });
    eventBus.emit('playlist.created', { userId, playlistId: row.id, title: row.title });
    return toPlaylistDto(row);
  },

  async getById(playlistId: string, userId?: string): Promise<PlaylistWithTracksDto> {
    const access = await requireAccess(playlistId);
    if (!canRead(access, userId)) throw new NotFoundError('Playlist');
    return buildWithTracks(playlistId, userId);
  },

  async update(
    playlistId: string,
    userId: string,
    input: UpdatePlaylistInput,
  ): Promise<PlaylistDto> {
    const access = await requireAccess(playlistId);
    if (access.ownerId !== userId) throw new ForbiddenError('Only the owner can edit a playlist');
    const row = await playlistsRepository.update(playlistId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.isCollaborative !== undefined ? { isCollaborative: input.isCollaborative } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
    });
    return toPlaylistDto(row);
  },

  async delete(playlistId: string, userId: string): Promise<void> {
    const access = await requireAccess(playlistId);
    if (access.ownerId !== userId) throw new ForbiddenError('Only the owner can delete a playlist');
    await playlistsRepository.delete(playlistId);
  },

  async addTracks(
    playlistId: string,
    userId: string,
    input: AddPlaylistTracksInput,
  ): Promise<PlaylistWithTracksDto> {
    const access = await requireAccess(playlistId);
    if (!canEditTracks(access, userId))
      throw new ForbiddenError('No permission to edit playlist tracks');
    const existing = await playlistsRepository.countExistingTracks(input.trackIds);
    if (existing !== new Set(input.trackIds).size) throw new NotFoundError('Track');
    await playlistsRepository.insertTracks(playlistId, input.trackIds, input.position, userId);
    return buildWithTracks(playlistId, userId);
  },

  async removeTracks(
    playlistId: string,
    userId: string,
    entryIds: string[],
  ): Promise<PlaylistWithTracksDto> {
    const access = await requireAccess(playlistId);
    if (!canEditTracks(access, userId))
      throw new ForbiddenError('No permission to edit playlist tracks');
    await playlistsRepository.removeEntries(playlistId, entryIds);
    return buildWithTracks(playlistId, userId);
  },

  async reorder(
    playlistId: string,
    userId: string,
    input: ReorderPlaylistInput,
  ): Promise<PlaylistWithTracksDto> {
    const access = await requireAccess(playlistId);
    if (!canEditTracks(access, userId))
      throw new ForbiddenError('No permission to edit playlist tracks');
    const orderedIds = await playlistsRepository.entryIdsOrdered(playlistId);
    const nextOrder = computeReorderedIds(orderedIds, input.entryId, input.toPosition);
    await playlistsRepository.replacePositions(playlistId, nextOrder);
    return buildWithTracks(playlistId, userId);
  },

  async addCollaborator(
    playlistId: string,
    ownerId: string,
    collaboratorId: string,
  ): Promise<void> {
    const access = await requireAccess(playlistId);
    if (access.ownerId !== ownerId)
      throw new ForbiddenError('Only the owner can add collaborators');
    if (collaboratorId === ownerId) throw new ValidationError('Owner is already a collaborator');
    const exists = await playlistsRepository.userExists(collaboratorId);
    if (!exists) throw new NotFoundError('User');
    await playlistsRepository.addCollaborator(playlistId, collaboratorId);
  },
};
