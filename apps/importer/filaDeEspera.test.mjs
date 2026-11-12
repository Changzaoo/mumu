import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarFilaDeEspera } from './filaDeEspera.mjs';

test('a última pedida sai primeiro', () => {
  const fila = criarFilaDeEspera();
  fila.entrar('a', 1);
  fila.entrar('b', 2);
  fila.entrar('c', 3);
  assert.deepEqual(fila.proximo(), { id: 'c', valor: 3 });
  assert.deepEqual(fila.proximo(), { id: 'b', valor: 2 });
  assert.deepEqual(fila.proximo(), { id: 'a', valor: 1 });
  assert.equal(fila.proximo(), null);
});

test('a mesma faixa pedida de novo ocupa um lugar só e volta ao topo', () => {
  const fila = criarFilaDeEspera();
  fila.entrar('a', 1);
  fila.entrar('b', 2);
  fila.entrar('a', 9);
  assert.equal(fila.tamanho, 2);
  assert.deepEqual(fila.proximo(), { id: 'a', valor: 9 });
  assert.deepEqual(fila.proximo(), { id: 'b', valor: 2 });
});

test('cheia, descarta a mais antiga e avisa qual foi', () => {
  const fila = criarFilaDeEspera({ teto: 2 });
  assert.deepEqual(fila.entrar('a', 1), []);
  assert.deepEqual(fila.entrar('b', 2), []);
  assert.deepEqual(fila.entrar('c', 3), ['a']);
  assert.equal(fila.tamanho, 2);
  assert.equal(fila.tem('a'), false);
  assert.equal(fila.tem('c'), true);
});

test('sair tira quem já não precisa', () => {
  const fila = criarFilaDeEspera();
  fila.entrar('a', 1);
  fila.entrar('b', 2);
  assert.equal(fila.sair('b'), true);
  assert.equal(fila.sair('b'), false);
  assert.deepEqual(fila.proximo(), { id: 'a', valor: 1 });
});

test('teto inválido vira pelo menos um lugar', () => {
  const fila = criarFilaDeEspera({ teto: 0 });
  fila.entrar('a', 1);
  fila.entrar('b', 2);
  assert.equal(fila.tamanho, 1);
  assert.deepEqual(fila.proximo(), { id: 'b', valor: 2 });
});
