/**
 * BORDA DO GITHUB — toca a cópia do cofre a partir dos contêineres privados,
 * sem passar pelo PC nem pelo servidor que roda o importador.
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
 * Desde 03/11/2026 a borda também é o que mantém o app DE PÉ quando o servidor
 * (vnmax) cai — a música está no GitHub, o app na Vercel, então nada disso
 * precisa do notebook:
 *
 *   • `GET /blob/<id>/alinhar?k=` — o RELÓGIO da letra pré-computado no PC
 *     (apps/importer/relogioDoAcervo.mjs) e publicado em
 *     `aurial-indice-musicas/alinhamentos/<id>.json`. Mesmo formato da resposta
 *     `pronto` do importador. 404 quando ainda não existe; o app cai para o
 *     importador.
 *   • `GET /acervo` — a listagem do acervo (`/api/v1/catalogo`) espelhada no KV
 *     por um gatilho de cron (a cada 20 min), com a `remoteUrl` de cada faixa
 *     remontada pelo índice. Quando a API não responde, o app carrega daqui.
 *     `PUT /acervo` com `Authorization: Bearer <ESPELHO_TOKEN>` aceita o
 *     espelho vindo de fora (o worker da API), para o dia em que a Cloudflare
 *     desafiar a busca feita daqui.
 *
 * Erros que NÃO são "a faixa não existe" saem como 502/503: para o app, borda
 * que falha só sai da frente por um minuto; quem decide morte é a origem.
 */

/* global fetch, Response, Headers, URL, console */

const INDICE_MS = 5 * 60_000;
const UM_ANO = 31_536_000;
/** Quanto tempo o relógio de uma faixa fica na borda (o arquivo nunca muda). */
const ALINHAMENTO_S = 86_400;
/** O espelho do acervo é lido a cada abertura do app: 5 min de cache público. */
const ACERVO_S = 300;
const CHAVE_ACERVO = 'acervo';

let indice = null;
let lidoEm = 0;

export const cabecalhosGithub = (env) => ({
  Authorization: `token ${env.GITHUB_TOKEN}`,
  'User-Agent': 'aurial-cdn',
});

async function lerIndice(env) {
  if (indice && Date.now() - lidoEm < INDICE_MS) return indice;
  const r = await fetch(
    `https://raw.githubusercontent.com/${env.DONO}/aurial-indice-musicas/main/indice.json`,
    { headers: cabecalhosGithub(env) },
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

/** Só para os testes: esquece o índice em memória. */
export function esquecerIndice() {
  indice = null;
  lidoEm = 0;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
};

const texto = (status, corpo, extra = {}) =>
  new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });

const json = (status, corpo, extra = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
      ...extra,
    },
  });

/** `remoteUrl` que o acervo grava para uma cópia do cofre, remontada do índice. */
export function remoteUrlDoIndice(origemCofre, id, k) {
  return `${origemCofre}/blob/${encodeURIComponent(id)}?k=${k}`;
}

/**
 * O espelho do acervo: a listagem magra da API com a `remoteUrl` (e o
 * `tocavel`) remontados pelo índice. Pura, para testar.
 *
 * Quem está no índice toca pela borda mesmo que a API tenha perdido a URL
 * (foi o que aconteceu em 28/10/2026 com 5,6 mil faixas); quem não está fica
 * como a API mandou.
 */
export function espelharAcervo(listagem, idx, origemCofre) {
  const entradas = Array.isArray(listagem?.data) ? listagem.data : [];
  const data = entradas.map((e) => {
    const id = e?.track?.id;
    const faixa = id ? idx[id] : null;
    if (!faixa || !faixa.k) return e;
    const remoteUrl = remoteUrlDoIndice(origemCofre, id, faixa.k);
    return {
      ...e,
      remoteUrl,
      mimeType: e.mimeType || faixa.t || 'audio/mpeg',
      tocavel: true,
      track: { ...e.track, streamUrl: e.track.streamUrl || remoteUrl },
    };
  });
  return { data, espelhadoEm: new Date().toISOString(), n: data.length };
}

