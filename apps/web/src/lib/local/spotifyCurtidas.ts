/**
 * CURTIDAS DO SPOTIFY → FILA DE IMPORTAÇÃO.
 *
 * `open.spotify.com/collection/tracks` é privado: só abre com o login da
 * pessoa, e nenhum servidor nosso consegue ler. A saída é a própria pessoa
 * autorizar o app no Spotify (OAuth Authorization Code + PKCE) e o NAVEGADOR
 * dela ler `/v1/me/tracks`. PKCE é o fluxo que o Spotify indica para cliente
 * público: não existe segredo no bundle, só o client id (que é público).
 *
 * O token nunca sai deste módulo: vive em memória durante a leitura e só vai
 * para `api.spotify.com` (o `next` da paginação é conferido antes de seguir).
 * Cada curtida vira o link `https://open.spotify.com/track/<id>` — o importador
 * já sabe resolver faixa do Spotify para o áudio do YouTube.
 */

const AUTORIZAR = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const CURTIDAS = 'https://api.spotify.com/v1/me/tracks';
const ESCOPO = 'user-library-read';
const CHAVE_SESSAO = 'radinho:spotify-pkce';
const ROTA_RETORNO = '/conectar-spotify';
/** Sem timeout, uma resposta que não vem pendura a tela de retorno para sempre. */
const TIMEOUT_MS = 15_000;
/** Teto de páginas (50 cada = 10 mil curtidas): laço infinito por `next` torto não. */
const MAX_PAGINAS = 200;
const ID_FAIXA = /^[A-Za-z0-9]{22}$/;

export type MotivoErroSpotify = 'config' | 'estado' | 'negado' | 'rede';

/**
 * `rede` = o Spotify não respondeu (tente de novo); os outros são definitivos
 * até a pessoa fazer algo — a tela mostra mensagens diferentes para cada um.
 */
export class ErroSpotify extends Error {
  constructor(
    message: string,
    readonly motivo: MotivoErroSpotify,
  ) {
    super(message);
    this.name = 'ErroSpotify';
  }
}

export function spotifyClientId(): string | null {
  const id = (import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '').trim();
  return id || null;
}

export function redirectUriDoSpotify(origem = window.location.origin): string {
  return `${origem}${ROTA_RETORNO}`;
}

/**
 * No app Android a origem é a do WebView (não um https registrável no
 * Spotify): o retorno do login cairia no navegador, não no app.
 */
export function ehAppNativo(): boolean {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function aleatorio(n: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function desafioPkce(verificador: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
  return base64url(new Uint8Array(hash));
}

/** Monta o endereço de autorização e guarda verificador + state na sessão. */
export async function urlDeAutorizacao(): Promise<string> {
  const clientId = spotifyClientId();
  if (!clientId) throw new ErroSpotify('Conexão com o Spotify não configurada.', 'config');
  // 64 bytes → 86 caracteres: dentro dos 43–128 que o PKCE exige.
  const verificador = aleatorio(64);
  const state = aleatorio(16);
  sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ verificador, state }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: ESCOPO,
    redirect_uri: redirectUriDoSpotify(),
    code_challenge_method: 'S256',
    code_challenge: await desafioPkce(verificador),
    state,
  });
  return `${AUTORIZAR}?${q.toString()}`;
}

export async function conectarSpotify(): Promise<void> {
  window.location.assign(await urlDeAutorizacao());
}

async function pedir(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  tentativas = 3,
): Promise<Response> {
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ErroSpotify('O Spotify não respondeu agora. Tente de novo em instantes.', 'rede');
    }
    // 429: o Spotify diz quanto esperar. Espera curta e tenta de novo; longa
    // demais vira erro de rede (a pessoa tenta mais tarde).
    if (res.status === 429 && i < tentativas) {
      const seg = Number(res.headers.get('Retry-After')) || 2;
      if (seg > 30) break;
      await new Promise((r) => setTimeout(r, seg * 1000));
      continue;
    }
    if (res.status >= 500 && i < tentativas) continue;
    return res;
  }
  throw new ErroSpotify('O Spotify pediu para esperar. Tente de novo mais tarde.', 'rede');
}

