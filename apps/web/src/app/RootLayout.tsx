import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useSleepTimer } from '@/hooks/useSleepTimer';
import { CommandPalette } from '@/app/CommandPalette';
import { aplicarSeo, seoDaRota } from '@/lib/seo';

/**
 * Root route element — wraps EVERYTHING (shell + /login) with the global
 * hooks and the ⌘K palette, which need router context.
 */
export function RootLayout() {
  useKeyboardShortcuts();
  useMediaSession();
  useSleepTimer();

  // Título, descrição e canonical de CADA rota, num lugar só — ver lib/seo.
  const { pathname } = useLocation();
  useEffect(() => aplicarSeo(seoDaRota(pathname)), [pathname]);

  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}
