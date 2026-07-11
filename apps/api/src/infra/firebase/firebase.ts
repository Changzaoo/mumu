import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env, isDev } from '../../config/index.js';
import { UnauthorizedError } from '../../core/errors/index.js';
import { logger } from '../../core/logger.js';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

let app: App | null = null;
let warned = false;

export function isFirebaseEnabled(): boolean {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

function getApp(): App {
  if (!app) {
    const existing = getApps();
    app =
      existing.length > 0 && existing[0] !== undefined
        ? existing[0]
        : initializeApp({
            credential: cert({
              projectId: env.FIREBASE_PROJECT_ID,
              clientEmail: env.FIREBASE_CLIENT_EMAIL,
              // .env keeps the key single-line with \n escapes.
              privateKey: (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
            }),
          });
  }
  return app;
}

function warnDegradedOnce(): void {
  if (warned) return;
  warned = true;
  logger.warn(
    '⚠️  FIREBASE_* env vars are unset and NODE_ENV=development — running in DEGRADED AUTH MODE. ' +
      'Bearer tokens of the form "dev:<uid>" are accepted WITHOUT verification. Never use this outside local dev.',
  );
}

/**
 * Verifies a Firebase ID token. In development without Firebase credentials,
 * accepts `dev:<uid>` bearer tokens (loud warning) so the stack runs offline.
 */
export async function verifyIdToken(token: string): Promise<VerifiedIdentity> {
  if (!isFirebaseEnabled()) {
    if (isDev && token.startsWith('dev:') && token.length > 4) {
      warnDegradedOnce();
      const uid = token.slice(4);
      return { uid, email: `${uid}@dev.local`, name: uid, picture: null };
    }
    throw new UnauthorizedError('Authentication is not configured');
  }
  try {
    const decoded = await getAuth(getApp()).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: typeof decoded['name'] === 'string' ? (decoded['name'] as string) : null,
      picture: decoded.picture ?? null,
    };
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
