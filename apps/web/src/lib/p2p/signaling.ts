/**
 * Signaling client — a thin typed WebSocket wrapper over the matchmaking
 * server (ARCHITECTURE-P2P §3). It only relays the WebRTC handshake; no audio
 * ever passes through it. Auto-reconnects with backoff and re-joins the room.
 *
 * URL: `import.meta.env.VITE_SIGNALING_URL`, else same-origin ws at `/rtc`.
 */
import type { ClientMessage, PeerInfo, ServerMessage } from '@aurial/shared';

export type SignalingStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface SignalingEventMap {
  open: void;
  close: void;
  status: SignalingStatus;
  joined: { peerId: string; room: string; peers: PeerInfo[] };
  'peer-joined': { peer: PeerInfo };
  'peer-left': { peerId: string };
  signal: { from: string; data: unknown };
  error: { message: string };
}

export function signalingUrl(): string {
  const explicit = import.meta.env.VITE_SIGNALING_URL;
  if (explicit) return explicit;
  return `${location.origin.replace(/^http/, 'ws')}/rtc`;
}

const MAX_BACKOFF = 15_000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private room: string | null = null;
  private name = '';
  private shouldReconnect = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners: {
    [K in keyof SignalingEventMap]: Set<(p: SignalingEventMap[K]) => void>;
  } = {
    open: new Set(),
    close: new Set(),
    status: new Set(),
    joined: new Set(),
    'peer-joined': new Set(),
    'peer-left': new Set(),
    signal: new Set(),
    error: new Set(),
  };

  on<K extends keyof SignalingEventMap>(
    event: K,
    listener: (payload: SignalingEventMap[K]) => void,
  ): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private emit<K extends keyof SignalingEventMap>(event: K, payload: SignalingEventMap[K]): void {
    for (const listener of this.listeners[event]) listener(payload);
  }

  connect(room: string, name: string): void {
    this.room = room;
    this.name = name;
    this.shouldReconnect = true;
    this.open();
  }

  private open(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.emit('status', this.attempts > 0 ? 'reconnecting' : 'connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(signalingUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.emit('open', undefined);
      if (this.room) this.send({ t: 'join', room: this.room, name: this.name });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      switch (message.t) {
        case 'joined':
          this.emit('status', 'connected');
          this.emit('joined', { peerId: message.peerId, room: message.room, peers: message.peers });
          break;
        case 'peer-joined':
          this.emit('peer-joined', { peer: message.peer });
          break;
        case 'peer-left':
          this.emit('peer-left', { peerId: message.peerId });
          break;
        case 'signal':
          this.emit('signal', { from: message.from, data: message.data });
          break;
        case 'error':
          this.emit('error', { message: message.message });
          break;
      }
    };

    ws.onclose = () => {
      this.emit('close', undefined);
      if (this.shouldReconnect) this.scheduleReconnect();
      else this.emit('status', 'idle');
    };

    ws.onerror = () => {
      // `onclose` follows and drives reconnection.
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.emit('status', 'reconnecting');
    const delay = Math.min(MAX_BACKOFF, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.attempts = 0;
    this.emit('status', 'idle');
  }
}
