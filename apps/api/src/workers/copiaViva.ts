/**
 * Veredito de uma cópia `/blob/<id>?k=`: a BORDA primeiro, a origem depois.
 *
 * Em 28/10/2026 o importador mudou de máquina com um cofre novo e a origem
 * passou a responder 404 para faixas cujo áudio continua vivo na borda do
 * GitHub (`AUDIO_BORDA_URL`). Os agentes tratavam esse 404 como morte e
 * apagaram o `remoteUrl` de 5,6 mil faixas. Agora:
 *
 *   borda 2xx/3xx            → viva
 *   borda 404 → consulta a origem: viva → viva; 404 → MORTA; resto → incerta
 *   borda qualquer outra     → incerta (403, 416, 5xx, rede, timeout)
 *
 * "Morta" só quando borda E origem dizem 404.
 */
import { env } from '../config/index.js';

export type Veredito = 'viva' | 'morta' | 'incerta';
export type Resultado<T> = T | 'morta' | 'incerta';

const TIMEOUT_MS = 10_000;

/** 404 é morte; 2xx/3xx é vida; o resto não prova nada. */
export function vereditoDeStatus(status: number): Veredito {
  if (status === 404) return 'morta';
  if (status >= 200 && status < 400) return 'viva';
  return 'incerta';
}

/** Base da borda (sem barra final) ou `null` quando desligada/inválida. */
export function bordaBase(): string | null {
  const v = (env as Record<string, unknown>).AUDIO_BORDA_URL;
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * A mesma cópia vista pela borda: `<borda>/blob/<id>?k=<k>`. `null` quando a
 * URL não é um `/blob/<id>` com `k`, quando a borda está desligada ou quando
 * a própria URL já é da borda (não adianta perguntar duas vezes).
 */
export function urlNaBorda(remoteUrl: string): string | null {
  const base = bordaBase();
  if (!base) return null;
  let u: URL;
  try {
    u = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (!u.pathname.startsWith('/blob/') || u.pathname.length <= '/blob/'.length) return null;
  const k = u.searchParams.get('k');
  if (!k) return null;
  if (u.origin === base) return null;
  const id = u.pathname.slice('/blob/'.length);
  return `${base}/blob/${id}?k=${encodeURIComponent(k)}`;
}

/**
 * Aplica `ler` à borda e, só se ela disser 404, à origem. `origem` é o
 * endereço por onde este servidor alcança a cópia (pode ser o interno).
 */
export async function lerBordaDepoisOrigem<T>(
  remoteUrl: string,
  origem: string | null,
  ler: (url: string) => Promise<Resultado<T>>,
): Promise<Resultado<T>> {
  const borda = urlNaBorda(remoteUrl);
  if (borda) {
    const rb = await ler(borda);
    if (rb !== 'morta') return rb;
  }
  if (!origem) return 'incerta';
  return ler(origem);
}

/** GET Range 0-0: pergunta se a cópia serve, sem baixar a música. */
export async function sondar(url: string): Promise<Resultado<true>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    void res.body?.cancel().catch(() => undefined);
    const v = vereditoDeStatus(res.status);
    return v === 'viva' ? true : v;
  } catch {
    return 'incerta';
  } finally {
    clearTimeout(timer);
  }
}

/** Veredito completo de uma `remoteUrl` (borda, depois origem). */
export async function vereditoDaCopia(remoteUrl: string, origem = remoteUrl): Promise<Veredito> {
  const r = await lerBordaDepoisOrigem<true>(remoteUrl, origem, sondar);
  return r === true ? 'viva' : r;
}
