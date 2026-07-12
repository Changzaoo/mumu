import { Toaster as SonnerToaster } from 'sonner';
import { useSettingsStore, resolveTheme } from '@/stores/settingsStore';

/** Theme-aware sonner host — mount once in App. */
export function Toaster() {
  const theme = useSettingsStore((s) => s.theme);
  return (
    <SonnerToaster
      theme={resolveTheme(theme)}
      position="bottom-right"
      offset={104} /* clear of the desktop PlayerBar */
      mobileOffset={{
        bottom: 150,
        left: 12,
        right: 12,
      }} /* clear of the mobile nav + mini-player */
      toastOptions={{
        classNames: {
          // Solid (not glass) so notifications are always readable.
          toast: '!bg-bg-elevated !border !border-border !rounded-xl !text-fg !shadow-2xl',
          description: '!text-fg-muted',
          actionButton: '!bg-accent !text-accent-fg',
        },
      }}
    />
  );
}
