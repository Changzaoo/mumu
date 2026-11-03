/**
 * PWA auto-updater — mantém TODO usuário na versão nova, sem ninguém mexer,
 * e SEM travar o app no caminho.
 *
 * Como funciona (ver vite.config, `registerType: 'prompt'`):
 *   1. o navegador baixa o worker novo e ele fica EM ESPERA (`onNeedRefresh`);
 *   2. quando a pessoa sossega (sem toque, tecla ou rolagem por `SOSSEGO_MS`)
 *      e não está ouvindo com a tela apagada, a página manda o worker novo
 *      pular a espera (`updateSW` → SKIP_WAITING);
 *   3. o worker assume as abas (`clientsClaim`), `controllerchange` dispara,
 *      e a página se recarrega preservando a música e a tela.
 *
 * POR QUE A ESPERA IMPORTA. O desenho anterior era `autoUpdate`: o worker novo
 * ativava sozinho na hora do deploy e APAGAVA o precache da versão antiga
 * enquanto a página velha continuava aberta esperando "sossego". A próxima
 * tela que a pessoa tocava pedia um chunk que já não existia em lugar nenhum:
 * a URL mudava, nada pintava, o vigia do menu recarregava, e a recarga
 * encadeava outras. No iPhone do dono (03/11/2026) foram quatro boots em 30 s
 * na hora do deploy — "o app trava e reinicia". Com o worker em espera, o
 * precache antigo fica inteiro até a recarga, que é uma só.
 *
 * E o que o `prompt` antigo (2026-10) tinha de errado não volta: não se espera
 * a música PARAR, só a pessoa sossegar — quem ouve o dia inteiro recebe a
 * versão nova no primeiro intervalo de seis segundos sem mexer na tela.
 */
import { registerSW } from 'virtual:pwa-register';
import { recarregarPreservandoMusica } from '@/lib/recarregar';
import { anotar } from '@/lib/telemetry/diario';
import { usePlayerStore } from '@/stores/playerStore';

/** Quanto tempo sem toque, tecla ou rolagem antes de recarregar para a versão nova. */
const SOSSEGO_MS = 6_000;

/**
 * O cache de capas antigo (`aurial-images`) guardava respostas opacas — 404,
 * JSON de erro e página de login de Wi-Fi servidos como "capa" por 30 dias, e
 * ~7 MB de cota cada. A regra nova grava em `aurial-images-v2` só o que é
 * imagem de verdade (ver vite.config.ts); o velho é apagado uma vez, aqui,
 * porque o Workbox só limpa o precache antigo, não os caches de runtime.
 */
function apagarCacheDeCapasAntigo(): void {
  if (typeof caches === 'undefined') return;
  void caches.delete('aurial-images').catch(() => undefined);
}

export function initPwaUpdater(): void {
  apagarCacheDeCapasAntigo();
  /** Manda o worker em espera assumir (SKIP_WAITING). Preenchido por registerSW. */
  let pedirTroca: (() => void) | null = null;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    // Só é ATUALIZAÇÃO se já havia um worker no controle. Na primeira visita
    // (sem controller) o `clientsClaim` também dispara `controllerchange`, e
    // recarregar ali seria um refresh à toa logo na abertura.
    const tinhaControle = Boolean(navigator.serviceWorker.controller);
    let recarregando = false;
    // NUNCA NO MEIO DE UM GESTO. "O app fica reiniciando do nada" (dono,
    // 27/10/2026): cada versão publicada recarregava a página na hora, ainda
    // que a pessoa estivesse digitando na busca ou rolando a lista — e a
    // abertura inteira tocava de novo. Agora a recarga espera `SOSSEGO_MS`
    // sem toque, tecla nem rolagem; a abertura não repete (AberturaAnimada
    // guarda a sessão) e a música e a tela voltam como estavam: a troca de
    // versão vira um piscar.
    let ultimoGesto = 0;
    for (const tipo of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
      window.addEventListener(
        tipo,
        () => {
          ultimoGesto = Date.now();
        },
        { capture: true, passive: true },
      );
    }
    const quandoSossegar = (fazer: () => void): void => {
      const falta = ultimoGesto + SOSSEGO_MS - Date.now();
      if (falta <= 0) {
        fazer();
        return;
      }
      window.setTimeout(() => quandoSossegar(fazer), falta);
    };
    const recarregar = (): void => {
      if (recarregando) return;
      recarregando = true;
      quandoSossegar(() => {
        anotar('app', 'atualizar', 'versão nova: recarregando');
        // A música volta de onde estava, e a tela como estava (lib/recarregar).
        recarregarPreservandoMusica();
      });
    };
    // NUNCA COM A TELA APAGADA E A MÚSICA TOCANDO. Recarregar ali matava a
    // música: a página nova sobe sem gesto nenhum da pessoa, e o navegador
    // (Android e iPhone) não deixa ela voltar a tocar em segundo plano. O
    // bundle antigo continua funcionando perfeitamente; a versão nova entra
    // quando a tela acender ou quando a música parar — o que vier primeiro.
    const tocandoNoEscuro = (): boolean => document.hidden && usePlayerStore.getState().isPlaying;
    const quandoDerParaTrocar = (fazer: () => void): void => {
      if (!tocandoNoEscuro()) {
        fazer();
        return;
      }
      const tentar = (): void => {
        if (tocandoNoEscuro()) return;
        document.removeEventListener('visibilitychange', tentar);
        pararDeOuvir();
        fazer();
      };
      const pararDeOuvir = usePlayerStore.subscribe((s, antes) => {
        if (s.isPlaying !== antes.isPlaying) tentar();
      });
      document.addEventListener('visibilitychange', tentar);
    };
    let trocaPedida = false;
    // O worker novo está EM ESPERA: só o mandamos assumir quando a recarga
    // pode acontecer em seguida (sossego, tela acesa ou música parada). Até
    // lá o precache antigo fica inteiro e toda tela continua abrindo.
    pedirTroca = (): void => {
      if (trocaPedida) return;
      trocaPedida = true;
      quandoDerParaTrocar(() =>
        quandoSossegar(() => {
          anotar('app', 'atualizar', 'versão nova: ativando o worker');
          void updateSW(false);
        }),
      );
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando || !tinhaControle) return;
      // Assumiu (porque pedimos, ou porque outra aba pediu): recarrega —
      // o precache antigo já se foi, e a página velha não pode seguir sem ele.
      quandoDerParaTrocar(recarregar);
    });
  }

  const updateSW = registerSW({
    immediate: true,
    // Worker novo baixado e em espera (registerType 'prompt').
    onNeedRefresh() {
      pedirTroca?.();
    },
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
