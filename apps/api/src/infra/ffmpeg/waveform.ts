import { WAVEFORM_PEAKS } from '@aurial/shared';
import { ffmpeg } from './ffmpeg.js';

const DECODE_SAMPLE_RATE = 8000;

/**
 * Decodes to mono 16-bit PCM at 8 kHz through a pipe and downsamples the
 * absolute amplitude into `peakCount` normalized [0..1] peaks.
 */
export function extractWaveformPeaks(
  filePath: string,
  peakCount = WAVEFORM_PEAKS,
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const command = ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(DECODE_SAMPLE_RATE)
      .format('s16le')
      .on('error', (err: Error) => reject(new Error(`waveform decode failed: ${err.message}`)));

    const stream = command.pipe();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', (err: Error) => reject(new Error(`waveform decode failed: ${err.message}`)));
    stream.on('end', () => {
      try {
        resolve(computePeaks(Buffer.concat(chunks), peakCount));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('waveform computation failed'));
      }
    });
  });
}

/** Pure downsampler — exported for unit tests. */
export function computePeaks(pcm: Buffer, peakCount: number): number[] {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return new Array<number>(peakCount).fill(0);

  const window = Math.max(1, Math.ceil(sampleCount / peakCount));
  const peaks: number[] = [];
  for (let p = 0; p < peakCount; p += 1) {
    const start = p * window;
    if (start >= sampleCount) {
      peaks.push(0);
      continue;
    }
    const end = Math.min(start + window, sampleCount);
    let max = 0;
    for (let i = start; i < end; i += 1) {
      const sample = Math.abs(pcm.readInt16LE(i * 2));
      if (sample > max) max = sample;
    }
    peaks.push(max / 32768);
  }
  const globalMax = Math.max(...peaks);
  if (globalMax <= 0) return peaks;
  return peaks.map((v) => Math.round((v / globalMax) * 1000) / 1000);
}
