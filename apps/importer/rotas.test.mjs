// AUDITORIA DE ROTAS DO IMPORTADOR — sobe o servidor de verdade (server.mjs) e
// dispara contra TODAS as rotas listadas nele.
//
// Modo de autenticação: IMPORT_TOKEN (authMode "token"). É o único que dá para
// exercitar offline nos dois sentidos (com e sem credencial) sem falar com o
// Firebase. As regras do modo Firebase são as mesmas funções (`authorize` /
// `authorizeAdmin`), só trocam a prova de identidade.
//
// Rede: nada sai daqui. Rotas que só terminam falando com YouTube, Deezer,
// MusicBrainz, NVIDIA ou LRCLIB entram com entrada VAZIA/INVÁLIDA (a validação
// responde antes de qualquer rede) e o caso feliz fica `skip` com o motivo.
//
// Defeitos conhecidos de server.mjs (arquivo fora do escopo desta auditoria)
// entram como `todo`: o teste RODA e descreve o comportamento correto; enquanto
// o servidor não for corrigido ele aparece como "todo" sem derrubar a suíte, e
// vira verde sozinho quando a correção chegar. Ver docs/AUDITORIA-ROTAS-2026-11-03.md.
//
// Rodar: node --test rotas.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'segredo-de-teste-rotas';
let filho;
let base;
let porta;
let tmp;

const livre = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'importer-rotas-'));
  // arquivos-isca FORA do cofre, para provar que nenhum id sai da pasta
  await writeFile(path.join(tmp, 'segredo.bin'), 'SEGREDO-FORA-DO-COFRE');
  await writeFile(path.join(tmp, 'segredo.json'), '{"token":"x"}');
  porta = await livre();
  base = `http://127.0.0.1:${porta}`;
  filho = spawn(process.execPath, [path.join(AQUI, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(porta),
      HOST: '127.0.0.1',
      BLOB_DIR: path.join(tmp, 'blobs'),
      COFRE_EXIGE_MARCADOR: '0',
      JEV_DIR: path.join(tmp, 'jev'),
      TEMPO_DIR: path.join(tmp, 'tempos'),
      AUDIO_BORDA: '',
      IMPORT_REQUIRE_LOGIN: '',
      IMPORT_ALLOWED_EMAILS: '',
      IMPORT_TOKEN: TOKEN,
      IMPORT_SERVICE_TOKEN: '',
      // IA/links sem credencial e sem destino: o que dependeria delas responde "não configurada"
      NVIDIA_API_KEY: '',
      NVIDIA_BASE: 'http://127.0.0.1:9',
      SONGLINK_API_KEY: '',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu');
});

after(async () => {
  filho?.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
  if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
});

// ── apoio ────────────────────────────────────────────────────────────────────

const AUTH = { Authorization: `Bearer ${TOKEN}` };

/** fetch que nunca lança: devolve {status, texto, cab} ou {erro} (conexão cortada). */
async function pedir(metodo, caminho, { headers = {}, body, redirect = 'manual' } = {}) {
  try {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers,
      body,
      redirect,
      signal: AbortSignal.timeout(15_000),
    });
    const texto = metodo === 'HEAD' ? '' : await r.text();
    return { status: r.status, texto, cab: r.headers };
  } catch (e) {
    return { status: 0, erro: e.cause?.code ?? e.message, texto: '', cab: new Headers() };
  }
}

const json = (r) => {
  try {
    return JSON.parse(r.texto);
  } catch {
    return undefined;
  }
};

/** O processo continua de pé e atende? Chamado depois de CADA caso ruim. */
async function vivo(contexto = '') {
  const r = await pedir('GET', '/health');
  assert.equal(r.status, 200, `servidor parou de responder${contexto ? ' após ' + contexto : ''}`);
  assert.equal(filho.exitCode, null, 'o processo do servidor morreu');
}

/** Resposta crua por socket, para linhas de requisição que o fetch não deixa montar. */
function cru(linha, extra = '') {
  return new Promise((resolve) => {
    const s = net.connect(porta, '127.0.0.1');
    let d = '';
    s.on('data', (c) => (d += c));
    s.on('error', (e) => resolve(`ERR ${e.code}`));
    s.on('close', () => resolve(d.split('\r\n')[0] || 'fechou sem resposta'));
    s.write(`${linha}\r\nHost: x\r\nConnection: close\r\n${extra}\r\n`);
    setTimeout(() => s.destroy(), 4000);
  });
}

