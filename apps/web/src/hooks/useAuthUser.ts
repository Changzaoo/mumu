/**
 * useAuthUser — reactive Firebase auth state + Aurial profile.
 *
 * On first login it POSTs /auth/session once per uid (verifies the token and
 * upserts the user server-side) and caches the returned MeDto profile.
 * Demo mode (authDisabled): resolves immediately to signed-out.
 */
import { useSyncExternalStore } from 'react';
import type { MeDto } from '@aurial/shared';
import { api } from '@/lib/api';
import { authDisabled, subscribeAuth, type User } from '@/lib/firebase';

export interface AuthSnapshot {
  user: User | null;
  /** Aurial profile from POST /auth/session (role, handle…). */
  profile: MeDto | null;
  loading: boolean;
}

let snapshot: AuthSnapshot = { user: null, profile: null, loading: !authDisabled };
const subscribers = new Set<() => void>();
const sessionPosted = new Set<string>();
let started = false;

function publish(next: AuthSnapshot): void {
  snapshot = next;
  for (const notify of subscribers) notify();
}

function start(): void {
  if (started) return;
  started = true;
  subscribeAuth((user) => {
    publish({ user, profile: user ? snapshot.profile : null, loading: false });
    if (user && !sessionPosted.has(user.uid)) {
      sessionPosted.add(user.uid);
      api
        .post<MeDto>('/auth/session')
        .then(({ data }) => {
          // Only apply if the same user is still signed in.
          if (snapshot.user?.uid === user.uid) publish({ ...snapshot, profile: data });
        })
        .catch(() => {
          sessionPosted.delete(user.uid); // retry on next auth emission
        });
    }
  });
}

function subscribe(onStoreChange: () => void): () => void {
  start();
  subscribers.add(onStoreChange);
  return () => subscribers.delete(onStoreChange);
}

export function useAuthUser(): AuthSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
