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
