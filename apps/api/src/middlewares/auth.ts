import type { Request, RequestHandler } from 'express';
import type { User } from '@prisma/client';
import { slugify, type UserRole } from '@aurial/shared';
import { customAlphabet } from 'nanoid';
import { asyncHandler } from '../core/http/asyncHandler.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors/index.js';
import { prisma } from '../infra/db/prisma.js';
import { verifyIdToken, type VerifiedIdentity } from '../infra/firebase/firebase.js';

const handleSuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 4);
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

function baseHandle(identity: VerifiedIdentity): string {
  const source = identity.email?.split('@')[0] ?? identity.name ?? 'listener';
  const slug = slugify(source).replace(/-/g, '_').slice(0, 24);
  return slug.length >= 3 ? slug : `listener_${handleSuffix()}`;
}

async function findOrCreateUser(identity: VerifiedIdentity): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { firebaseUid: identity.uid } });
  if (existing) {
    if (Date.now() - existing.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await prisma.user
        .update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    return existing;
  }
  // First login — mint a unique handle (retry on the rare collision).
  const base = baseHandle(identity);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const handle = attempt === 0 ? base : `${base}_${handleSuffix()}`;
    try {
      return await prisma.user.create({
        data: {
          firebaseUid: identity.uid,
          email: identity.email,
          handle,
          displayName: identity.name ?? handle,
          avatarUrl: identity.picture,
        },
      });
    } catch {
      // unique collision on handle (or a concurrent create) — retry / refetch
      const raced = await prisma.user.findUnique({ where: { firebaseUid: identity.uid } });
      if (raced) return raced;
    }
  }
  throw new UnauthorizedError('Could not provision user account');
}

function isCurrentlyBanned(user: User): boolean {
  if (!user.isBanned) return false;
  return user.bannedUntil === null || user.bannedUntil.getTime() > Date.now();
}

/**
 * Optional authentication: verifies the bearer token when present and
 * attaches req.user. Missing token is fine — protected routes add requireAuth.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  const identity = await verifyIdToken(header.slice('Bearer '.length).trim());
  const user = await findOrCreateUser(identity);
  if (isCurrentlyBanned(user)) {
    throw new ForbiddenError('Account is banned', {
      reason: user.banReason,
      until: user.bannedUntil,
    });
  }
  req.user = { id: user.id, firebaseUid: user.firebaseUid, role: user.role as UserRole };
  next();
});

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  next();
};

/** For controllers behind requireAuth — narrows req.user without assertions. */
export function currentUser(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const ROLE_RANK: Record<UserRole, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 };

/** Role gate with hierarchy (ADMIN satisfies MODERATOR). */
export function requireRole(role: Extract<UserRole, 'MODERATOR' | 'ADMIN'>): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) {
      next(new ForbiddenError(`Requires ${role} role`));
      return;
    }
    next();
  };
}
