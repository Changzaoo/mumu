import type { UserRole } from '@aurial/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requestId middleware; echoed as X-Request-Id. */
      id: string;
      /** Set by the auth middleware when a valid bearer token is present. */
      user?: { id: string; firebaseUid: string; role: UserRole };
      /** Zod-parsed inputs set by validate(); cast per-controller. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
