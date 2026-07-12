/**
 * Authorization — who may manage the device (Uploads / Downloads / No
 * dispositivo). There's no backend, so it's a client-side email allow-list the
 * owner controls here. Everyone else is a "common user": they can still add
 * music through the hardened Add-music dialog, but not the management tabs.
 */
import { useAuthUser } from '@/hooks/useAuthUser';

/** Emails allowed into the admin/management surfaces. Edit to grant access. */
export const AUTHORIZED_EMAILS = new Set(
  ['perdibitcoin@gmail.com', 'redcanidsvinicius@gmail.com'].map((e) => e.toLowerCase()),
);

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  return Boolean(email && AUTHORIZED_EMAILS.has(email.toLowerCase()));
}

/** True when the signed-in user may see/use the management tabs. */
export function useIsAuthorized(): boolean {
  const { user, profile } = useAuthUser();
  // Central-API role (if ever available) OR the local email allow-list.
  const role = profile?.role;
  return role === 'ADMIN' || role === 'MODERATOR' || isAuthorizedEmail(user?.email);
}
