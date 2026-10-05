/**
 * SERVIDOR DE MEDIÇÃO DO MOTO G34 — `dist` real + API/CDN de mentira, sem ruído.
 *
 * POR QUE NÃO `vite preview`. O preview serve o bundle, mas não tem:
 *   1. compressão brotli como a Vercel (medir bytes de JS sem compressão
 *      superestima 3 a 4x o que o celular baixa);
 *   2. cabeçalhos de cache iguais aos de produção (`immutable` em /assets);
 *   3. a API — o app abre o acervo inteiro por `GET /api/v1/catalogo` (5.7 mil
 *      faixas, ~2,6 MB de JSON) e sem ela a Home é uma tela vazia;
 *   4. as CDNs de capa (i.ytimg.com, mzstatic, dzcdn…): cada tela do app pede
 *      dezenas de imagens, e é o decode delas que pesa num Snapdragon 695.
 *
 * Este servidor serve tudo isso LOCALMENTE, por HTTP (porta 4180, a origem do app)
 * e por HTTPS (porta 4443, para os hosts de CDN que o Chromium redireciona pelas
 * flags `--host-resolver-rules` do perfil — ver `motoG34.ts`). Como tudo passa
 * por rede de verdade (loopback), o estrangulamento do CDP
 * (`Network.emulateNetworkConditions`) vale para o catálogo, as imagens e os
 * assets, inclusive os pedidos do service worker.
 *
 * FIXTURES (em `test-results/g34/fixtures`, fora do git):
 *   catalogo.json   cópia do `GET /catalogo` de produção (leitura anônima)
 *   api/<hash>.json respostas de GET /api/v1/* gravadas
 *   cdn/<hash>      imagens gravadas
 *   tom.mp3         áudio sintético de 3 min (ffmpeg) servido em /blob/<id>
 *
 * `G34_GRAVAR=1` liga o modo gravação: o que faltar é buscado UMA VEZ na
 * internet de verdade e guardado. Sem a variável tudo é replay offline e
 * determinístico — o que falta vira 404 (API) ou um JPEG cinza (capa).
 *
 * Uso:  node e2e/g34Servidor.mjs            (o config sobe sozinho)
 */
import { createServer as criarHttp } from 'node:http';
import { createServer as criarHttps } from 'node:https';
import { brotliCompressSync, gzipSync, constants as z } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, '..');
const DIST = process.env.G34_DIST ? resolve(process.env.G34_DIST) : join(RAIZ, 'dist');
const FIX = join(RAIZ, 'test-results', 'g34', 'fixtures');
const PORTA_HTTP = Number(process.env.G34_PORTA ?? 4180);
const PORTA_HTTPS = Number(process.env.G34_PORTA_HTTPS ?? 4443);
const GRAVAR = process.env.G34_GRAVAR === '1';
const API_REAL = 'https://aurial-api.nexusholding.xyz';

for (const d of ['api', 'cdn']) mkdirSync(join(FIX, d), { recursive: true });

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// ── cert autoassinado para os hosts de CDN ─────────────────────────────────
const CERT = join(FIX, 'cert.pem');
const CHAVE = join(FIX, 'chave.pem');
if (!existsSync(CERT)) {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', CHAVE, '-out', CERT,
    '-days', '365', '-subj', '/CN=g34.local',
    '-addext', 'subjectAltName=DNS:*.ytimg.com,DNS:i.ytimg.com,DNS:*.mzstatic.com,DNS:*.dzcdn.net,DNS:*.nexusholding.xyz,DNS:itunes.apple.com,DNS:lrclib.net,DNS:*.googleusercontent.com,DNS:localhost',
  ], { stdio: 'ignore' });
}

// ── áudio sintético ─────────────────────────────────────────────────────────
const TOM = join(FIX, 'tom.mp3');
if (!existsSync(TOM)) {
  try {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=180', '-b:a', '128k', TOM], { stdio: 'ignore' });
  } catch {
    writeFileSync(TOM, Buffer.alloc(0));
  }
}

// ── catálogo ────────────────────────────────────────────────────────────────
const CATALOGO = join(FIX, 'catalogo.json');
let catalogoBruto = null;
function catalogo() {
  if (catalogoBruto) return catalogoBruto;
  if (existsSync(CATALOGO)) {
    catalogoBruto = readFileSync(CATALOGO);
  } else {
    // Sintético, mesmo formato e ordem de grandeza (5,7 mil entradas).
    const entradas = Array.from({ length: 5744 }, (_, i) => ({
      track: {
        id: `local:sint-${i}`,
        album: null,
        label: null,
        title: `Faixa sintética ${i}`,
        artists: [{ name: `Artista ${i % 400}` }],
        composer: null,
        coverUrl: `https://i.ytimg.com/vi/sint${i % 150}/hq720.jpg`,
        durationMs: 180000,
      },
      addedAt: new Date(Date.now() - i * 3600_000).toISOString(),
      tocavel: true,
      conteudoVeredicto: 'limpo',
    }));
    catalogoBruto = Buffer.from(JSON.stringify({ data: entradas }));
  }
  return catalogoBruto;
}