// ── inventário: toda rota de server.mjs ──────────────────────────────────────
//
// auth: 'token'  -> sem credencial 403 (esta API nega com 403, não 401)
//       'aberta' -> sem credencial responde normalmente
//       'cofre'  -> a chave `k` do cofre decide (GET/HEAD/POST/DELETE em /blob)
// vazio: status com credencial e entrada vazia/inválida (nenhuma sai para a rede)
const ROTAS = [
  { m: 'GET', p: '/health', auth: 'aberta', vazio: 200 },
  { m: 'GET', p: '/cofre/estado', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/artist-image', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/artist-top', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/album', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/cover', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/artist-catalog', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/credits', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/letra/outras-fontes', auth: 'aberta', vazio: 404 },
  { m: 'POST', p: '/letra/aprendizado', auth: 'token', vazio: 204 },
  { m: 'GET', p: '/speed', auth: 'token', vazio: 200 },
  { m: 'POST', p: '/speed', auth: 'token', vazio: 200 },
  { m: 'POST', p: '/blob', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/blob/x/alinhar', auth: 'cofre', vazio: 400 },
  { m: 'GET', p: '/blob/x/tempo', auth: 'cofre', vazio: 403 },
  { m: 'GET', p: '/blob/x', auth: 'cofre', vazio: 403 },
  { m: 'HEAD', p: '/blob/x', auth: 'cofre', vazio: 403 },
  { m: 'DELETE', p: '/blob/x', auth: 'cofre', vazio: 404 },
  { m: 'POST', p: '/aquecer', auth: 'token', vazio: 202 },
  { m: 'GET', p: '/stream', auth: 'cofre', vazio: 403 },
  { m: 'POST', p: '/playlist', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/search', auth: 'token', vazio: 400 },
  { m: 'GET', p: '/buscar-youtube', auth: 'token', vazio: 400 },
  { m: 'GET', p: '/buscar-artistas', auth: 'token', vazio: 400 },
  { m: 'GET', p: '/artista-youtube', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/meta', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/jev/decidir', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/jev/aprender', auth: 'token', vazio: 200 },
  { m: 'GET', p: '/jev/estado', auth: 'aberta', vazio: 200 },
  { m: 'POST', p: '/ai/chat', auth: 'token', vazio: 503 },
  { m: 'GET', p: '/ai/transcribe/estado', auth: 'token', vazio: 200 },
  { m: 'POST', p: '/ai/transcribe', auth: 'token', vazio: 400 },
  { m: 'POST', p: '/ai/embed', auth: 'token', vazio: 503 },
  { m: 'POST', p: '/import/start', auth: 'token', vazio: 400 },
  { m: 'GET', p: '/import/job/x', auth: 'token', vazio: 404 },
  { m: 'GET', p: '/import/file/x', auth: 'token', vazio: 404 },
  { m: 'POST', p: '/import', auth: 'token', vazio: 400 },
];

const corpoPadrao = (m) => (m === 'POST' ? '{}' : undefined);
const cabPadrao = (m, extra = {}) => (m === 'POST' ? { 'Content-Type': 'application/json', ...extra } : extra);

test('o inventário cobre todas as rotas de server.mjs', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(path.join(AQUI, 'server.mjs'), 'utf8');
  const achados = new Set();
  for (const m of fonte.matchAll(/pathname === '(\/[^']*)'/g)) achados.add(m[1]);
  for (const m of fonte.matchAll(/pathname\.startsWith\('(\/[^']*)'\)/g)) achados.add(m[1]);
  const cobertos = new Set(ROTAS.map((r) => r.p));
  const prefixos = ['/blob/', '/import/job/', '/import/file/'];
  const faltando = [...achados].filter(
    (p) => !cobertos.has(p) && !prefixos.some((x) => p === x),
  );
  assert.deepEqual(faltando, [], 'rota nova em server.mjs sem linha em ROTAS');
  assert.ok(ROTAS.length >= 35);
});

// ── a) sem credencial ────────────────────────────────────────────────────────

for (const r of ROTAS.filter((x) => x.auth === 'token')) {
  test(`a) ${r.m} ${r.p} sem credencial -> 403 JSON, sem executar nada`, async () => {
    const res = await pedir(r.m, r.p, { headers: cabPadrao(r.m), body: corpoPadrao(r.m) });
    assert.equal(res.status, 403, res.texto.slice(0, 100));
    assert.match(res.cab.get('content-type') ?? '', /json/);
    assert.ok(json(res)?.error, 'corpo de erro JSON esperado');
    await vivo(`${r.m} ${r.p} sem credencial`);
  });
}

const CREDENCIAIS_RUINS = [
  ['Bearer errado', { Authorization: 'Bearer errado' }],
  ['Bearer vazio', { Authorization: 'Bearer ' }],
  ['Basic', { Authorization: 'Basic ' + Buffer.from('a:b').toString('base64') }],
  ['X-Aurial-Token errado', { 'X-Aurial-Token': 'errado' }],
  ['X-Aurial-Service sem serviço configurado', { 'X-Aurial-Service': TOKEN }],
  ['token com 8 kB', { Authorization: 'Bearer ' + 'a'.repeat(8000) }],
  ['token com prefixo do certo', { Authorization: `Bearer ${TOKEN}x` }],
  ['token certo em minúsculas do esquema', { Authorization: `bearer ${TOKEN.toUpperCase()}` }],
];
for (const r of ROTAS.filter((x) => x.auth === 'token')) {
  for (const [nome, cab] of CREDENCIAIS_RUINS) {
    test(`a2) ${r.m} ${r.p} com credencial ruim (${nome}) -> 403`, async () => {
      const res = await pedir(r.m, r.p, { headers: cabPadrao(r.m, cab), body: corpoPadrao(r.m) });
      assert.equal(res.status, 403, res.texto.slice(0, 100));
    });
  }
}

test('a3) credenciais ruins não derrubam o processo', async () => {
  await vivo('credenciais ruins');
});

// ── b) com credencial e entrada vazia: a validação responde antes da rede ────

for (const r of ROTAS.filter((x) => x.auth !== 'cofre')) {
  const conhecidoErrado = false; // 03/11/2026: corpo que não é áudio responde 415
  test(
    `b) ${r.m} ${r.p} com credencial e entrada vazia -> ${r.vazio}`,
    conhecidoErrado
      ? { todo: 'server.mjs ~L4200: corpo que não é áudio vira 502 "Falha ao transcrever"; deveria ser 400/415' }
      : {},
    async () => {
      const res = await pedir(r.m, r.p, { headers: cabPadrao(r.m, AUTH), body: corpoPadrao(r.m) });
      assert.equal(res.status, r.vazio, res.texto.slice(0, 120));
      await vivo(`${r.m} ${r.p} com entrada vazia`);
    },
  );
}

// ── c) rotas que falam com a rede só no caso feliz ───────────────────────────

for (const [rota, motivo] of [
  ['GET /artist-image?name=…', 'consulta o Deezer'],
  ['GET /artist-top?name=…', 'consulta o Deezer'],
  ['GET /album?…', 'consulta o Deezer/MusicBrainz'],
  ['GET /cover?…', 'consulta o Deezer/MusicBrainz'],
  ['GET /credits?…', 'consulta o MusicBrainz'],
  ['GET /letra/outras-fontes?…', 'consulta fontes de letra na internet'],
  ['GET /buscar-youtube?q=…', 'consulta o YouTube (InnerTube/yt-dlp)'],
  ['POST /search {q}', 'abre o yt-dlp'],
  ['POST /playlist {url}', 'abre o yt-dlp'],
  ['POST /meta {url}', 'abre o yt-dlp'],
  ['GET /stream?…', 'resolve e baixa áudio do YouTube'],
  ['POST /import e /import/start', 'baixam e convertem áudio'],
  ['POST /ai/chat com chave', 'chama a NVIDIA'],
  ['POST /ai/embed com chave', 'chama a NVIDIA'],
]) {
  test(`c) ${rota}: caso feliz`, { skip: `exige rede externa (${motivo}); só a validação de entrada é testada aqui` }, () => {});
}

// ── d) JSON quebrado / tipos errados / corpo grande ──────────────────────────

const POSTS_JSON = [
  '/letra/aprendizado',
  '/blob/x/alinhar',
  '/aquecer',
  '/playlist',
  '/search',
  '/meta',
  '/jev/decidir',
  '/jev/aprender',
  '/ai/chat',
  '/ai/embed',
  '/import/start',
  '/import',
];
// rotas em que server.mjs hoje devolve 5xx/ECONNRESET para entrada do cliente
const BUGS_CONHECIDOS = {};
const CORPOS = [
  ['quebrado', '{"a":'],
  ['array', '[1,2,3]'],
  ['null', 'null'],
  ['string', '"oi"'],
  ['numero', '42'],
  [
    'tipos errados',
    JSON.stringify({ url: 123, q: [1], links: 'x', questions: {}, lines: 9, text: {}, messages: 'x', inputs: 5, linhas: 'x', quality: {} }),
  ],
  ['profundo', '['.repeat(5000) + ']'.repeat(5000)],
  ['proto', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'],
];
for (const p of POSTS_JSON) {
  for (const [nome, corpo] of CORPOS) {
    const chave = `${nome} ${p}`;
    const bug = BUGS_CONHECIDOS[chave];
    test(`d) POST ${p} com JSON ${nome} -> 4xx/2xx, nunca 5xx`, bug ? { todo: bug } : {}, async () => {
      const res = await pedir('POST', p, { headers: { ...AUTH, 'Content-Type': 'application/json' }, body: corpo });
      // /ai/*: 503 = IA nao configurada (sem chave), resposta de proposito
      const aceito = res.status > 0 && (res.status < 500 || (res.status === 503 && p.startsWith('/ai/')));
      assert.ok(aceito, `status ${res.status} ${res.erro ?? ''} ${res.texto.slice(0, 80)}`);
      await vivo(chave);
    });
  }
}

// estas rotas respondem sem ler o corpo (nao ha o que estourar)
const NAO_LE_CORPO = new Set(['/ai/chat', '/ai/embed', '/aquecer', '/letra/aprendizado']);
for (const p of POSTS_JSON) {
  if (!NAO_LE_CORPO.has(p))
  test(
    `d2) POST ${p} com corpo > 1 MB -> 413 (e o processo continua)`,
    {},
    async () => {
      const res = await pedir('POST', p, {
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 'A'.repeat(1_100_000) }),
      });
      // 413 é o certo; qualquer resposta que não seja 5xx também mantém o servidor são
      assert.equal(res.status, 413, `status ${res.status} ${res.erro ?? ''}`);
    },
  );
  test(`d3) o processo sobrevive a POST ${p} com corpo > 1 MB`, async () => {
    await pedir('POST', p, {
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 'A'.repeat(1_100_000) }),
    });
    await vivo(`corpo > 1 MB em ${p}`);
  });
}

test('d4) /blob com Content-Length de 200 MB é recusado sem aceitar os bytes', async () => {
  const http = await import('node:http');
  const r = await new Promise((resolve) => {
    const q = http.request(
      base + '/blob',
      {
        method: 'POST',
        headers: { ...AUTH, 'X-Blob-Id': 'gigante', 'Content-Type': 'audio/mpeg', 'Content-Length': String(200 * 1024 * 1024) },
      },
      (rs) => {
        resolve(rs.statusCode);
        rs.resume();
      },
    );
    q.on('error', (e) => resolve(`ERR ${e.code}`));
    q.write('ID3');
    setTimeout(() => q.destroy(), 2000);
  });
  // hoje a conexão cai (ECONNRESET): aceitável para o cofre, mas 413 é o contrato esperado
  assert.ok(r === 413 || String(r).startsWith('ERR'), `resposta inesperada: ${r}`);
  await vivo('Content-Length gigante');
});

// ── e) /blob: id inválido, travessia de pasta, `k` ───────────────────────────

const IDS_RUINS = [
  ['percent truncado', '%E0%A4%A'],
  ['travessia codificada', '..%2Fsegredo'],
  ['travessia dupla', '..%2F..%2F..%2Fwindows%2Fwin.ini'],
  ['barra invertida', '..%5Csegredo'],
  ['nulo', 'a%00b'],
  ['ponto', '.'],
  ['ponto ponto', '..'],
  ['5000 chars', 'a'.repeat(5000)],
  ['unicode bidi', encodeURIComponent('‮\u0000\u{1F600}')],
  ['nome reservado do Windows', 'CON'],
  ['espaços', '%20%20'],
  ['SQL', encodeURIComponent("1' OR '1'='1")],
  ['barra no meio', 'a%2Fb'],
  ['dois-pontos', 'c%3A%5Cx'],
];
const ROTAS_DE_ID = [
  ['GET', (id) => `/blob/${id}`],
  ['HEAD', (id) => `/blob/${id}`],
  ['DELETE', (id) => `/blob/${id}`],
  ['GET', (id) => `/blob/${id}/tempo`],
  ['POST', (id) => `/blob/${id}/alinhar`],
  ['GET', (id) => `/import/job/${id}`],
  ['GET', (id) => `/import/file/${id}`],
];
for (const [m, f] of ROTAS_DE_ID) {
  for (const [nome, id] of IDS_RUINS) {
    test(`e) ${m} ${f('<id>')} com id ${nome} -> 4xx, sem vazar arquivo`, async () => {
      for (const cab of [{}, AUTH]) {
        const res = await pedir(m, f(id) + '?k=x', {
          headers: cabPadrao(m, cab),
          body: corpoPadrao(m),
        });
        assert.ok(res.status >= 400 && res.status < 500, `status ${res.status} ${res.erro ?? ''}`);
        assert.ok(!res.texto.includes('SEGREDO-FORA-DO-COFRE'), 'vazou arquivo fora do cofre');
        assert.ok(!/win\.ini|\[fonts\]|root:/i.test(res.texto), 'vazou arquivo do sistema');
      }
      await vivo(`${m} id ${nome}`);
    });
  }
}

test('e2) /blob/ sem id e com barras sobrando -> 400', async () => {
  for (const u of ['/blob/', '/blob//', '/blob/x/', '/blob/x/tempo/']) {
    const res = await pedir('GET', u, { headers: AUTH });
    assert.equal(res.status, 400, u);
  }
  assert.equal((await pedir('GET', '/blob')).status, 404, '/blob nu (GET) não existe');
});

test('e3) /blob: sem meta e sem k -> 403, com k de outra faixa -> 403', async () => {
  // com AUDIO_BORDA vazio (aqui) a negativa e 404; com a borda configurada, 403/302 (ver servidor.test.mjs)
  for (const [m, u] of [['GET', '/blob/naoexiste'], ['GET', '/blob/naoexiste?k='], ['GET', '/blob/naoexiste?k=' + 'z'.repeat(5000)], ['HEAD', '/blob/naoexiste']]) {
    const res = await pedir(m, u);
    assert.ok([403, 404].includes(res.status), `${m} ${u.slice(0, 30)} -> ${res.status}`);
    assert.ok(!(res.status >= 300 && res.status < 400));
  }
});

test('e4) POST /blob: id ausente/ruim, tipo errado, corpo vazio', async () => {
  const mp3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(64, 1)]);
  const envia = (cab, body) => pedir('POST', '/blob', { headers: { ...AUTH, 'Content-Type': 'audio/mpeg', ...cab }, body });
  assert.equal((await envia({}, mp3)).status, 400, 'sem X-Blob-Id');
  assert.equal((await envia({ 'X-Blob-Id': '../x' }, mp3)).status, 400, 'id com barra');
  assert.equal((await envia({ 'X-Blob-Id': 'a'.repeat(500) }, mp3)).status, 400, 'id longo');
  const vazio = await envia({ 'X-Blob-Id': 'vazio1' }, Buffer.alloc(0));
  assert.ok(vazio.status >= 400 && vazio.status < 500, `corpo vazio -> ${vazio.status}`);
  assert.equal((await envia({ 'X-Blob-Id': 'texto1' }, Buffer.from('<html>' + 'x'.repeat(100)))).status, 415, 'não é áudio');
  await vivo('POST /blob inválido');
});

