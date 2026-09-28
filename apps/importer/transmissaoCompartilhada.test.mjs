import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { criarCentralDeTransmissoes } from './transmissaoCompartilhada.mjs';

/** Servidor de verdade: cada GET se pendura na transmissão da chave fixa. */
async function montar(produzir, opcoes) {
  const central = criarCentralDeTransmissoes({ gracaMs: 50, ...opcoes });
  const server = http.createServer((req, res) => {
    void central.obter('faixa|160', produzir).servir(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { central, base, fechar: () => new Promise((r) => server.close(r)) };
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('dois ouvintes simultâneos dividem UM produtor e recebem os mesmos bytes', async () => {
  let produtores = 0;
  const { central, base, fechar } = await montar(async (t) => {
    produtores++;
    for (let i = 0; i < 5; i++) {
      t.escrever(Buffer.from(`pedaco${i};`));
      await pausa(20);
    }
    t.terminar(true);
  });
  const [a, b] = await Promise.all([fetch(base), fetch(base)]);
  const [ta, tb] = await Promise.all([a.text(), b.text()]);
  assert.equal(produtores, 1);
  assert.equal(ta, 'pedaco0;pedaco1;pedaco2;pedaco3;pedaco4;');
  assert.equal(tb, ta);
  assert.equal(central.estatisticas().coalescidos, 1);
  await fechar();
});

test('quem chega no meio recebe o começo (replay) e segue ao vivo', async () => {
  const { base, fechar } = await montar(async (t) => {
    for (let i = 0; i < 6; i++) {
      t.escrever(Buffer.from(String(i)));
      await pausa(25);
    }
    t.terminar(true);
  });
  const primeiro = fetch(base).then((r) => r.text());
  await pausa(70);
  const atrasado = await fetch(base).then((r) => r.text());
  assert.equal(atrasado, '012345');
  assert.equal(await primeiro, '012345');
  await fechar();
});

test('faixa terminada sai do cache da memória, com Content-Length', async () => {
  let produtores = 0;
  const { central, base, fechar } = await montar(async (t) => {
    produtores++;
    t.escrever(Buffer.from('abc'));
    t.terminar(true);
  });
  await fetch(base).then((r) => r.text());
  const r = await fetch(base);
  assert.equal(r.headers.get('content-length'), '3');
  assert.equal(await r.text(), 'abc');
  assert.equal(produtores, 1);
  assert.equal(central.estatisticas().doCache, 1);
  await fechar();
});

test('origem que não produz nada vira 502 e não vai para o cache', async () => {
  let produtores = 0;
  const { base, fechar } = await montar(async (t) => {
    produtores++;
    t.terminar(false);
  });
  assert.equal((await fetch(base)).status, 502);
  assert.equal((await fetch(base)).status, 502);
  assert.equal(produtores, 2);
  await fechar();
});

test('o último ouvinte saindo cancela o produtor (depois da folga)', async () => {
  let cancelado = false;
  const { base, fechar } = await montar(async (t) => {
    t.aoCancelar(() => {
      cancelado = true;
    });
    t.escrever(Buffer.from('x'));
    while (!t.cancelada) await pausa(10);
  });
  const ctrl = new AbortController();
  const r = await fetch(base, { signal: ctrl.signal });
  assert.equal(r.status, 200);
  ctrl.abort();
  await pausa(200);
  assert.equal(cancelado, true);
  await fechar();
});

test('o cache respeita o teto de bytes (LRU)', async () => {
  const central = criarCentralDeTransmissoes({ tetoCacheBytes: 5, gracaMs: 10 });
  const produz = (conteudo) => async (t) => {
    t.escrever(Buffer.from(conteudo));
    t.terminar(true);
  };
  central.obter('a', produz('aaa'));
  central.obter('b', produz('bbb'));
  await pausa(10);
  const e = central.estatisticas();
  assert.equal(e.prontas, 1);
  assert.equal(e.bytesProntos, 3);
});
