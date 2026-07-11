import { createServer } from 'node:http';
import { env } from './config/index.js';
import { logger } from './core/logger.js';
import { prisma } from './infra/db/prisma.js';
import { redis } from './infra/redis/redis.js';
import { closeQueues } from './infra/queue/queues.js';
import { createApp } from './app.js';
import { setupRealtime } from './realtime/socket.js';

const app = createApp();
const server = createServer(app);
const io = setupRealtime(server);

server.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, storage: env.STORAGE_DRIVER },
    `Aurial API listening on :${env.PORT} (docs at /api/docs, ws at /ws)`,
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  await new Promise<void>((resolve) => io.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeQueues().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);

  logger.info('bye');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
