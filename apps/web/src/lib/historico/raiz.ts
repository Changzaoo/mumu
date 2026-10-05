/**
 * A RAIZ DO APP É A HOME.
 *
 * Quem abre o radinho direto numa página de dentro (link compartilhado, atalho,
 * notificação) tem UMA entrada de histórico: o primeiro "voltar" fecharia o app
 * de surpresa — com música tocando. Aqui a Home é posta por baixo: `replaceState`
 * transforma a entrada atual em `/` e uma entrada nova, com a URL de verdade,
 * vai por cima. Resultado: voltar leva à Home; voltar de novo, estando na Home,
 * deixa o sistema agir (o app vai para segundo plano; a música segue).
 *
 * Só vale para o APP (Capacitor ou PWA instalado). Numa aba comum do navegador
 * o "voltar" devolve a pessoa a quem mandou o link (WhatsApp, buscador), e
 * interceptar isso seria sequestrar a navegação dela.
 *
 * Roda ANTES de o router ser criado: ele lê a URL e o `idx` na criação.
 * Só atua numa entrada nova (`history.state` sem `idx`): recarregar no meio da
 * sessão não empilha Home de novo.
 */

/** Telas de um propósito só: não faz sentido "voltar" delas para a Home. */
const SEM_HOME_POR_BAIXO = ['/login', '/onboarding', '/receber', '/conectar-spotify'];

export function ehApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  if (/RadinhoApp\//.test(navigator.userAgent)) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export function garantirHomePorBaixo(): void {
  if (typeof window === 'undefined' || !ehApp()) return;
  const { pathname, search, hash } = window.location;
  if (pathname === '/') return;
  if (SEM_HOME_POR_BAIXO.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
  const estado = window.history.state as { idx?: unknown } | null;
  if (estado && typeof estado.idx === 'number') return; // entrada já conhecida
  try {
    const chave = () => Math.random().toString(36).slice(2, 10);
    const destino = `${pathname}${search}${hash}`;
    window.history.replaceState({ usr: null, key: chave(), idx: 0 }, '', '/');
    window.history.pushState({ usr: null, key: chave(), idx: 1 }, '', destino);
  } catch {
    /* sem History API: o voltar segue o padrão */
  }
}