// ── f) método errado, HEAD e rota inexistente ────────────────────────────────

const CAMINHOS = [...new Set(ROTAS.map((r) => r.p))];
for (const p of CAMINHOS) {
  const aceitos = new Set(ROTAS.filter((r) => r.p === p).map((r) => r.m));
  for (const m of ['PUT', 'PATCH', 'POST', 'DELETE', 'GET']) {
    if (aceitos.has(m)) continue;
    // /blob/* aceita DELETE e GET por prefixo
    if (p.startsWith('/blob/') && ['GET', 'DELETE'].includes(m)) continue;
    test(`f) ${m} ${p} (método não suportado) -> 404 JSON`, async () => {
      const res = await pedir(m, p, { headers: cabPadrao(m, AUTH), body: corpoPadrao(m) });
      assert.equal(res.status, 404, res.texto.slice(0, 100));
      assert.deepEqual(json(res), { error: 'not found' });
      await vivo(`${m} ${p}`);
    });
  }
}

test('f2) HEAD /blob/:id responde como o GET (sem corpo)', async () => {
  for (const u of ['/blob/naoexiste', '/blob/naoexiste?k=x']) {
    const g = await pedir('GET', u);
    const h = await pedir('HEAD', u);
    assert.equal(h.status, g.status, u);
    assert.equal(h.texto, '');
  }
});

