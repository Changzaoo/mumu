import ffmpegLib from 'fluent-ffmpeg';
import { env } from '../../config/index.js';

if (env.FFMPEG_PATH) ffmpegLib.setFfmpegPath(env.FFMPEG_PATH);
if (env.FFPROBE_PATH) ffmpegLib.setFfprobePath(env.FFPROBE_PATH);

/** Pre-configured fluent-ffmpeg factory (paths from env, PATH fallback). */
export const ffmpeg = ffmpegLib;

/** Platform null sink for analysis-only passes. */
export const NULL_SINK = process.platform === 'win32' ? 'NUL' : '/dev/null';
