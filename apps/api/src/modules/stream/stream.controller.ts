import type { Response } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { streamService, type StreamPayload } from './stream.service.js';

function send(res: Response, payload: StreamPayload, cacheControl: string): void {
  res.setHeader('Content-Type', payload.contentType);
  res.setHeader('Cache-Control', cacheControl);
  if (payload.kind === 'playlist') {
    res.status(200).send(payload.body ?? '');
    return;
  }
  if (payload.stream) {
    payload.stream.on('error', () => res.destroy());
    payload.stream.pipe(res);
  } else {
    res.status(500).end();
  }
}

export const streamController = {
  manifest: asyncHandler(async (req, res) => {
    const { trackId } = req.valid.params as { trackId: string };
    const { token } = req.valid.query as { token: string };
    // Manifests carry tokens — never cache client-side beyond a beat.
    send(res, await streamService.getManifest(trackId, token), 'no-cache');
  }),

  segment: asyncHandler(async (req, res) => {
    const { trackId, quality, file } = req.valid.params as {
      trackId: string;
      quality: string;
      file: string;
    };
    const { token } = req.valid.query as { token: string };
    const payload = await streamService.getSegment(trackId, quality, file, token);
    // Segments are content-addressed and immutable; nginx caches them too.
    send(
      res,
      payload,
      payload.kind === 'segment' ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  }),
};