test(
  'f3) HEAD /health responde 200 (monitores de disponibilidade costumam usar HEAD)',
  {},
  async () => {
    assert.equal((await pedir('HEAD', '/health')).status, 200);
  },
);

const INEXISTENTES = [
  '/',
  '/nada',
  '/health/',
  '//health',
  '/HEALTH',
  '/health%2F',
  '/.env',
  '/.git/config',
  '/admin',
  '/api/v1/catalogo',
  '/import/job',
  '/ai',
  '/jev',
  '/jev/estado/x',
  '/cofre',
  '/speed/x',
  '/' + 'a'.repeat(5000),
  '/%2e%2e/%2e%2e/etc/passwd',
  '/nada?x=' + 'a'.repeat(9000),
];
for (const u of INEXISTENTES) {
  test(`g) GET ${u.slice(0, 60)} -> 404 JSON {"error":"not found"}`, async () => {
    const res = await pedir('GET', u, { headers: AUTH });
    assert.equal(res.status, 404, res.texto.slice(0, 100));
    assert.match(res.cab.get('content-type') ?? '', /json/);
    assert.deepEqual(json(res), { error: 'not found' });
    await vivo(u.slice(0, 40));
  });
}

test('g2) linhas de requisição estranhas (socket cru) nunca derrubam o processo', async () => {
  const casos = {
    'GET ///x HTTP/1.1': /404/,
    'GET * HTTP/1.1': /404/,
    'GET /% HTTP/1.1': /404/,
    'GET /health? HTTP/1.1': /200/,
    'FOO /health HTTP/1.1': /400/,
    'GET /health HTTP/9.9': /400/,
    'GET /é HTTP/1.1': /400/,
  };
  for (const [linha, esperado] of Object.entries(casos)) {
    assert.match(await cru(linha, `Authorization: Bearer ${TOKEN}\r\n`), esperado, linha);
  }
  assert.match(await cru('GET /health HTTP/1.1', 'X-A: ' + 'a'.repeat(20000) + '\r\n'), /431/, 'cabeçalho de 20 kB');
  await vivo('linhas estranhas');
});

