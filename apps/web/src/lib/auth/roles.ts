/**
 * Authorization — who may manage the device (Uploads / Downloads / No
 * dispositivo). There's no backend, so it's a client-side email allow-list the
 * owner controls here. Everyone else is a "common user": they can still add
 * music through the hardened Add-music dialog, but not the management tabs.
 */
import { ADMIN_EMAILS, ehEmailAdmin } from '@radinho/shared';
import { useAuthUser } from '@/hooks/useAuthUser';

/**
 * Emails allowed into the admin/management surfaces. A lista mora em `@radinho/shared`
 * (`ADMIN_EMAILS`), uma cópia só — a API promove os mesmos e-mails a ADMIN no
 * login, então cliente e servidor não podem mais discordar sobre quem é dono.
 */
export const AUTHORIZED_EMAILS = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  return ehEmailAdmin(email);
}

/** True when the signed-in user may see/use the management tabs. */
export function useIsAuthorized(): boolean {
  const { user, profile } = useAuthUser();
  // Central-API role (if ever available) OR the local email allow-list.
  const role = profile?.role;
  return role === 'ADMIN' || role === 'MODERATOR' || isAuthorizedEmail(user?.email);
}
