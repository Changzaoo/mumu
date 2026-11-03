// node --test infra/cdn/github-worker/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { espelharAcervo, esquecerIndice, remoteUrlDoIndice } from './worker.js';

const INDICE = {
  'local:a': { c: 'aurial-musicas-001', a: 'faixas/A - a.mp3', k: 'kA', t: 'audio/mpeg' },
  'local:b': { c: 'aurial-musicas-002', a: 'faixas/B - b.mp3', k: 'kB', t: 'audio/mpeg' },
};

function kvFalso() {
  const m = new Map();
  return {
    async put(k, v, o) {
      m.set(k, { value: v, metadata: o?.metadata ?? null });
    },
    async getWithMetadata(k) {
      return m.get(k) ?? { value: null, metadata: null };
    },
  };
}

/** fetch dublado: o índice, o alinhamento, a faixa e a API, por URL. */
function fetchFalso(respostas) {
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    for (const [padrao, r] of respostas) {
      if (String(url).includes(padrao)) return typeof r === 'function' ? r(init) : r;
    }
    return new Response('nada', { status: 404 });
  };
  return chamadas;
}

const env = () => ({
  DONO: 'Changzaoo',
  GITHUB_TOKEN: 'ghp_x',
  API_ORIGEM: 'https://api.radinho.online',
  ORIGEM_COFRE: 'https://importer.radinho.online',
  ESPELHO_TOKEN: 'segredo',
  ACERVO: kvFalso(),
});

const req = (caminho, init) => new Request(`https://musicas.radinho.online${caminho}`, init);

test.beforeEach(() => esquecerIndice());

test('remoteUrlDoIndice codifica o id como o acervo grava', () => {
  assert.equal(
    remoteUrlDoIndice('https://importer.radinho.online', 'local:a', 'kA'),
    'https://importer.radinho.online/blob/local%3Aa?k=kA',
  );
});

test('espelharAcervo remonta remoteUrl/streamUrl/tocavel só de quem está no índice', () => {
  const listagem = {
    data: [
      { track: { id: 'local:a', title: 'A', streamUrl: null }, tocavel: false },
      { track: { id: 'local:zz', title: 'Z' }, tocavel: false },
      {
        track: { id: 'local:b', title: 'B', streamUrl: 'https://x/ja' },
        tocavel: true,
        mimeType: 'audio/mp4',
      },
    ],
  };
  const e = espelharAcervo(listagem, INDICE, 'https://importer.radinho.online');
  assert.equal(e.n, 3);
  assert.equal(e.data[0].remoteUrl, 'https://importer.radinho.online/blob/local%3Aa?k=kA');
  assert.equal(e.data[0].track.streamUrl, e.data[0].remoteUrl);
  assert.equal(e.data[0].tocavel, true);
  assert.equal(e.data[0].mimeType, 'audio/mpeg');
  assert.deepEqual(e.data[1], listagem.data[1]);
  assert.equal(e.data[2].track.streamUrl, 'https://x/ja', 'streamUrl existente é respeitado');
  assert.equal(e.data[2].mimeType, 'audio/mp4');
  assert.match(e.espelhadoEm, /^\d{4}-/);
});

test('espelharAcervo aguenta listagem vazia ou torta', () => {
  assert.equal(espelharAcervo(null, INDICE, 'x').n, 0);
  assert.equal(espelharAcervo({ data: 'x' }, INDICE, 'x').n, 0);
  assert.equal(espelharAcervo({ data: [null, {}] }, INDICE, 'x').n, 2);
});

