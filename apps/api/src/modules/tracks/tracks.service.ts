import type { LyricsDto, TrackDto, WaveformDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { toTrackDto } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { tracksRepository } from './tracks.repository.js';

export const tracksService = {
  async getById(id: string, userId?: string): Promise<TrackDto> {
    const row = await tracksRepository.findById(id);
    if (!row) throw new NotFoundError('Track');
    const likedSet = userId ? await libraryRepository.likedTrackIdSet(userId, [id]) : undefined;
    return toTrackDto(row, { likedSet });
  },

  async getWaveform(id: string): Promise<WaveformDto> {
    const row = await tracksRepository.waveform(id);
    if (!row) throw new NotFoundError('Track');
    if (!Array.isArray(row.waveform)) throw new NotFoundError('Waveform');
    // Stored by the audio pipeline as number[1024] — validated on write.
    return { trackId: row.id, peaks: row.waveform as number[] };
  },

  async getLyrics(trackId: string): Promise<LyricsDto> {
    const row = await tracksRepository.lyrics(trackId);
    if (!row) throw new NotFoundError('Lyrics');
    return {
      trackId: row.trackId,
      synced: row.synced,
      lines: (row.lines as LyricsDto['lines']) ?? [],
      source: row.source,
    };
  },
};
