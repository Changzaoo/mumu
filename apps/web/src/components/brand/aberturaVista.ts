/**
 * A ABERTURA JÁ FOI VISTA NESTA SESSÃO?
 *
 * A abertura (AberturaAnimada) é a tela de carregamento do app subindo do
 * zero. Uma recarga no meio do uso — a versão nova chegando (src/pwa.ts), o
 * "puxar para recarregar" — não é um app subindo do zero: é o mesmo app, a
 * mesma pessoa, segundos depois. Repetir a cena ali satura (pedido do dono,
 * 27/10/2026). O `sessionStorage` dura exatamente o que a sessão dura: some
 * quando a aba fecha ou o app é fechado, e sobrevive a qualquer recarga.
 *
 * Em arquivo próprio porque o componente só pode exportar componentes (o
 * fast refresh do Vite exige).
 */
const CHAVE_VISTA = 'radinho:abertura-vista';

export function aberturaJaVista(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_VISTA) === '1';
  } catch {
    return false;
  }
}

export function marcarAberturaVista(): void {
  try {
    window.sessionStorage.setItem(CHAVE_VISTA, '1');
  } catch {
    /* sem sessionStorage: a abertura aparece de novo na recarga, como antes */
  }
}
