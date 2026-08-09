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
import { prepararRetomadaTocando, usePlayerStore } from '@/stores/playerStore';
import { pushNotification } from '@/stores/notificationsStore';

export function initPwaUpdater(): void {
  /**
   * Aplica a versão nova recarregando a página, e — se a música estava tocando —
   * grava a retomada TOCANDO antes, para o boot seguinte continuar de onde
   * parou. É o que permite atualizar sem esperar o usuário pausar (o que, para
   * quem ouve música o tempo todo, era "nunca") e sem perder a reprodução.
   */
  const aplicar = (updateSW: (reload?: boolean) => Promise<void>): void => {
    if (usePlayerStore.getState().isPlaying) prepararRetomadaTocando();
    void updateSW(true);
  };

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
      // VERSÃO NOVA PRONTA — aplica sozinha, sem esperar o usuário pausar.
      //
      // Antes, com a música no ar, só avisava e esperava pausar; para quem ouve
      // o tempo todo isso era "nunca", e o conserto não chegava por horas. Agora:
      //  • tocando ou em segundo plano (tela apagada, outro app) → recarrega já.
      //    Se estava tocando, `aplicar` guarda a retomada e a música volta de
      //    onde estava — inclusive com a tela desligada.
      //  • parado e em primeiro plano → NÃO interrompe o uso ativo; espera o
      //    próximo instante seguro: a aba ir para segundo plano ou a música
      //    começar. Aí aplica.
      const tentar = (): boolean => {
        if (usePlayerStore.getState().isPlaying || document.hidden) {
          aplicar(updateSW);
          return true;
        }
        return false;
      };
      if (tentar()) return;

      const aoEsconder = (): void => {
        if (document.hidden && tentar()) desarmar();
      };
      const desarmar = (): void => {
        document.removeEventListener('visibilitychange', aoEsconder);
        pararDeOuvir();
      };
      const pararDeOuvir = usePlayerStore.subscribe(() => {
        if (usePlayerStore.getState().isPlaying && tentar()) desarmar();
      });
      document.addEventListener('visibilitychange', aoEsconder);

      pushNotification({
        type: 'update',
        title: 'Nova versão disponível',
        body: 'Será aplicada ao trocar de tela ou tocar música.',
      });
    },
  });
}
