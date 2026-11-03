// Escolha ESTRITA do vídeo (espelho do importador): o MESMO corpus de cenários
// que testa apps/api/src/workers/escolhaEstrita.ts. O esperado de cada cenário
// é o índice do vídeo certo inserido na construção (ou null) — nunca a saída
// do código. Sem rede: `node --test apps/importer/escolhaEstrita.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escolherVideoEstrito } from './escolhaEstrita.mjs';
import { melhorResultado, motivoDaEscolha, notaDoResultado } from './linkDeMusica.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const cenarios = JSON.parse(
  readFileSync(
    path.join(
      AQUI,
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'ai',
      '__tests__',
      'fixtures',
      'escolhaDoVideo.json',
    ),
    'utf8',
  ),
);

test('o corpus tem volume suficiente', () => {
  assert.ok(cenarios.length >= 150, `só ${cenarios.length} cenários`);
});

test('corpus: todos os cenários dão o esperado', () => {
  const erros = [];
  for (const c of cenarios) {
    const d = escolherVideoEstrito(c.pedido, c.resultados);
    const indice = d.escolhido ? c.resultados.indexOf(d.escolhido) : null;
    if (indice !== c.esperado) {
      erros.push(`${c.id} ${c.grupo}: esperado ${c.esperado}, veio ${indice} (${d.motivo})`);
    }
  }
  assert.deepEqual(erros, []);
});

const faixa = { titulo: 'Pipoco', artistas: ['Ana'], duracaoMs: 171000 };
const v = (titulo, canal, duracaoSeg = 171, n = 'aaaaaaaaaaa') => ({
  url: `https://www.youtube.com/watch?v=${n}`,
  titulo,
  canal,
  duracaoSeg,
});

test('melhorResultado: "Ana" não é "Mariana" nem "Ana Castela"', () => {
  assert.equal(melhorResultado(faixa, [v('Mariana - Pipoco', 'Mariana')]), null);
  assert.equal(melhorResultado(faixa, [v('Ana Castela - Pipoco', 'Ana Castela')]), null);
  assert.equal(notaDoResultado(faixa, v('Mariana - Pipoco', 'Mariana')), 0);
  const certo = v('Ana - Pipoco (Clipe Oficial)', 'Ana', 171, 'bbbbbbbbbbb');
  assert.equal(melhorResultado(faixa, [v('Mariana - Pipoco', 'Mariana'), certo]), certo);
});

test('melhorResultado: empate entre gravações diferentes é null, com o motivo', () => {
  const f = { titulo: 'Oceano', artistas: ['Djavan'], duracaoMs: null };
  const lista = [
    v('Djavan - Oceano', 'Canal A', 200, 'ccccccccccc'),
    v('Djavan - Oceano (Lyrics)', 'Canal B', 290, 'ddddddddddd'),
  ];
  assert.equal(melhorResultado(f, lista), null);
  assert.match(motivoDaEscolha(f, lista), /empate/);
});

test('melhorResultado: cover, reação, playlist e karaokê nunca', () => {
  const f = { titulo: 'Oceano', artistas: ['Djavan'], duracaoMs: 250000 };
  for (const t of [
    'Djavan - Oceano (cover)',
    'REAGINDO a Djavan - Oceano',
    'Playlist Djavan: Oceano',
    'Oceano - Karaokê - Djavan',
    'Djavan - Oceano (8D Audio)',
  ]) {
    assert.equal(melhorResultado(f, [v(t, 'Djavan', 250)]), null, t);
  }
});