test('GET /blob/<id> continua como antes (206 com Range, k conferido)', async () => {
  fetchFalso([
    ['indice.json', () => new Response(JSON.stringify(INDICE))],
    [
      'aurial-musicas-001/main/faixas',
      (init) =>
        new Response('bytes', {
          status: init.headers.Range ? 206 : 200,
          headers: { 'Content-Length': '5', 'Content-Range': 'bytes 0-4/5' },
        }),
    ],
  ]);
  const ok = await worker.fetch(
    req('/blob/local%3Aa?k=kA', { headers: { Range: 'bytes=0-4' } }),
    env(),
  );
  assert.equal(ok.status, 206);
  assert.equal(ok.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal((await worker.fetch(req('/blob/local%3Aa?k=errado'), env())).status, 403);
  assert.equal((await worker.fetch(req('/blob/local%3Anao'), env())).status, 404);
  assert.equal((await worker.fetch(req('/blob/%E0%A4%A'), env())).status, 400);
});

test('GET /blob/<id>/alinhar serve o alinhamento do índice, com k, 404 sem arquivo', async () => {
  const chamadas = fetchFalso([
    ['indice.json', () => new Response(JSON.stringify(INDICE))],
    ['alinhamentos/local%3Aa.json', () => new Response('{"linhas":[{"text":"oi","startMs":1}]}')],
  ]);
  const r = await worker.fetch(req('/blob/local%3Aa/alinhar?k=kA'), env());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(await r.json(), { linhas: [{ text: 'oi', startMs: 1 }] });
  assert.ok(
    chamadas.some((c) =>
      c.url.includes('aurial-indice-musicas/main/alinhamentos/local%3Aa.json'),
    ),
  );
  assert.equal((await worker.fetch(req('/blob/local%3Aa/alinhar?k=x'), env())).status, 403);
  assert.equal(
    (await worker.fetch(req('/blob/local%3Ab/alinhar?k=kB'), env())).status,
    404,
    'sem arquivo',
  );
  assert.equal(
    (await worker.fetch(req('/blob/local%3Azz/alinhar?k=kB'), env())).status,
    404,
    'fora do índice',
  );
  const head = await worker.fetch(req('/blob/local%3Aa/alinhar?k=kA', { method: 'HEAD' }), env());
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('alinhar: GitHub fora é 502, índice fora é 503 (nunca "não existe")', async () => {
  fetchFalso([
    ['indice.json', () => new Response(JSON.stringify(INDICE))],
    ['alinhamentos/', () => new Response('x', { status: 500 })],
  ]);
  assert.equal((await worker.fetch(req('/blob/local%3Aa/alinhar?k=kA'), env())).status, 502);
  esquecerIndice();
  fetchFalso([['indice.json', () => new Response('x', { status: 500 })]]);
  assert.equal((await worker.fetch(req('/blob/local%3Aa/alinhar?k=kA'), env())).status, 503);
});

test('cron espelha a API no KV e GET /acervo serve com ETag e 304', async () => {
  const listagem = { data: [{ track: { id: 'local:a', title: 'A' }, tocavel: false }] };
  fetchFalso([
    ['indice.json', () => new Response(JSON.stringify(INDICE))],
    ['api.radinho.online/api/v1/catalogo', () => new Response(JSON.stringify(listagem))],
  ]);
  const e = env();
  const esperas = [];
  await worker.scheduled({}, e, { waitUntil: (p) => esperas.push(p) });
  await Promise.all(esperas);
  const r = await worker.fetch(req('/acervo'), e);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=300');
  const etag = r.headers.get('ETag');
  assert.ok(etag);
  const corpo = await r.json();
  assert.equal(corpo.n, 1);
  assert.equal(corpo.data[0].remoteUrl, 'https://importer.radinho.online/blob/local%3Aa?k=kA');
  assert.equal(corpo.data[0].tocavel, true);
  const r304 = await worker.fetch(req('/acervo', { headers: { 'If-None-Match': etag } }), e);
  assert.equal(r304.status, 304);
});

test('GET /acervo sem espelho é 503 com Retry-After; API fora não apaga o espelho velho', async () => {
  const e = env();
  const r = await worker.fetch(req('/acervo'), e);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('Retry-After'), '60');
  await e.ACERVO.put('acervo', '{"data":[],"n":0}', { metadata: { em: 'ontem', n: 0 } });
  fetchFalso([
    ['indice.json', () => new Response(JSON.stringify(INDICE))],
    ['api.radinho.online', () => new Response('fora', { status: 530 })],
  ]);
  const esperas = [];
  await worker.scheduled({}, e, { waitUntil: (p) => esperas.push(p) });
  await Promise.all(esperas);
  assert.equal((await e.ACERVO.getWithMetadata('acervo')).metadata.em, 'ontem');
});

test('PUT /acervo exige o token e aceita o espelho vindo da API', async () => {
  fetchFalso([['indice.json', () => new Response(JSON.stringify(INDICE))]]);
  const e = env();
  const corpo = JSON.stringify({ data: [{ track: { id: 'local:b', title: 'B' } }] });
  const sem = await worker.fetch(req('/acervo', { method: 'PUT', body: corpo }), e);
  assert.equal(sem.status, 401);
  const errado = await worker.fetch(
    req('/acervo', { method: 'PUT', body: corpo, headers: { Authorization: 'Bearer x' } }),
    e,
  );
  assert.equal(errado.status, 401);
  const torto = await worker.fetch(
    req('/acervo', { method: 'PUT', body: '{', headers: { Authorization: 'Bearer segredo' } }),
    e,
  );
  assert.equal(torto.status, 400);
  const vazio = await worker.fetch(
    req('/acervo', {
      method: 'PUT',
      body: '{"data":[]}',
      headers: { Authorization: 'Bearer segredo' },
    }),
    e,
  );
  assert.equal(vazio.status, 400);
  const ok = await worker.fetch(
    req('/acervo', { method: 'PUT', body: corpo, headers: { Authorization: 'Bearer segredo' } }),
    e,
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, n: 1 });
  const lido = await (await worker.fetch(req('/acervo'), e)).json();
  assert.equal(lido.data[0].remoteUrl, 'https://importer.radinho.online/blob/local%3Ab?k=kB');
});

test('métodos e caminhos errados: 405/404, OPTIONS 204 com CORS', async () => {
  assert.equal((await worker.fetch(req('/acervo', { method: 'POST' }), env())).status, 405);
  assert.equal(
    (await worker.fetch(req('/blob/local%3Aa', { method: 'POST' }), env())).status,
    405,
  );
  assert.equal((await worker.fetch(req('/qualquer'), env())).status, 404);
  const o = await worker.fetch(req('/acervo', { method: 'OPTIONS' }), env());
  assert.equal(o.status, 204);
  assert.equal(o.headers.get('Access-Control-Allow-Origin'), '*');
});
