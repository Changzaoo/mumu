/**
 * Quais hosts um worker pode consultar por conta do catálogo.
 *
 * O `remoteUrl` do acervo vem de dados que contas gravam; sem esta trava, um
 * worker faria `fetch` em qualquer endereço (SSRF: rede interna, metadados da
 * nuvem). Só o cofre do importador — o endereço público, o interno e os
 * domínios oficiais — é consultado.
 */
import { env } from '../config/index.js';

const HOSTS_FIXOS = ['musicas.radinho.online', 'importer.radinho.online'];

function hostDe(valor: string | undefined | null): string | null {
  if (!valor) return null;
  try {
    return new URL(valor).host.toLowerCase();
  } catch {
    return null;
  }
}

/** `true` quando a URL é http(s) e o host é um dos do cofre. */
export function hostConfiavel(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const e = env as Record<string, unknown>;
  const permitidos = new Set<string>(HOSTS_FIXOS);
  for (const v of [e.IMPORTER_PUBLIC_URL, e.IMPORTER_URL]) {
    const h = hostDe(typeof v === 'string' ? v : null);
    if (h) permitidos.add(h);
  }
  return permitidos.has(u.host.toLowerCase());
}
