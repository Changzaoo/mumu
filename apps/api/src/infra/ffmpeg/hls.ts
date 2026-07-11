import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_BITRATES } from '@aurial/shared';
import { ffmpeg } from './ffmpeg.js';

export interface HlsRung {
  /** Directory name inside the track's audio folder — also the stream :quality param. */
  name: 'low' | 'normal' | 'high';
  bitrateKbps: number;
}

export const HLS_LADDER: readonly HlsRung[] = [
  { name: 'low', bitrateKbps: AUDIO_BITRATES.low },
  { name: 'normal', bitrateKbps: AUDIO_BITRATES.normal },
  { name: 'high', bitrateKbps: AUDIO_BITRATES.high },
];

const SEGMENT_SECONDS = 6;

function transcodeRung(
  inputPath: string,
  outDir: string,
  rung: HlsRung,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('aac')
      .audioBitrate(`${rung.bitrateKbps}k`)
      .audioChannels(2)
      .audioFrequency(44100)
      .outputOptions([
        '-f hls',
        `-hls_time ${SEGMENT_SECONDS}`,
        '-hls_playlist_type vod',
        '-hls_list_size 0',
        // filename as a separate token so paths with spaces survive
        '-hls_segment_filename',
        path.join(outDir, rung.name, 'seg-%05d.ts'),
      ])
      .output(path.join(outDir, rung.name, 'index.m3u8'))
      .on('progress', (p: { percent?: number }) => {
        if (onProgress && typeof p.percent === 'number')
          onProgress(Math.max(0, Math.min(100, p.percent)));
      })
      .on('error', (err: Error) =>
        reject(new Error(`HLS transcode (${rung.name}) failed: ${err.message}`)),
      )
      .on('end', () => resolve())
      .run();
  });
}

function buildMasterPlaylist(): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const rung of HLS_LADDER) {
    // ~+8% container overhead over the raw AAC bitrate.
    const bandwidth = Math.round(rung.bitrateKbps * 1000 * 1.08);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"`);
    lines.push(`${rung.name}/index.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Transcodes the full AAC ladder (96/160/320) into
 * `<outDir>/{low,normal,high}/index.m3u8 + seg-*.ts` and writes `master.m3u8`.
 * onProgress receives 0..100 across all rungs.
 */
export async function transcodeHlsLadder(
  inputPath: string,
  outDir: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  for (const rung of HLS_LADDER) {
    await mkdir(path.join(outDir, rung.name), { recursive: true });
  }
  for (let i = 0; i < HLS_LADDER.length; i += 1) {
    const rung = HLS_LADDER[i];
    if (!rung) continue;
    await transcodeRung(inputPath, outDir, rung, (pct) => {
      onProgress?.(Math.round(((i + pct / 100) / HLS_LADDER.length) * 100));
    });
  }
  await writeFile(path.join(outDir, 'master.m3u8'), buildMasterPlaylist(), 'utf8');
  onProgress?.(100);
}
