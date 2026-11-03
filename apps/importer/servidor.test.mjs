// Teste de integração do servidor: sobe o processo de verdade em porta efêmera.
// Cobre o que derrubava o processo sem login (%-sequência truncada em /blob/) e
// as regras de token do cofre (reenvio com bytes diferentes, DELETE com `k`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let filho;
let base;
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
  tmp = await mkdtemp(path.join(os.tmpdir(), 'importer-srv-'));
  const port = await livre();
  base = `http://127.0.0.1:${port}`;
  filho = spawn(process.execPath, [path.join(AQUI, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      BLOB_DIR: path.join(tmp, 'blobs'),
      COFRE_EXIGE_MARCADOR: '0',
      JEV_DIR: path.join(tmp, 'jev'),
      TEMPO_DIR: path.join(tmp, 'tempos'),
      // Modo aberto: sem login, para exercitar só as regras do cofre.
      IMPORT_REQUIRE_LOGIN: '',
      IMPORT_ALLOWED_EMAILS: '',
      IMPORT_TOKEN: '',
      IMPORT_SERVICE_TOKEN: '',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
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

const mp3 = (marca) => Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.from(marca.padEnd(64, '.'))]);

// O aquecimento do motor de decisão (embeddings) pode prender o processo por
// dezenas de segundos logo depois de subir; tenta de novo se a conexão cair.
async function comRetentativa(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

test('GET /blob/%E0%A4%A responde 400 e o processo continua vivo', async () => {
  const r = await comRetentativa(() => fetch(`${base}/blob/%E0%A4%A`));
  assert.equal(r.status, 400);
  const h = await fetch(`${base}/health`);
  assert.equal(h.status, 200);
});

test('DELETE /blob/%E0%A4%A responde 400 e o processo continua vivo', async () => {
  const r = await fetch(`${base}/blob/%E0%A4%A`, { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('cofre: reenvio com bytes diferentes exige o k; DELETE exige o k', async () => {
  const envia = (corpo, extra = '', cab = {}) =>
    fetch(`${base}/blob${extra}`, {
      method: 'POST',
      headers: { 'X-Blob-Id': 'faixa1', 'Content-Type': 'audio/mpeg', ...cab },
      body: corpo,
    });
  const r1 = await envia(mp3('um'));
  assert.equal(r1.status, 200);
  const { token } = await r1.json();
  assert.match(token, /^[0-9a-f]{32}$/);

  // mesmos bytes: só confirma
  assert.equal((await envia(mp3('um'))).status, 200);
  // bytes diferentes sem k: 403 e sem token na resposta
  const r3 = await envia(mp3('dois'));
  assert.equal(r3.status, 403);
  assert.ok(!JSON.stringify(await r3.json()).includes(token));
  // com k: substitui
  assert.equal((await envia(mp3('dois'), `?k=${token}`)).status, 200);
  assert.equal((await envia(mp3('tres'), '', { 'X-Aurial-Token': token })).status, 200);
  // não-áudio é recusado
  const r6 = await envia(Buffer.from('<html>' + 'x'.repeat(64)), '', {});
  assert.equal(r6.status, 415);

  // GET traz os cabeçalhos de contenção
  const g = await fetch(`${base}/blob/faixa1?k=${token}`);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(g.headers.get('content-security-policy'), 'sandbox');
  await g.arrayBuffer();

  // DELETE: sem k 403, k errado 403, sem meta 404, k certo 204
  assert.equal((await fetch(`${base}/blob/faixa1`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/blob/faixa1?k=errado`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/blob/naoexiste`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/blob/faixa1?k=${token}`, { method: 'DELETE' })).status, 204);
});
