/**
 * CDN DE ÁUDIO — de qual borda tocar a cópia do cofre.
 *
 * A cópia (`<importador>/blob/<id>?k=`) tem o MESMO caminho em qualquer nó de
 * borda (infra/cdn/edge): trocar só a origem da URL já a faz passar pelo cache.
 * A borda de cada faixa sai de um hash de rendezvous (HRW) sobre o caminho:
 * todos os ouvintes da mesma faixa caem no mesmo nó — é isso que faz o cache
 * ficar quente —, e um nó que sai do ar só redistribui as faixas DELE.
 *
 * A origem fica sempre por último na lista: borda nenhuma é ponto único de
 * falha. E só a URL da origem é a `remoteUrl` gravada, então um 404 de borda
 * nunca apaga a cópia (`reportDeadRemote` compara com ela).
 */

const FORA_MS = 60_000;
const COPIA_DO_COFRE = /^\/blob\/[^/?]+$/;

function lerBordas(): string[] {
  const bruto = (import.meta.env.VITE_AUDIO_CDN ?? '') as string;
  return bruto
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\//.test(s));
}

const bordasPadrao = lerBordas();
/** borda → até quando fica de fora (epoch ms). */
const foraAte = new Map<string, number>();

/** FNV-1a 32 bits — estável entre sessões e aparelhos, que é o que importa. */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Finalizador do murmur3: sem ele, chaves que só diferem no fim (f1, f2…)
  // mal mexem nos bits altos e caem quase todas na mesma borda.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Bordas em ordem de preferência para `chave` (rendezvous hashing). */
export function ordenarBordas(chave: string, bordas: readonly string[]): string[] {
  return [...bordas].sort((a, b) => hash(`${b}|${chave}`) - hash(`${a}|${chave}`));
}

/** Anota que a borda desta URL falhou: fica de fora por um minuto. */
export function marcarBordaFora(url: string, agora = Date.now()): void {
  try {
    foraAte.set(new URL(url).origin, agora + FORA_MS);
  } catch {
    /* não é URL */
  }
}

/**
 * Todas as formas de tocar a cópia `remote`, da preferida à origem. Para
 * qualquer outra URL (stream ao vivo, Audius, rádio) devolve só ela mesma.
 */
export function candidatosDaCopia(
  remote: string,
  bordas: readonly string[] = bordasPadrao,
  agora = Date.now(),
): string[] {
  if (!bordas.length) return [remote];
  let u: URL;
  try {
    u = new URL(remote);
  } catch {
    return [remote];
  }
  if (!COPIA_DO_COFRE.test(u.pathname) || !u.searchParams.get('k')) return [remote];
  const caminho = `${u.pathname}${u.search}`;
  const vivas = ordenarBordas(u.pathname, bordas).filter(
    (b) => b !== u.origin && (foraAte.get(b) ?? 0) <= agora,
  );
  return [...vivas.map((b) => `${b}${caminho}`), remote];
}

/** A URL por onde começar a tocar a cópia. */
export function viaCdn(remote: string): string {
  return candidatosDaCopia(remote)[0] ?? remote;
}