interface PaginaDeCurtidas {
  items?: Array<{ track?: { id?: unknown; type?: unknown; is_local?: unknown } | null } | null>;
  next?: unknown;
}

/**
 * Lê TODAS as curtidas com o token (paginado de 50 em 50) → links de faixa.
 * Exportada separada para teste com fetch simulado.
 */
export async function lerCurtidas(token: string, f: typeof fetch = fetch): Promise<string[]> {
  const links: string[] = [];
  const vistos = new Set<string>();
  let url: string | null = `${CURTIDAS}?limit=50&offset=0`;
  for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina++) {
    const res = await pedir(f, url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) {
      // 403 no modo de desenvolvimento = conta fora da lista de usuários do app.
      throw new ErroSpotify(
        'O Spotify não liberou a leitura das curtidas para esta conta. Se o app do Spotify está em modo de desenvolvimento, a conta precisa estar em "User Management".',
        'negado',
      );
    }
    if (!res.ok) throw new ErroSpotify(`O Spotify recusou a leitura (${res.status}).`, 'rede');
    const json = (await res.json().catch(() => null)) as PaginaDeCurtidas | null;
    if (!json) throw new ErroSpotify('Resposta estranha do Spotify. Tente de novo.', 'rede');
    for (const item of json.items ?? []) {
      const t = item?.track;
      const id = typeof t?.id === 'string' ? t.id : '';
      // Faixa local e episódio de podcast não são música do catálogo.
      if (!ID_FAIXA.test(id) || t?.is_local === true || (t?.type && t.type !== 'track')) continue;
      if (vistos.has(id)) continue;
      vistos.add(id);
      links.push(`https://open.spotify.com/track/${id}`);
    }
    // Só segue `next` dentro da mesma API: o token não vai para outro host.
    const next = typeof json.next === 'string' ? json.next : null;
    url = next && next.startsWith(`${CURTIDAS}?`) ? next : null;
  }
  return links;
}

/** Leituras em andamento por `code`: o StrictMode monta o efeito duas vezes. */
const emAndamento = new Map<string, Promise<string[]>>();

/**
 * Volta do Spotify (`/conectar-spotify?code=…&state=…`) → links das curtidas.
 * Confere o `state` (sem ele, qualquer site poderia plantar um `code`), troca
 * o código por token e lê tudo.
 */
function lerSessaoPkce(): { verificador?: string; state?: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) ?? 'null') as {
      verificador?: string;
      state?: string;
    } | null;
  } catch {
    return null;
  }
}

export function concluirConexao(busca: string, f: typeof fetch = fetch): Promise<string[]> {
  const q = new URLSearchParams(busca);
  const code = q.get('code') ?? '';
  const existente = emAndamento.get(code);
  if (code && existente) return existente;
  const trabalho = (async () => {
    if (q.get('error')) {
      throw new ErroSpotify('Você não autorizou o acesso às curtidas no Spotify.', 'negado');
    }
    const clientId = spotifyClientId();
    if (!clientId) throw new ErroSpotify('Conexão com o Spotify não configurada.', 'config');
    const salvo = lerSessaoPkce();
    sessionStorage.removeItem(CHAVE_SESSAO); // uso único
    if (!code || !salvo?.verificador || !salvo.state || salvo.state !== q.get('state')) {
      throw new ErroSpotify(
        'A conexão expirou ou não começou aqui. Tente conectar de novo.',
        'estado',
      );
    }
    const res = await pedir(f, TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUriDoSpotify(),
        client_id: clientId,
        code_verifier: salvo.verificador,
      }).toString(),
    });
    const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    const token = typeof json?.access_token === 'string' ? json.access_token : '';
    if (!res.ok || !token) {
      if (res.status >= 500) {
        throw new ErroSpotify('O Spotify não respondeu agora. Tente de novo em instantes.', 'rede');
      }
      throw new ErroSpotify('O Spotify recusou a conexão. Tente conectar de novo.', 'estado');
    }
    return lerCurtidas(token, f);
  })();
  if (code) emAndamento.set(code, trabalho);
  return trabalho;
}
