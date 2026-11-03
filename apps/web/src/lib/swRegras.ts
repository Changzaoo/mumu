/**
 * Quais respostas da API o service worker pode guardar.
 *
 * A regra antiga cobria `/api/v1/` inteiro, com cache por URL: `/me/*`, `/admin/*`
 * e `/me/colecoes/*` (dados da conta) ficavam 24 h no cache `aurial-api` e
 * sobreviviam ao logout. Num aparelho compartilhado, o próximo usuário recebia
 * os dados do anterior quando a rede demorava mais que o timeout.
 *
 * Agora só entra o que é PÚBLICO (igual para qualquer pessoa). Lista de
 * primeiro segmento sob `/api/v1/`, conferida com os mounts de
 * `apps/api/src/app.ts`. Fora de propósito: `me`, `admin`, `auth`, `telemetria`,
 * `jornada`, `home` (exige login), `stream` (áudio), `tracks`/`playlists`/`recs`
 * (podem variar por usuário), `imports`, `uploads`.
 *
 * ESPELHO: `vite.config.ts` duplica esta lista (o config não importa do src).
 * Ao mudar aqui, mude lá.
 */
export const PREFIXOS_PUBLICOS_DA_API = [
  'catalogo',
  'em-alta',
  'artists',
  'albums',
  'radios',
  'podcasts',
  'mundo',
  'categorias',
] as const;

export function ehCacheavelDaApi(url: URL): boolean {
  const marca = '/api/v1/';
  const i = url.pathname.indexOf(marca);
  if (i < 0) return false;
  const primeiro = url.pathname.slice(i + marca.length).split('/')[0] ?? '';
  return (PREFIXOS_PUBLICOS_DA_API as readonly string[]).includes(primeiro);
}
