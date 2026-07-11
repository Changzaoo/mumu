/**
 * transfer — the peer application protocol over the data channel
 * (ARCHITECTURE-P2P §4, `PeerControlMessage` from @aurial/shared).
 *
 *   open        → send {hello} + {manifest}
 *   request     → {track-begin} · binary chunks (backpressured) · {track-end}
 *   receiving   → reassemble chunks into a Blob → saveReceivedTrack
 *
 * One outbound transfer at a time per peer (requests are queued). Progress is
 * emitted for both directions.
 */
import type { PeerControlMessage, SharedTrackMeta } from '@aurial/shared';

/** Minimal channel surface a Transfer needs (satisfied by PeerConnection). */
export interface TransferChannel {
  sendControl(message: PeerControlMessage): void;
  sendBinary(buffer: ArrayBuffer): void;
  readonly bufferedAmount: number;
  waitForBufferLow(): Promise<void>;
}

export interface TransferProgress {
  trackId: string;
  dir: 'send' | 'receive';
  /** 0..1 */
  progress: number;
  done?: boolean;
  error?: boolean;
}

export interface TransferOptions {
  channel: TransferChannel;
  myName: string;
  /** Tracks this peer currently advertises. */
  getSharedMetas: () => SharedTrackMeta[];
  /** Read a local track's bytes for sending. */
  getBlob: (trackId: string) => Promise<Blob | null>;
  /** Persist a received track into the local library. */
  saveReceived: (meta: SharedTrackMeta, blob: Blob) => Promise<void>;
  onManifest: (metas: SharedTrackMeta[]) => void;
  onProgress: (progress: TransferProgress) => void;
  onRemoteName?: (name: string) => void;
  /** Pause threshold for backpressure (bytes). */
  bufferedHigh?: number;
}

export const CHUNK_SIZE = 16 * 1024;
const DEFAULT_BUFFERED_HIGH = 4 * 1024 * 1024;

interface Incoming {
  meta: SharedTrackMeta;
  chunks: ArrayBuffer[];
  received: number;
}

export class Transfer {
  private readonly opts: TransferOptions;
  private readonly bufferedHigh: number;
  private sendQueue: string[] = [];
  private sending = false;
  private incoming: Incoming | null = null;

  constructor(options: TransferOptions) {
    this.opts = options;
    this.bufferedHigh = options.bufferedHigh ?? DEFAULT_BUFFERED_HIGH;
  }

  /** Call once the channel opens: greet + advertise the shared library. */
  start(): void {
    this.opts.channel.sendControl({ t: 'hello', name: this.opts.myName });
    this.sendManifest();
  }

  sendManifest(): void {
    this.opts.channel.sendControl({ t: 'manifest', tracks: this.opts.getSharedMetas() });
  }

  /** Ask the peer for one of their advertised tracks. */
  request(trackId: string): void {
    this.opts.onProgress({ trackId, dir: 'receive', progress: 0 });
    this.opts.channel.sendControl({ t: 'request', trackId });
  }

  handleControl(message: PeerControlMessage): void {
    switch (message.t) {
      case 'hello':
        this.opts.onRemoteName?.(message.name);
        break;
      case 'manifest':
        this.opts.onManifest(message.tracks);
        break;
      case 'request':
        this.enqueueSend(message.trackId);
        break;
      case 'track-begin':
        this.incoming = { meta: message.meta, chunks: [], received: 0 };
        this.opts.onProgress({ trackId: message.meta.id, dir: 'receive', progress: 0 });
        break;
      case 'track-end':
        void this.finishIncoming();
        break;
      case 'decline':
        this.opts.onProgress({
          trackId: message.trackId,
          dir: 'receive',
          progress: 0,
          done: true,
          error: true,
        });
        break;
    }
  }

  handleBinary(buffer: ArrayBuffer): void {
    if (!this.incoming) return;
    this.incoming.chunks.push(buffer);
    this.incoming.received += buffer.byteLength;
    const total = this.incoming.meta.sizeBytes || this.incoming.received || 1;
    this.opts.onProgress({
      trackId: this.incoming.meta.id,
      dir: 'receive',
      progress: Math.min(1, this.incoming.received / total),
    });
  }

  private async finishIncoming(): Promise<void> {
    const incoming = this.incoming;
    this.incoming = null;
    if (!incoming) return;
    const blob = new Blob(incoming.chunks, { type: incoming.meta.mimeType || 'audio/mpeg' });
    try {
      await this.opts.saveReceived(incoming.meta, blob);
      this.opts.onProgress({ trackId: incoming.meta.id, dir: 'receive', progress: 1, done: true });
    } catch {
      this.opts.onProgress({
        trackId: incoming.meta.id,
        dir: 'receive',
        progress: 0,
        done: true,
        error: true,
      });
    }
  }

  private enqueueSend(trackId: string): void {
    this.sendQueue.push(trackId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (let trackId = this.sendQueue.shift(); trackId; trackId = this.sendQueue.shift()) {
        await this.sendTrack(trackId);
      }
    } finally {
      this.sending = false;
    }
  }

  private async sendTrack(trackId: string): Promise<void> {
    const meta = this.opts.getSharedMetas().find((m) => m.id === trackId);
    if (!meta) {
      this.opts.channel.sendControl({ t: 'decline', trackId, reason: 'not-shared' });
      return;
    }
    const blob = await this.opts.getBlob(trackId).catch(() => null);
    if (!blob) {
      this.opts.channel.sendControl({ t: 'decline', trackId, reason: 'unavailable' });
      return;
    }

    const size = blob.size;
    this.opts.channel.sendControl({
      t: 'track-begin',
      meta: { ...meta, sizeBytes: size, mimeType: blob.type || meta.mimeType },
    });

    const buffer = await blob.arrayBuffer();
    let offset = 0;
    while (offset < buffer.byteLength) {
      if (this.opts.channel.bufferedAmount > this.bufferedHigh) {
        await this.opts.channel.waitForBufferLow();
      }
      const end = Math.min(offset + CHUNK_SIZE, buffer.byteLength);
      this.opts.channel.sendBinary(buffer.slice(offset, end));
      offset = end;
      this.opts.onProgress({ trackId, dir: 'send', progress: offset / (buffer.byteLength || 1) });
    }

    this.opts.channel.sendControl({ t: 'track-end', trackId });
    this.opts.onProgress({ trackId, dir: 'send', progress: 1, done: true });
  }
}
