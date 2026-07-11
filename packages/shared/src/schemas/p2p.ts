import { z } from 'zod';

/**
 * Signaling protocol (WebSocket, JSON). The server only relays these — it never
 * sees audio. `signal.data` carries an opaque WebRTC SDP/ICE payload.
 */

export const MAX_ROOM_LEN = 12;
export const MAX_NAME_LEN = 40;

// ── client → server ──────────────────────────────────────────────
export const joinMessageSchema = z.object({
  t: z.literal('join'),
  room: z.string().min(1).max(MAX_ROOM_LEN),
  name: z.string().min(1).max(MAX_NAME_LEN),
});

export const signalMessageSchema = z.object({
  t: z.literal('signal'),
  to: z.string().min(1).max(64),
  /** Opaque WebRTC payload (SDP offer/answer or ICE candidate). */
  data: z.unknown(),
});

export const leaveMessageSchema = z.object({ t: z.literal('leave') });

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  signalMessageSchema,
  leaveMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ── server → client ──────────────────────────────────────────────
export interface PeerInfo {
  peerId: string;
  name: string;
}

export type ServerMessage =
  | { t: 'joined'; peerId: string; room: string; peers: PeerInfo[] }
  | { t: 'peer-joined'; peer: PeerInfo }
  | { t: 'peer-left'; peerId: string }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; message: string };

// ── data-channel application protocol (peer ↔ peer) ──────────────
/** Metadata a peer advertises / sends for a track (subset of TrackDto). */
export interface SharedTrackMeta {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  coverDataUrl: string | null;
}

export type PeerControlMessage =
  | { t: 'hello'; name: string }
  | { t: 'manifest'; tracks: SharedTrackMeta[] }
  | { t: 'request'; trackId: string }
  | { t: 'track-begin'; meta: SharedTrackMeta }
  | { t: 'track-end'; trackId: string }
  | { t: 'decline'; trackId: string; reason: string };
