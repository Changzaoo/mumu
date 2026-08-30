/**
 * De onde o app fala com a API do Aurial — UM lugar só.
 *
 * POR QUE NÃO É MAIS `/api/v1`. O caminho relativo saía pelo rewrite da Vercel
 * (`/api/:path*` → `aurial-api.nexusholding.xyz`, ver `vercel.json`). Isso faz
 * o pedido partir de um IP de datacenter da Vercel — e o Cloudflare que protege
 * o servidor responde a ESSE salto com a página de desafio "Just a moment...":
 * HTTP 403, corpo HTML, sem CORS. Como o acervo INTEIRO chega por um único
 * `GET /catalogo`, o 403 deixava a Home sem UMA faixa sequer: nada para listar
 * e, portanto, nada para tocar. Medido no ar, de dentro do próprio site: pelo
 * rewrite, 403 com "Just a moment..."; do navegador direto ao servidor, 200 com
 * as 5.053 entradas do acervo.
 *
 * O navegador não toma desafio: chega com IP e cabeçalhos de gente de verdade,
 * e a API já devolve `Access-Control-Allow-Origin` para as origens do app
 * (allowlist em `apps/api/src/app.ts`). É exatamente a saída que
 * `lib/local/importerHelper.ts` já tinha adotado pelo MESMO motivo — ver o
 * comentário do `DEFAULT_HELPER_URL`. O `/api` é que tinha ficado para trás.
 *
 * O rewrite continua em `vercel.json` de propósito: é o caminho sem CORS do dia
 * em que o desafio sair da frente, e é o que serve o proxy do Vite em dev.
 */

/** Servidor da API, alcançável direto do navegador (CORS liberado por origem). */
const API_DIRETA = 'https://aurial-api.nexusholding.xyz/api/v1';

/** Mesma origem — proxy do Vite em dev, rewrite da Vercel em produção. */
const API_MESMA_ORIGEM = '/api/v1';

/** Máquina do desenvolvedor: é lá que o proxy do Vite existe. */
function ehMaquinaLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolverBase(): string {
  const configurada = import.meta.env.VITE_API_URL?.trim();
  /**
   * SÓ URL ABSOLUTA MANDA AQUI, e a distinção não é preciosismo.
   *
   * `VITE_API_URL=/api/v1` está gravado no `.env.production.local` desta
   * máquina (e pode estar nas variáveis da Vercel) desde quando não havia
   * servidor central. Um valor relativo não NOMEIA servidor nenhum: ele diz
   * "a origem deste site" — que em produção é o salto pela Vercel, exatamente
   * o que toma 403. Obedecer a isso seria embarcar o conserto e não consertar.
   *
   * Uma URL absoluta é um endereço de verdade, e essa continua mandando em
   * tudo: é assim que o dev aponta para o `localhost:4000` e que qualquer
   * outro deploy aponta para o servidor dele.
   */
  if (configurada && /^https?:\/\//i.test(configurada)) return configurada.replace(/\/$/, '');
  // Sem `window` (teste, worker, pré-render) o caminho relativo é o único
  // palpite honesto — não há origem para comparar.
  if (typeof window === 'undefined' || !window.location?.hostname) return API_MESMA_ORIGEM;
  return ehMaquinaLocal(window.location.hostname) ? API_MESMA_ORIGEM : API_DIRETA;
}

/** Base de TODA chamada à API (sem barra no fim). */
export const API_BASE_URL = resolverBase();
