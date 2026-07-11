import type { FfprobeData } from 'fluent-ffmpeg';
import { ffmpeg } from './ffmpeg.js';

export interface AudioProbe {
  durationMs: number;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
  /** Normalized (lowercased keys) container/stream tags. */
  tags: Record<string, string>;
  hasEmbeddedCover: boolean;
}

function collectTags(data: FfprobeData): Record<string, string> {
  const tags: Record<string, string> = {};
  const sources: Array<Record<string, unknown> | undefined> = [
    data.format.tags as Record<string, unknown> | undefined,
    ...(data.streams ?? []).map((s) => s.tags as Record<string, unknown> | undefined),
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') tags[key.toLowerCase()] = value;
    }
  }
  return tags;
}

/** ffprobe JSON wrapped in a promise. Throws when the file has no audio stream. */
export function probeAudio(filePath: string): Promise<AudioProbe> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, data: FfprobeData) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${err.message}`));
        return;
      }
      const audio = (data.streams ?? []).find((s) => s.codec_type === 'audio');
      if (!audio) {
        reject(new Error('File contains no audio stream'));
        return;
      }
      // Embedded art shows up as a video stream (mjpeg/png, usually attached_pic).
      const cover = (data.streams ?? []).find((s) => s.codec_type === 'video');
      const durationSec = Number(data.format.duration ?? audio.duration ?? 0);
      resolve({
        durationMs: Math.round(durationSec * 1000),
        codec: audio.codec_name ?? null,
        sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
        channels: audio.channels ?? null,
        bitrate: data.format.bit_rate ? Number(data.format.bit_rate) : null,
        tags: collectTags(data),
        hasEmbeddedCover: Boolean(cover),
      });
    });
  });
}
