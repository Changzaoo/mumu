import { prisma } from '../../infra/db/prisma.js';
import { trackInclude, type TrackRow } from '../shared/mappers.js';

export const tracksRepository = {
  findById(id: string): Promise<TrackRow | null> {
    return prisma.track.findUnique({ where: { id }, include: trackInclude });
  },

  waveform(id: string): Promise<{ id: string; waveform: unknown } | null> {
    return prisma.track.findUnique({ where: { id }, select: { id: true, waveform: true } });
  },

  lyrics(trackId: string) {
    return prisma.lyrics.findUnique({ where: { trackId } });
  },
};
