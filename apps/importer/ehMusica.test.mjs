import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classificar, semRepetidas, soMusicas } from './ehMusica.mjs';

// Canal real da 30PRAUM (200 vídeos, lista plana: título + duração).
const canal = JSON.parse(
  readFileSync(new URL('./__fixtures__/canal-30praum.json', import.meta.url), 'utf8'),
);
// O catálogo (iTunes) sem rede: só "confirma" o que for música de verdade.
const catalogo = async () => ({ results: [] });

test('canal real: tira vlog/making of/documentário/trecho e as versões repetidas', async () => {
  const { musicas, fora } = await soMusicas(canal, { buscar: catalogo });
  const tirados = fora.map((f) => f.titulo);
  for (const t of [
    'GLOBAL NEWSPAPER: THE COLLAPSE IS REAL!',
    'ISSO É TRAP.',
    'QUER VOAR (Making Of)',
    'Teto, WIU, Matuê - Flow Espacial (Making of)',
    'Matuê, N.A.N.A. - NANANANA',
  ]) {
    assert.ok(tirados.includes(t), `deveria tirar: ${t}`);
  }
  // Nenhuma música de verdade some: as 187 que sobram incluem as conhecidas.
  const ficou = musicas.map((m) => m.titulo);
  for (const t of [
    'WIU & Matuê - Mantém',
    'Matuê - Kenny G',
    'BRANDÃO85 - MAZE BANK',
    'MATUÊ - QUER VOAR 🩸',
  ]) {
    assert.ok(ficou.includes(t), `deveria manter: ${t}`);
  }
  assert.equal(musicas.length, 187);
  // Da mesma música, uma só — e a versão sem a introdução do clipe.
  assert.equal(ficou.filter((t) => /^Matuê - 333$/.test(t)).length, 1);
  assert.equal(musicas.find((m) => m.titulo === 'Matuê - 333').duracaoSeg, 322);
});

test('dúvida sem catálogo fica de fora (melhor faltar do que entrar vlog)', async () => {
  const { musicas } = await soMusicas([{ titulo: 'Um dia comigo em SP', duracaoSeg: 300 }]);
  assert.equal(musicas.length, 0);
});

test('dúvida que o catálogo confirma entra', async () => {
  const buscar = async () => ({
    results: [{ wrapperType: 'track', kind: 'song', trackName: 'Mantém', trackTimeMillis: 206000 }],
  });
  const { musicas } = await soMusicas([{ titulo: 'Mantém', duracaoSeg: 207 }], { buscar });
  assert.equal(musicas.length, 1);
});

test('classificar: marcas de não-música e de música', () => {
  assert.equal(classificar({ titulo: 'Entrevista com o Matuê', duracaoSeg: 900 }).veredito, 'nao');
  assert.equal(
    classificar({ titulo: 'Matuê - Kenny G (Clipe Oficial)', duracaoSeg: 179 }).veredito,
    'musica',
  );
  assert.equal(classificar({ titulo: 'Kenny G #shorts', duracaoSeg: 30 }).veredito, 'nao');
  assert.equal(classificar({ titulo: 'Matuê reagindo a fãs', duracaoSeg: 400 }).veredito, 'nao');
});

test('repetidas: fica a versão de áudio', () => {
  const { unicas } = semRepetidas([
    { titulo: 'Teto - TEMPORAL', duracaoSeg: 189 },
    { titulo: 'Teto - Temporal (visualizer)', duracaoSeg: 189 },
  ]);
  assert.deepEqual(
    unicas.map((u) => u.titulo),
    ['Teto - Temporal (visualizer)'],
  );
});
