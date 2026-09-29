/**
 * CURTIDAS DO SPOTIFY: o link `collection/tracks` é privado (recusa na hora,
 * com a saída explicada, sem ir para a fila) e o "Conectar Spotify" (PKCE)
 * lê as curtidas no navegador. Rede simulada — nada sai daqui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateImportUrl } from '@/lib/local/localLibrary';
import { ehColecaoDoSpotify } from '@/lib/local/importerHelper';
import {
  concluirConexao,
  desafioPkce,
  ErroSpotify,
  lerCurtidas,
  urlDeAutorizacao,
} from '@/lib/local/spotifyCurtidas';

const id = (n: number): string => String(n).padStart(22, 'A');

function resposta(corpo: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), { status, headers });
}

describe('link de curtidas do Spotify', () => {
  it('collection/tracks (com ou sem intl-xx) é recusado com a saída explicada', () => {
    for (const url of [
      'https://open.spotify.com/collection/tracks',
      'https://open.spotify.com/intl-pt/collection/tracks',
    ]) {
      expect(ehColecaoDoSpotify(new URL(url))).toBe(true);
      const r = validateImportUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Conectar Spotify/);
    }
    expect(ehColecaoDoSpotify(new URL('https://open.spotify.com/playlist/x'))).toBe(false);
    expect(validateImportUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      ok: true,
    });
  });
});

describe('Conectar Spotify (PKCE)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'cliente123');
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('desafio S256 do exemplo da RFC 7636', async () => {
    expect(await desafioPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('autorização pede só user-library-read, S256 e state; sem segredo', async () => {
    const u = new URL(await urlDeAutorizacao());
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('scope')).toBe('user-library-read');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe('cliente123');
    expect(u.searchParams.get('state')).toBeTruthy();
    expect(u.searchParams.has('client_secret')).toBe(false);
  });

  it('sem client id: erro de configuração (o botão mostra o passo a passo)', async () => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
    await expect(urlDeAutorizacao()).rejects.toMatchObject({ motivo: 'config' });
  });

  it('lê todas as páginas, pula faixa local/episódio/repetida e não segue next para outro host', async () => {
    const pedidos: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push(url);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tk');
      if (url.includes('offset=0')) {
        return resposta({
          items: [
            { track: { id: id(1), type: 'track' } },
            { track: { id: id(2), type: 'track', is_local: true } },
            { track: { id: id(3), type: 'episode' } },
            { track: null },
          ],
          next: 'https://api.spotify.com/v1/me/tracks?limit=50&offset=50',
        });
      }
      return resposta({
        items: [{ track: { id: id(1), type: 'track' } }, { track: { id: id(4), type: 'track' } }],
        next: 'https://evil.example/v1/me/tracks?offset=100',
      });
    });
    const links = await lerCurtidas('tk', f as unknown as typeof fetch);
    expect(links).toEqual([
      `https://open.spotify.com/track/${id(1)}`,
      `https://open.spotify.com/track/${id(4)}`,
    ]);
    expect(pedidos).toHaveLength(2);
  });

  it('falha de rede ≠ acesso negado', async () => {
    const caiu = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(lerCurtidas('tk', caiu as unknown as typeof fetch)).rejects.toMatchObject({
      motivo: 'rede',
    });
    const negado = vi.fn(async () => resposta({ error: {} }, 403));
    await expect(lerCurtidas('tk', negado as unknown as typeof fetch)).rejects.toMatchObject({
      motivo: 'negado',
    });
  });

  it('retorno: state errado é recusado; state certo troca o código e lê', async () => {
    const auth = new URL(await urlDeAutorizacao());
    const state = auth.searchParams.get('state') ?? '';
    await expect(concluirConexao('?code=abc&state=outro')).rejects.toBeInstanceOf(ErroSpotify);

    // O state é de uso único: a tentativa errada acima já o consumiu.
    const auth2 = new URL(await urlDeAutorizacao());
    const state2 = auth2.searchParams.get('state') ?? '';
    expect(state2).not.toBe(state);
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://accounts.spotify.com/api/token') {
        const corpo = new URLSearchParams(String(init?.body));
        expect(corpo.get('grant_type')).toBe('authorization_code');
        expect(corpo.get('code')).toBe('xyz');
        expect(corpo.get('code_verifier')).toBeTruthy();
        return resposta({ access_token: 'tk' });
      }
      return resposta({ items: [{ track: { id: id(7), type: 'track' } }], next: null });
    });
    const links = await concluirConexao(`?code=xyz&state=${state2}`, f as unknown as typeof fetch);
    expect(links).toEqual([`https://open.spotify.com/track/${id(7)}`]);
  });
});
