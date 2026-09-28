// Testes do escolhedor de candidatos — a prova mínima que impede a busca
// livre (NetEase) de trocar a letra por uma de OUTRA música. Roda com o test
// runner nativo do Node (sem dependência nova): `node --test
// apps/importer/outrasFontesDeLetra.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  casaCandidato,
  extrairLetraDaPagina,
  separarArtistas,
  tentarGenius,
} from './outrasFontesDeLetra.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const buscaGeniusFixture = JSON.parse(
  readFileSync(path.join(HERE, '__fixtures__', 'genius-search.json'), 'utf8'),
);
const paginaGeniusFixture = readFileSync(
  path.join(HERE, '__fixtures__', 'genius-song.html'),
  'utf8',
);

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

// ── Genius: raspagem da página (fixture real, sem rede) ────────────────────

test('extrairLetraDaPagina: tira o cabeçalho da música e preserva os versos', () => {
  const texto = extrairLetraDaPagina(paginaGeniusFixture);
  assert.ok(texto);
  // Nada do cromado (título, colaboradores, prévia da bio) sobrevive.
  assert.ok(!texto.includes('Contributors'));
  assert.ok(!texto.includes('Mantém Lyrics'));
  assert.ok(!texto.includes('Read More'));
  // Os versos de verdade continuam lá, na ordem — inclusive o marcado com <a>
  // (anotação do Genius): a TAG some, a PALAVRA fica.
  assert.ok(texto.includes('Eu tô de volta com a mente de um chefe'));
  assert.ok(texto.includes('[Refrão]'));
  assert.ok(texto.includes('Vem mais, mais vem'));
  assert.ok(texto.includes('Me traz mais cem'));
});

test('extrairLetraDaPagina: página sem bloco de letra devolve null', () => {
  assert.equal(extrairLetraDaPagina('<html><body>sem letra aqui</body></html>'), null);
});

test('separarArtistas: conectivos comuns (com espaço) viram nomes separados', () => {
  assert.deepEqual(separarArtistas('WIU & Matuê'), ['WIU', 'Matuê']);
  assert.deepEqual(separarArtistas('Djonga feat. Rincon Sapiência'), [
    'Djonga',
    'Rincon Sapiência',
  ]);
  assert.deepEqual(separarArtistas('Chitãozinho e Xororó'), ['Chitãozinho', 'Xororó']);
});

test('tentarGenius: só aceita o resultado cujo artista bate, e raspa a letra dele', async () => {
  const original = globalThis.fetch;
  const caminhosPedidos = [];
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/api/search/song')) return new Response(JSON.stringify(buscaGeniusFixture));
    caminhosPedidos.push(s);
    return new Response(paginaGeniusFixture);
  };
  try {
    const r = await tentarGenius({ titulo: 'Mantém', artista: 'Matuê', duracaoSeg: 0 });
    assert.equal(r?.fonte, 'genius');
    assert.equal(r?.synced, false);
    assert.ok(r?.plain.includes('Eu tô de volta'));
    // O segundo resultado da busca (artista sem nenhuma relação) nem chegou a
    // ser raspado — a prova mínima descartou antes de gastar a requisição.
    assert.ok(!caminhosPedidos.some((u) => u.includes('Ninguem-conhecido')));
  } finally {
    globalThis.fetch = original;
  }
});

test('tentarGenius: artista não bate em nenhum resultado — recusa tudo, nunca raspa', async () => {
  const original = globalThis.fetch;
  let raspou = false;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/api/search/song')) return new Response(JSON.stringify(buscaGeniusFixture));
    raspou = true;
    return new Response(paginaGeniusFixture);
  };
  try {
    const r = await tentarGenius({
      titulo: 'Mantém',
      artista: 'Artista Bem Diferente',
      duracaoSeg: 0,
    });
    assert.equal(r, null);
    assert.equal(raspou, false);
  } finally {
    globalThis.fetch = original;
  }
});
