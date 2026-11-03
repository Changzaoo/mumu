/**
 * Os endereços do radinho — todos sob radinho.online.
 *
 * Até outubro de 2026 a API e o importador moravam em `*.nexusholding.xyz`, e
 * esses endereços ficaram GRAVADOS: na `remoteUrl` de cada faixa do acervo, na
 * fila salva, na biblioteca de cada aparelho. O banco é migrado no servidor,
 * mas o que já está num aparelho só muda quando ele sincroniza — então toda URL
 * que vai tocar passa por `migrarDominio` antes.
 */

export const IMPORTADOR = 'https://importer.radinho.online';
export const API_ORIGEM = 'https://api.radinho.online';
/**
 * A borda do GitHub (infra/cdn/github-worker): toca a cópia do cofre, serve o
 * relógio da letra pré-computado e o ESPELHO do acervo (`/acervo`) — é o que
 * mantém o app de pé quando o servidor da API e o importador caem.
 */
export const BORDA_DO_GITHUB = 'https://musicas.radinho.online';
/**
 * Importadores de RESERVA (nuvem), na ordem de tentativa, para quando o
 * principal não responde: o médico (telemetry/medico.ts) sonda o `/health` de
 * cada um e o app passa a falar com o primeiro que responder, até o principal
 * voltar. `VITE_IMPORTADOR_RESERVA` (csv) manda no lugar da lista padrão; o
 * padrão é o serviço do Render descrito em render.yaml.
 */
export const IMPORTADORES_RESERVA: readonly string[] = (
  (import.meta.env.VITE_IMPORTADOR_RESERVA as string | undefined) ??
  'https://radinho-importador.onrender.com'
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter((s) => /^https?:\/\//.test(s));

const ANTIGOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^https?:\/\/importer\.nexusholding\.xyz(?=[/?#]|$)/i, IMPORTADOR],
  [/^https?:\/\/aurial-api\.nexusholding\.xyz(?=[/?#]|$)/i, API_ORIGEM],
];

/** A mesma URL no domínio atual; qualquer outra volta intacta. */
export function migrarDominio(url: string): string;
export function migrarDominio(url: string | null | undefined): string | null | undefined;
export function migrarDominio(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  for (const [antigo, novo] of ANTIGOS) {
    if (antigo.test(url)) return url.replace(antigo, novo);
  }
  return url;
}
