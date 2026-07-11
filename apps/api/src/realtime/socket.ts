import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { sessionSyncSchema, type SessionSyncPayload, type UserRole } from '@aurial/shared';
import { webOrigins } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { verifyIdToken } from '../infra/firebase/firebase.js';
import { createSubscriber } from '../infra/redis/redis.js';
import { REALTIME_NOTIFY_CHANNEL } from '../infra/queue/queues.js';
import { socialRepository } from '../modules/social/social.repository.js';

interface SocketUser {
  id: string;
  role: UserRole;
  displayName: string;
}

const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
const userRoom = (userId: string): string => `user:${userId}`;

function socketUser(socket: Socket): SocketUser {
  return socket.data['user'] as SocketUser;
}

/** Firebase auth on the handshake (`auth: { token }`). */
async function authMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const token = socket.handshake.auth['token'];
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    const identity = await verifyIdToken(token);
    const user = await prisma.user.findUnique({
      where: { firebaseUid: identity.uid },
      select: { id: true, role: true, displayName: true, isBanned: true },
    });
    if (!user || user.isBanned) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    socket.data['user'] = {
      id: user.id,
      role: user.role,
      displayName: user.displayName,
    } satisfies SocketUser;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
}

function registerSessionHandlers(io: Server, socket: Socket): void {
  const user = socketUser(socket);

  socket.on(
    'session:join',
    async (payload: { sessionId?: string }, ack?: (ok: boolean) => void) => {
      try {
        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
        const session = await socialRepository.findSession(sessionId);
        if (!session || session.endedAt !== null) {
          ack?.(false);
          return;
        }
        await socialRepository.joinSession(sessionId, user.id);
        await socket.join(sessionRoom(sessionId));
        socket.to(sessionRoom(sessionId)).emit('session:member-joined', {
          sessionId,
          userId: user.id,
          displayName: user.displayName,
        });
        // Late joiners get the current state immediately.
        socket.emit('session:sync', {
          sessionId,
          trackId: session.trackId,
          positionMs: session.positionMs,
          isPlaying: session.isPlaying,
          at: Date.now(),
        } satisfies SessionSyncPayload);
        ack?.(true);
      } catch (err) {
        logger.warn({ err }, 'session:join failed');
        ack?.(false);
      }
    },
  );

  socket.on('session:leave', async (payload: { sessionId?: string }) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
    if (!sessionId) return;
    await socialRepository.leaveSession(sessionId, user.id).catch(() => undefined);
    await socket.leave(sessionRoom(sessionId));
    socket.to(sessionRoom(sessionId)).emit('session:member-left', { sessionId, userId: user.id });
  });

  socket.on('session:sync', async (raw: unknown) => {
    const parsed = sessionSyncSchema.safeParse(raw);
    if (!parsed.success) return;
    const payload = parsed.data;
    const session = await socialRepository.findSession(payload.sessionId).catch(() => null);
    // Only the host drives playback state.
    if (!session || session.endedAt !== null || session.hostUserId !== user.id) return;
    await socialRepository
      .updateSessionState(payload.sessionId, {
        trackId: payload.trackId,
        positionMs: payload.positionMs,
        isPlaying: payload.isPlaying,
      })
      .catch(() => undefined);
    socket.to(sessionRoom(payload.sessionId)).emit('session:sync', payload);
  });
}

/** Bridges worker-emitted notifications (Redis pub/sub) into user rooms. */
function bridgeNotifications(io: Server): void {
  const subscriber = createSubscriber();
  subscriber
    .subscribe(REALTIME_NOTIFY_CHANNEL)
    .catch((err) => logger.warn({ err }, 'notification bridge subscribe failed'));
  subscriber.on('message', (_channel, message) => {
    try {
      const parsed = JSON.parse(message) as { userId?: string; notification?: unknown };
      if (typeof parsed.userId === 'string' && parsed.notification !== undefined) {
        io.to(userRoom(parsed.userId)).emit('notification', parsed.notification);
      }
    } catch {
      // ignore malformed messages
    }
  });
}

export function setupRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/ws',
    cors: { origin: webOrigins, credentials: true },
  });

  io.use((socket, next) => {
    void authMiddleware(socket, next);
  });

  io.on('connection', (socket) => {
    const user = socketUser(socket);
    void socket.join(userRoom(user.id));
    registerSessionHandlers(io, socket);
  });

  bridgeNotifications(io);
  return io;
}
