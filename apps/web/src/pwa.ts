/**
 * PWA auto-updater — keeps installed apps from serving a stale build.
 *
 * The service worker precaches the app shell, so without this an installed PWA
 * can keep showing an old version long after a deploy. Here we:
 *   • check for a new build aggressively (on load, on a 60s interval, and every
 *     time the app regains focus / visibility / network),
 *   • apply it immediately when nothing is playing (seamless on launch),
 *   • otherwise show a tap-to-update toast and apply on the next launch,
 * so we never cut the music out from under the user to reload.
 */
import { registerSW } from 'virtual:pwa-register';
import { usePlayerStore } from '@/stores/playerStore';
import { pushNotification } from '@/stores/notificationsStore';

export function initPwaUpdater(): void {
  let toastShown = false;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = (): void => {
        void registration.update().catch(() => undefined);
      };
      setInterval(check, 60_000);
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
    },
    onNeedRefresh() {
      // A new version is downloaded and waiting to activate.
      if (!usePlayerStore.getState().isPlaying) {
        void updateSW(true); // activate the new worker and reload — safe when idle
        return;
      }
      if (toastShown) return;
      toastShown = true;
      pushNotification({
        type: 'update',
        title: 'Nova versão disponível',
        body: 'Será aplicada ao pausar ou reabrir o app.',
      });
      void import('sonner').then(({ toast }) => {
        toast('Nova versão disponível', {
          duration: Infinity,
          action: { label: 'Atualizar', onClick: () => void updateSW(true) },
        });
      });
    },
  });
}
