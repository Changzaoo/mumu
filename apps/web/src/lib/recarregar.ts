/**
 * RECARREGAR SEM PERDER A MÚSICA — o único caminho de recarga do app.
 *
 * Nasceu no atualizador do PWA (src/pwa.ts) e foi trazido para cá quando o
 * "puxar para recarregar" apareceu: as duas recargas precisam do mesmo cuidado,
 * e duas cópias dele divergiriam na primeira correção.
 *
 *  - a música volta de onde estava, TOCANDO se estava tocando
 *    (`prepararRetomadaTocando`; parada, a retomada comum já a devolve pausada);
 *  - a tela volta como estava: player expandido, letra aberta, fila
 *    (`guardarTelaParaRecarregar`).
 */
import { prepararRetomadaTocando, usePlayerStore } from '@/stores/playerStore';
import { guardarTelaParaRecarregar } from '@/stores/uiStore';

export function recarregarPreservandoMusica(): void {
  if (usePlayerStore.getState().isPlaying) prepararRetomadaTocando();
  guardarTelaParaRecarregar();
  window.location.reload();
}
