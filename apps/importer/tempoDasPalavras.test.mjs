// Testes das funções puras que decidem O QUE PROCESSAR A SEGUIR na fila de
// relógio de letras — sem subir Python nem tocar disco. Roda com o test
// runner nativo do Node: `node --test apps/importer/tempoDasPalavras.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoAbandonado, proximaChave } from './tempoDasPalavras.mjs';

const entrada = (tipo, pedidoEm) => [
  `chave-${tipo}-${pedidoEm}`,
  { tarefa: { tipo, id: 't' }, pedidoEm },
];

test('proximaChave: alinhamento fura a fila, mesmo sendo mais antigo', () => {
  const entradas = [
    entrada('alinhar', 1_000),
    entrada('transcrever', 5_000), // mais recente, mas é transcrição
  ];
  assert.equal(proximaChave(entradas), entradas[0][0]);
});

test('proximaChave: sem alinhamento nenhum, cai na transcrição mais recente', () => {
  const entradas = [entrada('transcrever', 1_000), entrada('transcrever', 5_000)];
  assert.equal(proximaChave(entradas), entradas[1][0]);
});

test('proximaChave: entre dois alinhamentos, o mais recente vence', () => {
  const entradas = [entrada('alinhar', 1_000), entrada('alinhar', 5_000)];
  assert.equal(proximaChave(entradas), entradas[1][0]);
});

test('proximaChave: fila vazia devolve null (nada a processar)', () => {
  assert.equal(proximaChave([]), null);
});

test('pedidoAbandonado: dentro da janela, ainda vale a pena', () => {
  assert.equal(pedidoAbandonado(0, 60_000, 180_000), false);
});

test('pedidoAbandonado: passou da janela, ninguém mais pediu', () => {
  assert.equal(pedidoAbandonado(0, 200_000, 180_000), true);
});

test('pedidoAbandonado: exatamente na borda ainda conta como vivo', () => {
  assert.equal(pedidoAbandonado(0, 180_000, 180_000), false);
});

// ── TEMPO_LOCAL=0: responder 422 SEM baixar o áudio ─────────────────────────
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile as gravar, rm as apagar } from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { criarTempoDasPalavras, localLigado } from './tempoDasPalavras.mjs';

const LINHAS = ['Mantém, mantém', 'Vem mais, mais vem'];
const chaveAl = (id, linhas) =>
  `${id}.al-${createHash('sha1').update(linhas.join('\n')).digest('hex').slice(0, 12)}.v2`;

async function motor(opcoes) {
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), 'tempo-teste-'));
  const t = criarTempoDasPalavras({ dir, log: () => undefined, ...opcoes });
  return { t, dir, fim: () => apagar(dir, { recursive: true, force: true }) };
}

test('localLigado reflete TEMPO_LOCAL', () => {
  assert.equal(localLigado(), process.env.TEMPO_LOCAL !== '0');
});

for (const [nome, pedido] of [
  ['alinhar pt', { tipo: 'alinhar', id: 'f1', idioma: 'pt', linhas: LINHAS }],
  ['alinhar en', { tipo: 'alinhar', id: 'f1', idioma: 'en', linhas: LINHAS }],
  ['transcrever pt', { tipo: 'transcrever', id: 'f1', idioma: 'pt' }],
  ['transcrever auto', { tipo: 'transcrever', id: 'f1', idioma: 'auto' }],
  ['transcrever en sem Riva', { tipo: 'transcrever', id: 'f1', idioma: 'en' }],
]) {
  test(`local desligado, ${nome}, nada pronto: recusa sem áudio`, async () => {
    const { t, fim } = await motor({ local: false });
    try {
      assert.equal(await t.recusaSemAudio(pedido), true);
      assert.equal(t.localLigado(), false);
    } finally {
      await fim();
    }
  });
  test(`local LIGADO, ${nome}: não recusa (vai calcular)`, async () => {
    const { t, fim } = await motor({ local: true });
    try {
      assert.equal(await t.recusaSemAudio(pedido), false);
    } finally {
      await fim();
    }
  });
}

test('local desligado mas inglês com Riva: não recusa (o Riva está na nuvem)', async () => {
  const { t, fim } = await motor({ local: false, rivaPalavras: async () => [] });
  try {
    assert.equal(await t.recusaSemAudio({ tipo: 'transcrever', id: 'f1', idioma: 'en' }), false);
    assert.equal(await t.recusaSemAudio({ tipo: 'transcrever', id: 'f1', idioma: 'pt' }), true);
    assert.equal(
      await t.recusaSemAudio({ tipo: 'alinhar', id: 'f1', idioma: 'en', linhas: LINHAS }),
      true,
    );
  } finally {
    await fim();
  }
});

test('local desligado com alinhamento PRONTO em disco: não recusa (o servidor serve o pronto)', async () => {
  const { t, dir, fim } = await motor({ local: false });
  try {
    await gravar(
      nodePath.join(dir, `${encodeURIComponent(chaveAl('f1', LINHAS))}.json`),
      JSON.stringify({ linhas: [] }),
    );
    assert.equal(
      await t.recusaSemAudio({ tipo: 'alinhar', id: 'f1', idioma: 'pt', linhas: LINHAS }),
      false,
    );
    // outra letra (outro hash) continua recusada
    assert.equal(
      await t.recusaSemAudio({ tipo: 'alinhar', id: 'f1', idioma: 'pt', linhas: ['outra'] }),
      true,
    );
  } finally {
    await fim();
  }
});

test('local desligado: pedirAlinhamento responde falhou, pronto em disco responde pronto', async () => {
  const { t, dir, fim } = await motor({ local: false });
  try {
    assert.deepEqual(await t.pedirAlinhamento('f2', '/nao/existe', 'pt', LINHAS), {
      status: 'falhou',
    });
    await gravar(
      nodePath.join(dir, `${encodeURIComponent(chaveAl('f2', LINHAS))}.json`),
      JSON.stringify({ linhas: [{ text: 'x', startMs: 1, endMs: 2, words: [] }] }),
    );
    const r = await t.pedirAlinhamento('f2', '/nao/existe', 'pt', LINHAS);
    assert.equal(r.pronto.linhas[0].text, 'x');
  } finally {
    await fim();
  }
});
