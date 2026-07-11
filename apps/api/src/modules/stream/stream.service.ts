import type { Readable } from 'node:stream';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../core/errors/index.js';
import { getStorage, readToBuffer } from '../../infra/storage/index.js';
import { streamRepository } from './stream.repository.js';
import { verifyStreamToken } from './streamToken.js';

export const HLS_QUALITIES = ['low', 'normal', 'high'] as const;
export type HlsQuality = (typeof HLS_QUALITIES)[number];

/** Segment / variant-playlist file names: seg-00001.ts or index.m3u8 only. */
const SAFE_FILE_RE = /^[A-Za-z0-9_-]+\.(m3u8|ts)$/;

export interface StreamPayload {
  kind: 'playlist' | 'segment';
  contentType: string;
  /** Playlist text (with token propagated) — playlists only. */
  body?: string;
  /** Raw byte stream — segments only. */
  stream?: Readable;
}

function assertToken(trackId: string, token: string): void {
  if (!verifyStreamToken(trackId, token)) {
    throw new UnauthorizedError('Invalid or expired stream token');
  }
}

/** Appends the caller's token to every URI line of an m3u8 playlist. */
export function propagateToken(m3u8: string, token: string): string {
  return m3u8
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) return line;
      return `${trimmed}${trimmed.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    })
    .join('\n');
}

async function trackAudioBase(trackId: string): Promise<string> {
  const track = await streamRepository.findStreamable(trackId);
  if (!track || !track.hlsKey) throw new NotFoundError('Stream');
  // hlsKey = audio/<trackId>/master.m3u8 → base = audio/<trackId>
  return track.hlsKey.replace(/\/master\.m3u8$/, '');
}

export const streamService = {
  /** GET /stream/:trackId/manifest.m3u8 — the HLS master playlist. */
  async getManifest(trackId: string, token: string): Promise<StreamPayload> {
    assertToken(trackId, token);
    const base = await trackAudioBase(trackId);
    const stream = await getStorage().getStream(`${base}/master.m3u8`);
    const text = (await readToBuffer(stream)).toString('utf8');
    return {
      kind: 'playlist',
      contentType: 'application/vnd.apple.mpegurl',
      body: propagateToken(text, token),
    };
  },

  /**
   * GET /stream/:trackId/:quality/:file — variant playlists and segments.
   *
   * NOTE (prod, STORAGE_DRIVER=local): instead of piping bytes through Node,
   * respond with `X-Accel-Redirect: /protected-media/audio/<trackId>/<quality>/<file>`
   * after the token check and let nginx sendfile() it — see the commented
   * `location /protected-media/` block in infra/nginx/nginx.conf.
   */
  async getSegment(
    trackId: string,
    quality: string,
    file: string,
    token: string,
  ): Promise<StreamPayload> {
    assertToken(trackId, token);
    if (!(HLS_QUALITIES as readonly string[]).includes(quality)) {
      throw new ValidationError('Unknown quality', { quality });
    }
    if (!SAFE_FILE_RE.test(file)) throw new ValidationError('Invalid segment name');
    const base = await trackAudioBase(trackId);
    const key = `${base}/${quality}/${file}`;

    if (file.endsWith('.m3u8')) {
      const stream = await getStorage().getStream(key);
      const text = (await readToBuffer(stream)).toString('utf8');
      return {
        kind: 'playlist',
        contentType: 'application/vnd.apple.mpegurl',
        body: propagateToken(text, token),
      };
    }
    return {
      kind: 'segment',
      contentType: 'video/mp2t',
      stream: await getStorage().getStream(key),
    };
  },
};
