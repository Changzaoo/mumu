import type { Readable } from 'node:stream';
import { slugify, type LyricsDto, type TrackDto, type WaveformDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { getStorage } from '../../infra/storage/index.js';
import { toTrackDto } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { tracksRepository } from './tracks.repository.js';

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  alac: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
};

export interface DownloadPayload {
  stream: Readable;
  contentType: string;
  fileName: string;
  sizeBytes: number | null;
}

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

  /** Streams the single-file original for offline download and records the grant. */
  async getDownload(userId: string, trackId: string): Promise<DownloadPayload> {
    const track = await tracksRepository.downloadSource(trackId);
    if (!track) throw new NotFoundError('Track');
    if (!track.originalKey) throw new NotFoundError('Download');

    const storage = getStorage();
    const [stream, sizeBytes] = await Promise.all([
      storage.getStream(track.originalKey),
      storage.size(track.originalKey),
    ]);
    await tracksRepository.recordDownload(userId, trackId, 'original');

    const ext = (track.originalKey.split('.').pop() ?? 'bin').toLowerCase();
    return {
      stream,
      sizeBytes,
      contentType: AUDIO_CONTENT_TYPES[ext] ?? 'application/octet-stream',
      fileName: `${slugify(track.title) || 'track'}.${ext}`,
    };
  },
};
