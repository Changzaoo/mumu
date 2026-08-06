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
  /** Já há um vigia esperando a música parar para aplicar a versão nova? */
  let esperandoPausa = false;

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
      // A new version is downloaded and waiting to activate. Auto-apply (which
      // reloads) whenever music isn't actively PLAYING — this keeps mobile
      // up to date on launch (a persisted, paused track would otherwise block
      // updates forever) while never cutting off audio that's playing.
      if (!usePlayerStore.getState().isPlaying) {
        void updateSW(true); // activate the new worker and reload — safe when idle
        return;
      }

      // TOCANDO: ESPERAR A MÚSICA PARAR — E DE FATO ESPERAR.
      //
      // Aqui a versão anterior só avisava e ia embora. Ninguém voltava para
      // aplicar: `onNeedRefresh` dispara UMA vez por worker novo, e `toastShown`
      // ainda garantia que nem o aviso se repetisse. Quem ouve música com o app
      // aberto — ou seja, o uso normal — ficava preso no build antigo por tempo
      // indeterminado, e só saía dali fechando o app na hora certa.
      //
      // Isso transformou uma correção já publicada em correção que não chega:
      // o erro do Firestore continuou aparecendo num aparelho cujo conserto já
      // estava no ar havia horas. Um conserto que não alcança o aparelho não é
      // um conserto.
      //
      // Agora ficamos de guarda: no instante em que a reprodução para, o worker
      // novo assume. A assinatura se desfaz sozinha ao aplicar.
      if (!esperandoPausa) {
        esperandoPausa = true;
        const parar = usePlayerStore.subscribe((estado) => {
          if (estado.isPlaying) return;
          parar();
          void updateSW(true);
        });
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
