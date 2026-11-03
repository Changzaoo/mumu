/** Parâmetros de query que carregam credencial e nunca podem ir para o log. */
const PARAMETROS_SECRETOS = new Set(['token', 'k', 'key', 'authorization']);

/** Troca o valor de `?token=`, `?k=`, `?key=`, `?authorization=` por `[redigido]`. Pura. */
export function urlSemSegredos(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash === -1 ? undefined : hash);
  const resto = hash === -1 ? '' : url.slice(hash);
  const nova = query
    .split('&')
    .map((par) => {
      const eq = par.indexOf('=');
      const nome = eq === -1 ? par : par.slice(0, eq);
      let decodificado = nome;
      try {
        decodificado = decodeURIComponent(nome.replace(/\+/g, ' '));
      } catch {
        /* nome malformado: compara cru */
      }
      return PARAMETROS_SECRETOS.has(decodificado.toLowerCase()) && eq !== -1
        ? `${nome}=[redigido]`
        : par;
    })
    .join('&');
  return `${url.slice(0, q + 1)}${nova}${resto}`;
}
