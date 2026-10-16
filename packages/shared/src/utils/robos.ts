/**
 * ROBÔ NÃO É VISITANTE — e a telemetria contava cada um como uma pessoa nova.
 *
 * O Googlebot (e o Bingbot, e outros) RODA o JavaScript do site para indexar,
 * e começa cada página com o armazenamento zerado: um `deviceId` novo por
 * página rastreada. Com o sitemap levando o robô a centenas de páginas, o
 * painel enchia de "Usuário · Outro · Chrome" com 1 sessão e 0 plays — e essas
 * linhas, por serem as mais recentes, empurravam as contas de verdade para fora
 * do limite da listagem.
 *
 * Uma regra só, aqui, porque os DOIS lados precisam dela: o app para nem
 * começar a medir, e a API para não gravar quando o cliente não for o nosso.
 */

/** Palavras que só aparecem no user-agent de robôs, rastreadores e automação. */
const ROBO =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|facebookexternalhit|facebookcatalog|embedly|^whatsapp|python|curl\/|wget|httpclient|okhttp|phantomjs|selenium|puppeteer|playwright|google-|mediapartners|feedfetcher|yandex|baidu|semrush|ahrefs|petalsearch|bytespider|gptbot|chatgpt|claude|perplexity|ccbot/i;

/**
 * Navegador de verdade SEMPRE diz o sistema em que roda. O Googlebot de desktop
 * e os que o imitam mandam `Chrome/…` sem sistema nenhum — era exatamente isso
 * que o painel exibia como "Outro · Chrome".
 */
const SISTEMA = /windows|macintosh|mac os|linux|android|iphone|ipad|ipod|cros|x11|fuchsia/i;

/**
 * O user-agent é de robô / automação?
 *
 * Vazio NÃO é robô: sem cabeçalho não há o que julgar, e recusar aí derrubaria
 * clientes legítimos que não o mandam (testes, ferramentas internas).
 */
export function ehRobo(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return false;
  // "CUBOT" é marca de celular Android, não robô — sai antes da regra do "bot".
  const semMarcas = ua.replace(/cubot/gi, '');
  if (ROBO.test(semMarcas)) return true;
  return /Chrome\//.test(ua) && !SISTEMA.test(ua);
}
