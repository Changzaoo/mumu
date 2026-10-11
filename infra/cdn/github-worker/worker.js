/**
 * BORDA DO GITHUB — toca a cópia do cofre a partir dos contêineres privados,
 * sem passar pelo PC que roda o importador.
 *
 * Atende o MESMO caminho da origem (`/blob/<id>?k=<token>`), então entra no app
 * como mais uma borda de `VITE_AUDIO_CDN` (ver apps/web/src/lib/audio/cdn.ts):
 * nada muda no acervo nem nas `remoteUrl` gravadas, e a origem continua por
 * último na fila, como reserva.
 *
 * As faixas moram nos repositórios privados `aurial-musicas-NNN`; quem diz onde
 * cada uma está (e qual token a libera) é o `indice.json` do repositório privado
 * `aurial-indice-musicas` — os dois publicados por infra/scripts/musicas-para-o-git.mjs.
 * O token de leitura do GitHub fica só aqui, como segredo do Worker.
 *
 * Erros que NÃO são "a faixa não existe" saem como 502/503: para o app, borda
 * que falha só sai da frente por um minuto; quem decide morte é a origem.
 */

/* global fetch, Response, Headers, URL */

const INDICE_MS = 5 * 60_000;
const UM_ANO = 31_536_000;

let indice = null;
let lidoEm = 0;

async function lerIndice(env) {
  if (indice && Date.now() - lidoEm < INDICE_MS) return indice;
  const r = await fetch(
    `https://raw.githubusercontent.com/${env.DONO}/aurial-indice-musicas/main/indice.json`,
    {
      headers: { Authorization: `token ${env.GITHUB_TOKEN}`, 'User-Agent': 'aurial-cdn' },
    },
  );
  if (!r.ok) {
    // GitHub fora por um instante: o índice velho ainda serve.
    if (indice) return indice;
    throw new Error(`índice ${r.status}`);
  }
  indice = await r.json();
  lidoEm = Date.now();
  return indice;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const texto = (status, corpo, extra = {}) =>
  new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
      });
    if (req.method !== 'GET' && req.method !== 'HEAD') return texto(405, 'method');

    const url = new URL(req.url);
    const m = /^\/blob\/([^/]+)$/.exec(url.pathname);
    if (!m) return texto(404, 'not found');
    const id = decodeURIComponent(m[1]);

    let faixa;
    try {
      faixa = (await lerIndice(env))[id];
    } catch {
      return texto(503, 'indice-indisponivel', { 'Retry-After': '30' });
    }
    // Ainda não subiu (ou foi podada antes de subir): a origem resolve.
    if (!faixa) return texto(404, 'not found');
    if (url.searchParams.get('k') !== faixa.k) return texto(403, 'forbidden');

    const caminho = faixa.a.split('/').map(encodeURIComponent).join('/');
    const cima = await fetch(
      `https://raw.githubusercontent.com/${env.DONO}/${faixa.c}/main/${caminho}`,
      {
        method: req.method,
        headers: {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          'User-Agent': 'aurial-cdn',
          ...(req.headers.get('Range') ? { Range: req.headers.get('Range') } : {}),
        },
        // O arquivo de um contêiner nunca muda: guardar na borda poupa o GitHub.
        cf: { cacheEverything: true, cacheTtl: UM_ANO },
      },
    );

    if (cima.status === 416)
      return texto(416, '', { 'Content-Range': cima.headers.get('Content-Range') ?? '' });
    if (cima.status !== 200 && cima.status !== 206) {
      // 404 do GitHub aqui é índice à frente do push, não faixa morta: 502.
      return texto(502, `github ${cima.status}`);
    }

    const h = new Headers(CORS);
    h.set('Content-Type', faixa.t || 'audio/mpeg');
    h.set('Accept-Ranges', 'bytes');
    h.set('Cache-Control', `private, max-age=${UM_ANO}`);
    for (const k of ['Content-Length', 'Content-Range']) {
      const v = cima.headers.get(k);
      if (v) h.set(k, v);
    }
    return new Response(req.method === 'HEAD' ? null : cima.body, {
      status: cima.status,
      headers: h,
    });
  },
};
