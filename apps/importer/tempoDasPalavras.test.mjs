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
