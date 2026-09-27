// Testes do escolhedor de candidatos — a prova mínima que impede a busca
// livre (NetEase) de trocar a letra por uma de OUTRA música. Roda com o test
// runner nativo do Node (sem dependência nova): `node --test
// apps/importer/outrasFontesDeLetra.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casaCandidato } from './outrasFontesDeLetra.mjs';

const candidato = (over = {}) => ({
  titulo: 'Warzone',
  artistas: ['Brandão85'],
  duracaoSeg: 166,
  ...over,
});
const pedido = (over = {}) => ({
  titulo: 'Warzone',
  artista: 'Brandão85',
  duracaoSeg: 166,
  ...over,
});

test('artista e duração batendo: aceita', () => {
  assert.equal(casaCandidato(candidato(), pedido()), true);
});

test('título com variação (feat., remix): ainda casa', () => {
  assert.equal(casaCandidato(candidato({ titulo: 'Warzone (feat. Xamã)' }), pedido()), true);
  assert.equal(casaCandidato(candidato({ titulo: 'Warzone - Ao Vivo' }), pedido()), true);
});

test('sem artista e sem duração batendo: recusa — título sozinho não é prova', () => {
  assert.equal(
    casaCandidato(
      candidato({ artistas: [], duracaoSeg: null }),
      pedido({ artista: '', duracaoSeg: 0 }),
    ),
    false,
  );
});

test('artista bate mesmo sem duração conhecida do candidato', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: null }), pedido()), true);
});

test('duração bate mesmo sem artista conhecido do candidato', () => {
  assert.equal(casaCandidato(candidato({ artistas: [] }), pedido()), true);
});

test('artista conhecido e DIFERENTE: recusa mesmo com duração batendo', () => {
  assert.equal(casaCandidato(candidato({ artistas: ['Charlie Brown Jr.'] }), pedido()), false);
});

test('duração longe demais (>5s): recusa — outra gravação da mesma música', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: 200 }), pedido()), false);
});

test('duração a 5s de diferença: ainda aceita (tolerância da borda)', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: 171 }), pedido()), true);
});

test('título diferente: recusa antes de qualquer outra coisa', () => {
  assert.equal(casaCandidato(candidato({ titulo: 'Só Os Loucos' }), pedido()), false);
});

test('dupla com conectivo ("e"/"and") ainda casa', () => {
  assert.equal(
    casaCandidato(
      candidato({ artistas: ['Chitãozinho e Xororó'] }),
      pedido({ artista: 'Chitaozinho and Xororo' }),
    ),
    true,
  );
});

test('acento e caixa não separam a mesma faixa', () => {
  assert.equal(
    casaCandidato(candidato({ artistas: ['BRANDAO85'] }), pedido({ artista: 'brandão85' })),
    true,
  );
});
