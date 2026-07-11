import { REPLAY_GAIN_TARGET_LUFS } from '@aurial/shared';
import { ffmpeg, NULL_SINK } from './ffmpeg.js';

export interface LoudnessAnalysis {
  /** Integrated loudness (LUFS). */
  inputI: number;
  /** True peak (dBTP). */
  inputTp: number;
  inputLra: number;
  inputThresh: number;
}

/**
 * loudnorm pass 1 (analysis only): ffmpeg prints a JSON block on stderr.
 * The measured LUFS/true-peak feed client-side ReplayGain — we do NOT
 * re-normalize the audio itself.
 */
export function analyzeLoudness(filePath: string): Promise<LoudnessAnalysis> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    ffmpeg(filePath)
      .noVideo()
      .audioFilters(`loudnorm=I=${REPLAY_GAIN_TARGET_LUFS}:TP=-1.0:LRA=11:print_format=json`)
      .format('null')
      .output(NULL_SINK)
      .on('stderr', (line: string) => {
        stderr += `${line}\n`;
      })
      .on('error', (err: Error) => reject(new Error(`loudnorm analysis failed: ${err.message}`)))
      .on('end', () => {
        try {
          resolve(parseLoudnormJson(stderr));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('loudnorm parse failed'));
        }
      })
      .run();
  });
}

/** Extracts the last {...} JSON block from ffmpeg stderr output. */
export function parseLoudnormJson(stderr: string): LoudnessAnalysis {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('loudnorm output contained no JSON block');
  }
  const parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const num = (key: string): number => {
    const v = Number.parseFloat(parsed[key] ?? '');
    // ffmpeg emits "-inf" for silence; clamp to a sane floor.
    return Number.isFinite(v) ? v : -70;
  };
  return {
    inputI: num('input_i'),
    inputTp: num('input_tp'),
    inputLra: num('input_lra'),
    inputThresh: num('input_thresh'),
  };
}
