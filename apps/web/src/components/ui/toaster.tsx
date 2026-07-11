import { Toaster as SonnerToaster } from 'sonner';
import { useSettingsStore, resolveTheme } from '@/stores/settingsStore';

/** Theme-aware sonner host — mount once in App. */
export function Toaster() {
  const theme = useSettingsStore((s) => s.theme);
  return (
    <SonnerToaster
      theme={resolveTheme(theme)}
      position="bottom-right"
      offset={104} /* keep clear of the PlayerBar */
      toastOptions={{
        classNames: {
          toast: 'glass !rounded-lg !text-fg',
          description: '!text-fg-muted',
          actionButton: '!bg-accent !text-accent-fg',
        },
      }}
    />
  );
}
