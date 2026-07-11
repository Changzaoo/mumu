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

  downloadSource(id: string): Promise<{ id: string; title: string; originalKey: string | null } | null> {
    return prisma.track.findUnique({
      where: { id },
      select: { id: true, title: true, originalKey: true },
    });
  },

  recordDownload(userId: string, trackId: string, quality: string): Promise<{ id: string }> {
    return prisma.download.upsert({
      where: { userId_trackId: { userId, trackId } },
      update: { quality },
      create: { userId, trackId, quality },
      select: { id: true },
    });
  },
};