async function buscarAcervoNaApi(env) {
  const r = await fetch(`${env.API_ORIGEM}/api/v1/catalogo`, {
    headers: { Accept: 'application/json', 'User-Agent': 'aurial-cdn' },
  });
  if (!r.ok) throw new Error(`api ${r.status}`);
  const corpo = await r.json();
  if (!Array.isArray(corpo?.data) || corpo.data.length === 0) throw new Error('api vazia');
  return corpo;
}

/** Atualiza o espelho no KV. Devolve o número de faixas, ou lança. */
export async function atualizarEspelho(env, listagem = null) {
  const [idx, corpo] = await Promise.all([lerIndice(env), listagem ?? buscarAcervoNaApi(env)]);
  const espelho = espelharAcervo(corpo, idx, env.ORIGEM_COFRE);
  await env.ACERVO.put(CHAVE_ACERVO, JSON.stringify(espelho), {
    metadata: { em: espelho.espelhadoEm, n: espelho.n },
  });
  return espelho.n;
}

async function responderAcervo(req, env) {
  const { value, metadata } = await env.ACERVO.getWithMetadata(CHAVE_ACERVO);
  if (!value) return texto(503, 'espelho-vazio', { 'Retry-After': '60' });
  const etag = `"${metadata?.em ?? ''}:${metadata?.n ?? ''}"`;
  if (req.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ...CORS, ETag: etag } });
  }
  return new Response(req.method === 'HEAD' ? null : value, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ACERVO_S}`,
      ETag: etag,
      'X-Espelhado-Em': metadata?.em ?? '',
    },
  });
}

async function responderAlinhamento(req, env, id, k) {
  let faixa;
  try {
    faixa = (await lerIndice(env))[id];
  } catch {
    return texto(503, 'indice-indisponivel', { 'Retry-After': '30' });
  }
  if (!faixa) return texto(404, 'not found');
  if (k !== faixa.k) return texto(403, 'forbidden');
  const cima = await fetch(
    `https://raw.githubusercontent.com/${env.DONO}/aurial-indice-musicas/main/alinhamentos/${encodeURIComponent(id)}.json`,
    { headers: cabecalhosGithub(env), cf: { cacheEverything: true, cacheTtl: ALINHAMENTO_S } },
  );
  if (cima.status === 404) return texto(404, 'sem-alinhamento');
  if (!cima.ok) return texto(502, `github ${cima.status}`);
  const h = new Headers(CORS);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', `public, max-age=${ALINHAMENTO_S}`);
  return new Response(req.method === 'HEAD' ? null : cima.body, { status: 200, headers: h });
}

export default {
  /** Gatilho de cron (wrangler.toml → [triggers]): espelha o acervo no KV. */
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(
      atualizarEspelho(env).catch((e) => {
        console.error('espelho do acervo falhou:', e instanceof Error ? e.message : e);
      }),
    );
  },

  async fetch(req, env) {
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
      });

    const url = new URL(req.url);

    if (url.pathname === '/acervo') {
      if (req.method === 'PUT') {
        const auth = req.headers.get('Authorization') ?? '';
        if (!env.ESPELHO_TOKEN || auth !== `Bearer ${env.ESPELHO_TOKEN}`)
          return texto(401, 'unauthorized');
        let corpo;
        try {
          corpo = await req.json();
        } catch {
          return texto(400, 'json');
        }
        if (!Array.isArray(corpo?.data) || corpo.data.length === 0) return texto(400, 'vazio');
        try {
          const n = await atualizarEspelho(env, corpo);
          return json(200, { ok: true, n });
        } catch (e) {
          return texto(503, e instanceof Error ? e.message : 'falhou');
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return texto(405, 'method');
      return responderAcervo(req, env);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return texto(405, 'method');

    const alinhar = /^\/blob\/([^/]+)\/alinhar$/.exec(url.pathname);
    if (alinhar) {
      let id;
      try {
        id = decodeURIComponent(alinhar[1]);
      } catch {
        return texto(400, 'bad id');
      }
      return responderAlinhamento(req, env, id, url.searchParams.get('k'));
    }

    const m = /^\/blob\/([^/]+)$/.exec(url.pathname);
    if (!m) return texto(404, 'not found');
    let id;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return texto(400, 'bad id');
    }

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
          ...cabecalhosGithub(env),
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