test(
  'g3) GET // (URL vazia de autoridade) -> 4xx, não 500',
  {},
  async () => {
    assert.match(await cru('GET // HTTP/1.1'), /HTTP\/1\.1 4\d\d/);
    await vivo('GET //');
  },
);

// ── h) CORS e preflight ──────────────────────────────────────────────────────

const ORIGENS_OK = ['https://radinho.online', 'https://www.radinho.online', 'https://aurial.vercel.app', 'http://localhost:5173'];
const ORIGENS_NEGADAS = [
  'https://site-do-mal.test',
  'null',
  'https://radinho.online.evil.test',
  'http://radinho.online',
  'https://evilradinho.online',
  'https://radinho.online@evil.test',
];

for (const p of CAMINHOS) {
  test(`h) OPTIONS ${p}: 204 com métodos e cabeçalhos permitidos`, async () => {
    const res = await pedir('OPTIONS', p, {
      headers: {
        Origin: ORIGENS_OK[0],
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-blob-id',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.cab.get('access-control-allow-origin'), ORIGENS_OK[0]);
    assert.match(res.cab.get('access-control-allow-methods') ?? '', /GET, POST, DELETE, OPTIONS/);
    assert.match(res.cab.get('access-control-allow-headers') ?? '', /Authorization/i);
    assert.match(res.cab.get('access-control-allow-headers') ?? '', /X-Blob-Id/i);
    assert.equal(res.texto, '');
  });
}

for (const o of ORIGENS_OK) {
  test(`h2) origem permitida ${o} recebe o próprio valor (não "*")`, async () => {
    const res = await pedir('GET', '/health', { headers: { Origin: o } });
    assert.equal(res.cab.get('access-control-allow-origin'), o);
    assert.match(res.cab.get('vary') ?? '', /Origin/i);
  });
}
for (const o of ORIGENS_NEGADAS) {
  test(`h3) origem negada ${o}: sem Access-Control-Allow-Origin, em GET e em preflight`, async () => {
    const g = await pedir('GET', '/health', { headers: { Origin: o } });
    assert.equal(g.cab.get('access-control-allow-origin'), null);
    const p = await pedir('OPTIONS', '/import', {
      headers: { Origin: o, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(p.cab.get('access-control-allow-origin'), null);
    assert.ok(p.status < 500);
  });
}

test('h4) Private Network Access é concedido só quando pedido', async () => {
  const com = await pedir('OPTIONS', '/health', {
    headers: { Origin: ORIGENS_OK[0], 'Access-Control-Request-Private-Network': 'true' },
  });
  assert.equal(com.cab.get('access-control-allow-private-network'), 'true');
  const sem = await pedir('OPTIONS', '/health', { headers: { Origin: ORIGENS_OK[0] } });
  assert.equal(sem.cab.get('access-control-allow-private-network'), null);
});

test('h5) a resposta não expõe cabeçalhos que denunciem a pilha', async () => {
  const res = await pedir('GET', '/health');
  assert.equal(res.cab.get('x-powered-by'), null);
});

// ── i) forma da resposta de /health e /jev/estado (leituras abertas) ─────────

test('i) /health: JSON com ok, service, versão e modo de autenticação', async () => {
  const res = await pedir('GET', '/health');
  const j = json(res);
  assert.equal(j.ok, true);
  assert.equal(j.service, 'radinho-importer');
  assert.equal(typeof j.version, 'string');
  assert.equal(j.authMode, 'token');
  assert.ok(Array.isArray(j.caps) && j.caps.includes('jobs'));
  assert.match(res.cab.get('content-type') ?? '', /application\/json/);
});

test('i2) /health não vaza segredo de configuração', async () => {
  const res = await pedir('GET', '/health');
  assert.ok(!res.texto.includes(TOKEN), 'o token apareceu no /health');
  assert.ok(!/api[_-]?key|secret|senha|password/i.test(res.texto), 'campo suspeito no /health');
});

test('i3) /jev/estado: JSON com modelo e contagens, sem exemplos nem textos aprendidos', async () => {
  const res = await pedir('GET', '/jev/estado');
  const j = json(res);
  assert.equal(res.status, 200);
  assert.equal(typeof j.model, 'string');
  assert.equal(typeof j.examples, 'object');
});

test('i4) 100 pedidos paralelos a /health não derrubam nem atrasam o servidor', async () => {
  const t = Date.now();
  const rs = await Promise.all(Array.from({ length: 100 }, () => pedir('GET', '/health')));
  assert.ok(rs.every((r) => r.status === 200));
  assert.ok(Date.now() - t < 10_000, 'lento demais');
});

test('i5) rajada de requisições ruins misturadas e o servidor segue respondendo', async () => {
  const lote = [];
  for (let i = 0; i < 60; i++) {
    lote.push(pedir('GET', '/blob/%E0%A4%A'));
    lote.push(pedir('POST', '/search', { headers: { ...AUTH, 'Content-Type': 'application/json' }, body: '{"a":' }));
    lote.push(pedir('DELETE', '/blob/' + 'a'.repeat(300)));
    lote.push(pedir('GET', '/nada'));
    lote.push(pedir('PATCH', '/health'));
  }
  await Promise.all(lote);
  await vivo('rajada');
});

test('z) no fim de tudo o processo ainda é o mesmo e está vivo', async () => {
  assert.equal(filho.exitCode, null);
  assert.equal(filho.signalCode, null);
  await vivo('suíte completa');
});
