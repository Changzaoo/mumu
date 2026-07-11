/**
 * peerConnection — wraps a single `RTCPeerConnection` + one reliable ordered
 * `RTCDataChannel` ("aurial") using the perfect-negotiation pattern so either
 * side can initiate. SDP/ICE is sent out via the injected `sendSignal(to, data)`
 * callback; inbound handshake payloads are fed in through `handleSignal(data)`.
 *
 * Emits: open, close, control (parsed JSON), binary (ArrayBuffer).
 */
import type { PeerControlMessage } from '@aurial/shared';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/** Pause sends above this many buffered bytes; resume on bufferedamountlow. */
export const BUFFERED_HIGH = 4 * 1024 * 1024;
const BUFFERED_LOW = 512 * 1024;

interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface PeerConnectionEventMap {
  open: void;
  close: void;
  control: PeerControlMessage;
  binary: ArrayBuffer;
}

export interface PeerConnectionOptions {
  /** Remote peer id (used as the `to` target for outbound signals). */
  remoteId: string;
  /** Perfect-negotiation role — the impolite peer creates the data channel. */
  polite: boolean;
  sendSignal: (to: string, data: unknown) => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private readonly remoteId: string;
  private readonly polite: boolean;
  private readonly sendSignal: (to: string, data: unknown) => void;

  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;

  private listeners: {
    [K in keyof PeerConnectionEventMap]: Set<(p: PeerConnectionEventMap[K]) => void>;
  } = {
    open: new Set(),
    close: new Set(),
    control: new Set(),
    binary: new Set(),
  };

  constructor(options: PeerConnectionOptions) {
    this.remoteId = options.remoteId;
    this.polite = options.polite;
    this.sendSignal = options.sendSignal;

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          this.makingOffer = true;
          await this.pc.setLocalDescription();
          this.sendSignal(this.remoteId, { description: this.pc.localDescription });
        } catch {
          /* negotiation retried on next event */
        } finally {
          this.makingOffer = false;
        }
      })();
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(this.remoteId, { candidate: candidate.toJSON() });
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        this.emit('close', undefined);
      }
    };

    this.pc.ondatachannel = (event) => this.setupChannel(event.channel);

    // Impolite peer creates the channel → drives the initial offer.
    if (!this.polite) {
      this.setupChannel(this.pc.createDataChannel('aurial', { ordered: true }));
    }
  }

  on<K extends keyof PeerConnectionEventMap>(
    event: K,
    listener: (payload: PeerConnectionEventMap[K]) => void,
  ): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private emit<K extends keyof PeerConnectionEventMap>(
    event: K,
    payload: PeerConnectionEventMap[K],
  ): void {
    for (const listener of this.listeners[event]) listener(payload);
  }

  private setupChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFERED_LOW;
    channel.onopen = () => this.emit('open', undefined);
    channel.onclose = () => this.emit('close', undefined);
    channel.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (typeof event.data === 'string') {
        try {
          this.emit('control', JSON.parse(event.data) as PeerControlMessage);
        } catch {
          /* ignore malformed control frame */
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.emit('binary', event.data);
      }
    };
  }

  /** Feed an inbound SDP/ICE payload received via signaling. */
  async handleSignal(data: unknown): Promise<void> {
    const { description, candidate } = (data ?? {}) as SignalPayload;
    try {
      if (description) {
        const offerCollision =
          description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        await this.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendSignal(this.remoteId, { description: this.pc.localDescription });
        }
      } else if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch {
      /* transient negotiation error — perfect negotiation self-heals */
    }
  }

  sendControl(message: PeerControlMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message));
  }

  sendBinary(buffer: ArrayBuffer): void {
    if (this.channel?.readyState === 'open') this.channel.send(buffer);
  }

  get bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  /** Resolves once the channel's send buffer drains below the low threshold. */
  waitForBufferLow(): Promise<void> {
    const channel = this.channel;
    if (!channel || channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const handler = (): void => {
        channel.removeEventListener('bufferedamountlow', handler);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', handler);
    });
  }

  get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.channel?.close();
    } catch {
      /* already gone */
    }
    try {
      this.pc.close();
    } catch {
      /* already gone */
    }
  }
}
