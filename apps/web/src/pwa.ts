/**
 * PWA auto-updater — mantém TODO usuário na versão nova, sem ninguém mexer.
 *
 * O SW é `autoUpdate` (ver vite.config): quando o navegador baixa um worker
 * novo, ele PULA A ESPERA (`skipWaiting`) e ASSUME as abas abertas
 * (`clientsClaim`). No instante em que assume, o evento `controllerchange`
 * dispara — e é aqui que a página se recarrega sozinha para pegar o bundle novo.
 *
 * A versão anterior ("prompt": avisa e espera pausar) foi o que deixou o menu e
 * outros consertos presos no bundle velho: quem ouve música o tempo todo nunca
 * "pausava", e não dá para pedir a cada usuário que limpe o cache na mão.
 *
 * Preserva a reprodução: se a música estava tocando, grava a retomada TOCANDO
 * antes de recarregar (ver `prepararRetomadaTocando`), então a faixa volta do
 * ponto exato assim que a página sobe de novo.
 */
import { registerSW } from 'virtual:pwa-register';
import { prepararRetomadaTocando, usePlayerStore } from '@/stores/playerStore';

export function initPwaUpdater(): void {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    // Só é ATUALIZAÇÃO se já havia um worker no controle. Na primeira visita
    // (sem controller) o `clientsClaim` também dispara `controllerchange`, e
    // recarregar ali seria um refresh à toa logo na abertura.
    const tinhaControle = Boolean(navigator.serviceWorker.controller);
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando || !tinhaControle) return;
      recarregando = true;
      // A música volta de onde estava — inclusive com a tela apagada.
      if (usePlayerStore.getState().isPlaying) prepararRetomadaTocando();
      window.location.reload();
    });
  }

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Procura versão nova com frequência: na carga, a cada 60s, e sempre que
      // o app recupera foco / visibilidade / rede. Assim a atualização chega
      // rápido sem depender de o usuário fechar o app.
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
  });
}
