import { describe, expect, it, vi } from 'vitest';
import type { SharedTrackMeta } from '@aurial/shared';
import { Transfer, type TransferChannel, type TransferProgress } from '@/lib/p2p/transfer';

/** A loopback channel: whatever is "sent" is delivered to the paired Transfer. */
class LoopbackChannel implements TransferChannel {
  bufferedAmount = 0;
  peer: Transfer | null = null;

  sendControl(message: Parameters<TransferChannel['sendControl']>[0]): void {
    queueMicrotask(() => this.peer?.handleControl(message));
  }
  sendBinary(buffer: ArrayBuffer): void {
    queueMicrotask(() => this.peer?.handleBinary(buffer));
  }
  waitForBufferLow(): Promise<void> {
    return Promise.resolve();
  }
}

function makeMeta(sizeBytes: number): SharedTrackMeta {
  return {
    id: 'local:1',
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: 1000,
    sizeBytes,
    mimeType: 'audio/mpeg',
    coverDataUrl: null,
  };
}

describe('Transfer protocol', () => {
  it('chunks a track on send and reassembles it byte-for-byte on receive', async () => {
    // 40000 bytes → 3 chunks at 16KB each (exercises the chunker + backpressure loop).
    const data = new Uint8Array(40_000).map((_, i) => i % 256);
    const blob = new Blob([data], { type: 'audio/mpeg' });
    const meta = makeMeta(data.length);

    let saved: { meta: SharedTrackMeta; blob: Blob } | null = null;
    const receiveProgress: TransferProgress[] = [];

    const senderChannel = new LoopbackChannel();
    const receiverChannel = new LoopbackChannel();

    const sender = new Transfer({
      channel: senderChannel,
      myName: 'Sender',
      getSharedMetas: () => [meta],
      getBlob: async () => blob,
      saveReceived: async () => undefined,
      onManifest: () => undefined,
      onProgress: () => undefined,
    });

    const receiver = new Transfer({
      channel: receiverChannel,
      myName: 'Receiver',
      getSharedMetas: () => [],
      getBlob: async () => null,
      saveReceived: async (m, b) => {
        saved = { meta: m, blob: b };
      },
      onManifest: () => undefined,
      onProgress: (p) => receiveProgress.push(p),
    });

    senderChannel.peer = receiver;
    receiverChannel.peer = sender;

    receiver.request(meta.id);

    await vi.waitFor(() => expect(saved).not.toBeNull());

    const received = new Uint8Array(await saved!.blob.arrayBuffer());
    expect(received.length).toBe(data.length);
    expect(received).toEqual(data);
    expect(receiveProgress.at(-1)).toMatchObject({ dir: 'receive', progress: 1, done: true });
  });

  it('declines a request for a track it does not share', async () => {
    const errors: TransferProgress[] = [];
    const senderChannel = new LoopbackChannel();
    const receiverChannel = new LoopbackChannel();

    const sender = new Transfer({
      channel: senderChannel,
      myName: 'Sender',
      getSharedMetas: () => [],
      getBlob: async () => null,
      saveReceived: async () => undefined,
      onManifest: () => undefined,
      onProgress: () => undefined,
    });
    const receiver = new Transfer({
      channel: receiverChannel,
      myName: 'Receiver',
      getSharedMetas: () => [],
      getBlob: async () => null,
      saveReceived: async () => undefined,
      onManifest: () => undefined,
      onProgress: (p) => {
        if (p.error) errors.push(p);
      },
    });

    senderChannel.peer = receiver;
    receiverChannel.peer = sender;

    receiver.request('local:missing');

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(errors[0]).toMatchObject({ trackId: 'local:missing', dir: 'receive', error: true });
  });
});
