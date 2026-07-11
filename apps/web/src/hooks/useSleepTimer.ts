import { useEffect } from 'react';
import { toast } from 'sonner';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Pauses playback after `settings.sleepTimerMinutes`. Setting a new value
 * restarts the countdown; null cancels it. Mount once (RootLayout).
 */
export function useSleepTimer(): void {
  const minutes = useSettingsStore((s) => s.sleepTimerMinutes);

  useEffect(() => {
    if (!minutes) return;
    const timer = setTimeout(
      () => {
        usePlayerStore.getState().pause();
        useSettingsStore.getState().setSleepTimer(null);
        toast('Timer de sono encerrado. Boa noite.');
      },
      minutes * 60 * 1000,
    );
    return () => clearTimeout(timer);
  }, [minutes]);
}
