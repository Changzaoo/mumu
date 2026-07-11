import { pino } from 'pino';
import { env, isDev } from '../config/index.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

/** Structured audit trail for admin actions (also persisted to AuditLog). */
export const auditLogger = logger.child({ audit: true });