// ── compressão (cache em memória; a Vercel serve brotli pré-calculado) ──────
const COMPRIMIVEL = /^(text\/|application\/(javascript|json|manifest\+json|xml)|image\/svg)/;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.apk': 'application/vnd.android.package-archive',
};
const memo = new Map();
function comprimido(chave, corpo, aceita) {
  const br = /\bbr\b/.test(aceita);
  const gz = /\bgzip\b/.test(aceita);
  if (!br && !gz) return { corpo, enc: null };
  const k = `${chave}|${br ? 'br' : 'gz'}`;
  if (!memo.has(k)) {
    memo.set(k, br
      ? brotliCompressSync(corpo, { params: { [z.BROTLI_PARAM_QUALITY]: 9, [z.BROTLI_PARAM_SIZE_HINT]: corpo.length } })
      : gzipSync(corpo, { level: 9 }));
  }
  return { corpo: memo.get(k), enc: br ? 'br' : 'gzip' };
}

function enviar(req, res, status, tipo, corpo, extra = {}) {
  const aceita = String(req.headers['accept-encoding'] ?? '');
  const out = COMPRIMIVEL.test(tipo) && corpo.length > 512
    ? comprimido(`${req.url}|${corpo.length}`, corpo, aceita)
    : { corpo, enc: null };
  const cab = { 'Content-Type': tipo, Vary: 'Accept-Encoding, Origin', ...extra };
  if (out.enc) cab['Content-Encoding'] = out.enc;
  cab['Content-Length'] = out.corpo.length;
  res.writeHead(status, cab);
  res.end(req.method === 'HEAD' ? undefined : out.corpo);
}

// ── API ─────────────────────────────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin': '*' };
const registro = []; // pedidos desconhecidos, para o relatório
async function api(req, res, url) {
  const caminho = url.pathname.replace(/^\/api\/v1/, '');
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'Access-Control-Allow-Headers': '*' }); return res.end(); }

  if (caminho === '/catalogo' && req.method === 'GET') {
    const bruto = catalogo();
    const etag = `W/"${bruto.length}-g34"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, ...CORS }); return res.end(); }
    return enviar(req, res, 200, 'application/json; charset=utf-8', bruto, { ETag: etag, 'Cache-Control': 'no-cache', ...CORS });
  }

  // Detalhe da faixa: onde mora o áudio. Aponta para o /blob deste servidor.
  const m = caminho.match(/^\/catalogo\/(.+)$/);
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    const corpo = JSON.stringify({ data: { remoteUrl: `http://localhost:${PORTA_HTTP}/blob/${encodeURIComponent(id)}`, sourceUrl: `https://www.youtube.com/watch?v=g34`, contentHash: `h-${hash(id)}` } });
    return enviar(req, res, 200, 'application/json; charset=utf-8', Buffer.from(corpo), CORS);
  }

  if (req.method !== 'GET') {
    // Escritas (sessão, telemetria, presença…): aceita e ignora, 200 vazio.
    registro.push(`${req.method} ${caminho}`);
    return enviar(req, res, 200, 'application/json; charset=utf-8', Buffer.from('{"data":null}'), CORS);
  }

  // GET qualquer: replay do gravado; se faltar e GRAVAR, busca de verdade.
  const arq = join(FIX, 'api', `${hash(url.pathname + url.search)}.json`);
  if (existsSync(arq)) {
    const j = JSON.parse(readFileSync(arq, 'utf8'));
    return enviar(req, res, j.status, 'application/json; charset=utf-8', Buffer.from(j.corpo), CORS);
  }
  if (GRAVAR) {
    try {
      const r = await fetch(`${API_REAL}/api/v1${caminho}${url.search}`, { headers: { Origin: 'https://aurial.vercel.app', Accept: 'application/json' } });
      const corpo = await r.text();
      writeFileSync(arq, JSON.stringify({ status: r.status, caminho: url.pathname + url.search, corpo }));
      return enviar(req, res, r.status, 'application/json; charset=utf-8', Buffer.from(corpo), CORS);
    } catch { /* cai no 404 */ }
  }
  registro.push(`GET(sem fixture) ${caminho}${url.search}`);
  return enviar(req, res, 404, 'application/json; charset=utf-8', Buffer.from('{"error":{"code":"NOT_FOUND","message":"sem fixture"}}'), CORS);
}

