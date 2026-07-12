import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useIsAuthorized } from '@/lib/auth/roles';

/** Gate management surfaces (uploads/downloads/device) to authorized users. */
export function AuthorizedRoute({ children }: { children: ReactNode }) {
  const { loading } = useAuthUser();
  const authorized = useIsAuthorized();
  if (loading) return null;
  return authorized ? <>{children}</> : <Navigate to="/" replace />;
}
