import { Outlet } from 'react-router';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useSleepTimer } from '@/hooks/useSleepTimer';
import { CommandPalette } from '@/app/CommandPalette';

/**
 * Root route element — wraps EVERYTHING (shell + /login) with the global
 * hooks and the ⌘K palette, which need router context.
 */
export function RootLayout() {
  useKeyboardShortcuts();
  useMediaSession();
  useSleepTimer();

  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}