// ── CDN de capas (HTTPS, host-resolver-rules) ───────────────────────────────
// JPEG 320x180 cinza (ffmpeg) usado quando a capa gravada não existe.
const CINZA = (() => { const f = join(FIX, 'cinza.jpg'); if (!existsSync(f)) { try { execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x303030:s=320x180', '-frames:v', '1', f], { stdio: 'ignore' }); } catch { /* sem ffmpeg */ } } return existsSync(f) ? readFileSync(f) : Buffer.alloc(0); })();
const CORS_ALL = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const ehImagem = (h) => /ytimg|mzstatic|dzcdn|googleusercontent/.test(h);
async function cdn(req, res) {
  const host = String(req.headers.host ?? '').split(':')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_ALL); return res.end(); }
  // lrclib.net (letras): sintetiza uma letra SINCRONIZADA que bate com a consulta.
  if (host === 'lrclib.net' && req.url.startsWith('/api/get')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const dur = Number(q.get('duration') ?? 180);
    const linhas = Array.from({ length: 48 }, (_, i) => ({ t: (i * dur) / 48, txt: `Linha ${i + 1} da letra sintética para medir a rolagem do karaokê` }));
    const mmss = (t) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`;
    const row = { id: 1, trackName: q.get('track_name'), artistName: q.get('artist_name'), albumName: q.get('album_name'), duration: dur, instrumental: false,
      plainLyrics: linhas.map((l) => l.txt).join(String.fromCharCode(10)), syncedLyrics: linhas.map((l) => `${mmss(l.t)} ${l.txt}`).join(String.fromCharCode(10)) };
    return enviar(req, res, 200, 'application/json', Buffer.from(JSON.stringify(row)), CORS_ALL);
  }
  if (host === 'lrclib.net') return enviar(req, res, 404, 'application/json', Buffer.from('{}'), CORS_ALL);
  const arq = join(FIX, 'cdn', hash(`${req.method}${host}${req.url}`));
  const cab = ehImagem(host) ? { 'Cache-Control': 'public, max-age=31536000', ...CORS_ALL } : { 'Cache-Control': 'no-cache', ...CORS_ALL };
  if (existsSync(arq)) return enviar(req, res, Number(readFileSync(`${arq}.status`, 'utf8') || 200), readFileSync(`${arq}.tipo`, 'utf8'), readFileSync(arq), cab);
  // Só GET é gravado/reenviado ao host de verdade; escrita (POST) é aceita e ignorada.
  if (GRAVAR && req.method === 'GET') {
    try {
      const r = await fetch(`https://${host}${req.url}`, { headers: { Origin: 'https://aurial.vercel.app' } });
      const corpo = Buffer.from(await r.arrayBuffer());
      const tipo = r.headers.get('content-type') ?? 'application/octet-stream';
      writeFileSync(arq, corpo); writeFileSync(`${arq}.tipo`, tipo); writeFileSync(`${arq}.status`, String(r.status));
      return enviar(req, res, r.status, tipo, corpo, cab);
    } catch { /* cai no padrão */ }
  }
  registro.push(`HTTPS(sem fixture) ${host}${req.url}`.slice(0, 160));
  if (ehImagem(host)) return enviar(req, res, 200, 'image/jpeg', CINZA, cab);
  return enviar(req, res, 404, 'application/json', Buffer.from('{}'), cab);
}

// ── estáticos (dist) com Range para o áudio ─────────────────────────────────
function entregarAudio(req, res) {
  const corpo = readFileSync(TOM);
  const r = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
  const cab = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', ...CORS, 'Cache-Control': 'no-store' };
  if (r) {
    const ini = r[1] ? Number(r[1]) : 0;
    const fim = r[2] ? Math.min(Number(r[2]), corpo.length - 1) : corpo.length - 1;
    res.writeHead(206, { ...cab, 'Content-Range': `bytes ${ini}-${fim}/${corpo.length}`, 'Content-Length': fim - ini + 1 });
    return res.end(corpo.subarray(ini, fim + 1));
  }
  res.writeHead(200, { ...cab, 'Content-Length': corpo.length });
  res.end(corpo);
}

function estatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  let arq = join(DIST, rel);
  const dentro = arq.startsWith(DIST);
  const ehArquivo = dentro && existsSync(arq) && statSync(arq).isFile();
  const ehAsset = rel.startsWith('/assets/');
  if (!ehArquivo) {
    if (ehAsset) { res.writeHead(404); return res.end(); }
    // Mesma regra do rewrite da Vercel: tudo que não é asset cai no index.html.
    arq = join(DIST, 'index.html');
  }
  const corpo = readFileSync(arq);
  const tipo = TIPOS[extname(arq)] ?? 'application/octet-stream';
  // vercel.json: /assets/* imutável; o resto (index, sw.js) revalida.
  const cache = ehAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
  const etag = `"${createHash('sha1').update(corpo).digest('hex').slice(0, 20)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); return res.end(); }
  enviar(req, res, 200, tipo, corpo, { 'Cache-Control': cache, ETag: etag });
}

async function tratar(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.socket.encrypted) return await cdn(req, res);
    if (url.pathname === '/__g34/desconhecidos') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([...new Set(registro)]));
    }
    if (url.pathname.startsWith('/api/v1')) return await api(req, res, url);
    if (url.pathname.startsWith('/blob/')) return entregarAudio(req, res);
    return estatico(req, res, url);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}

criarHttp(tratar).listen(PORTA_HTTP, '127.0.0.1', () => console.log(`g34: http://localhost:${PORTA_HTTP} (dist=${DIST})`));
criarHttps({ key: readFileSync(CHAVE), cert: readFileSync(CERT) }, tratar).listen(PORTA_HTTPS, '127.0.0.1');
