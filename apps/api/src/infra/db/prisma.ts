import { PrismaClient } from '@prisma/client';
import { env, isDev } from '../../config/index.js';

/** Singleton — survives tsx watch restarts via globalThis. */
const globalForPrisma = globalThis as unknown as { __radinhoPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__radinhoPrisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) globalForPrisma.__radinhoPrisma = prisma;
