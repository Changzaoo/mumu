/**
 * Aurial signaling server — WebRTC matchmaking only.
 *
 * Relays room membership and SDP/ICE handshakes between peers so they can open
 * a direct WebRTC connection. It never receives, relays or stores audio, and
 * keeps all state in memory (no database, no disk). Deliberately tiny.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientMessageSchema, type PeerInfo, type ServerMessage } from '@aurial/shared';

const PORT = Number(process.env.PORT ?? 4100);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 500);
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE ?? 16);
/** Comma-separated Origin allowlist; empty = allow any (dev). */
const ORIGIN_ALLOWLIST = (process.env.ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

interface Peer {
  id: string;
  name: string;
  room: string;
  socket: WebSocket;
  alive: boolean;
}

const rooms = new Map<string, Map<string, Peer>>();
let connectionCount = 0;

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function peerList(room: string, exceptId?: string): PeerInfo[] {
  const members = rooms.get(room);
  if (!members) return [];
  return [...members.values()]
    .filter((p) => p.id !== exceptId)
    .map((p) => ({ peerId: p.id, name: p.name }));
}

function broadcast(room: string, message: ServerMessage, exceptId?: string): void {
  const members = rooms.get(room);
  if (!members) return;
  for (const peer of members.values()) {
    if (peer.id !== exceptId) send(peer.socket, message);
  }
}

function leaveRoom(peer: Peer): void {
  const members = rooms.get(peer.room);
  if (!members) return;
  members.delete(peer.id);
  if (members.size === 0) rooms.delete(peer.room);
  else broadcast(peer.room, { t: 'peer-left', peerId: peer.id });
}

const server = createServer((_req, res) => {
  // Lightweight health endpoint for nginx / uptime checks.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, peers: connectionCount }));
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (socket, req) => {
  if (ORIGIN_ALLOWLIST.length > 0) {
    const origin = req.headers.origin ?? '';
    if (!ORIGIN_ALLOWLIST.includes(origin)) {
      send(socket, { t: 'error', message: 'Origin not allowed' });
      socket.close();
      return;
    }
  }
  if (connectionCount >= MAX_CONNECTIONS) {
    send(socket, { t: 'error', message: 'Server at capacity' });
    socket.close();
    return;
  }

  connectionCount++;
  let peer: Peer | null = null;

  socket.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return send(socket, { t: 'error', message: 'Invalid JSON' });
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) return send(socket, { t: 'error', message: 'Invalid message' });
    const message = result.data;

    switch (message.t) {
      case 'join': {
        if (peer) leaveRoom(peer);
        const members = rooms.get(message.room) ?? new Map<string, Peer>();
        if (members.size >= MAX_ROOM_SIZE) {
          return send(socket, { t: 'error', message: 'Room is full' });
        }
        peer = { id: randomUUID(), name: message.name, room: message.room, socket, alive: true };
        const existing = peerList(message.room);
        members.set(peer.id, peer);
        rooms.set(message.room, members);
        send(socket, { t: 'joined', peerId: peer.id, room: message.room, peers: existing });
        broadcast(
          message.room,
          { t: 'peer-joined', peer: { peerId: peer.id, name: peer.name } },
          peer.id,
        );
        break;
      }
      case 'signal': {
        if (!peer) return;
        const target = rooms.get(peer.room)?.get(message.to);
        if (target) send(target.socket, { t: 'signal', from: peer.id, data: message.data });
        break;
      }
      case 'leave': {
        if (peer) {
          leaveRoom(peer);
          peer = null;
        }
        break;
      }
    }
  });

  socket.on('pong', () => {
    if (peer) peer.alive = true;
  });

  socket.on('close', () => {
    connectionCount--;
    if (peer) leaveRoom(peer);
  });

  socket.on('error', () => socket.close());
});

// Heartbeat: drop peers that stop responding.
const heartbeat = setInterval(() => {
  for (const members of rooms.values()) {
    for (const peer of members.values()) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      try {
        peer.socket.ping();
      } catch {
        /* socket going away */
      }
    }
  }
}, 30_000);

server.listen(PORT, () => {
  console.info(`[signaling] listening on :${PORT} (max ${MAX_CONNECTIONS} conns)`);
});

function shutdown(): void {
  clearInterval(heartbeat);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
