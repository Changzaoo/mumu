// Testes da memória de correção por artista — as partes puras (sem tocar
// disco) e o ciclo registrar→promptPara completo num arquivo temporário.
// `node --test apps/importer/vocabulario.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  construirPrompt,
  criarVocabulario,
  mesclarCorrecao,
  normalizarArtista,
} from './vocabulario.mjs';

test('normalizarArtista: acento e caixa não separam o mesmo artista', () => {
  assert.equal(normalizarArtista('Matuê'), normalizarArtista('MATUE'));
  assert.equal(normalizarArtista('  Djonga  '), 'djonga');
});

test('mesclarCorrecao: primeira vez cria com contagem 1', () => {
  const entrada = mesclarCorrecao(undefined, 'a ful', 'afu');
  assert.deepEqual(entrada, { 'a ful': { real: 'afu', contagem: 1 } });
});

test('mesclarCorrecao: repetir a MESMA correção soma a contagem', () => {
  let entrada = mesclarCorrecao(undefined, 'pela sol', 'pela Sul');
  entrada = mesclarCorrecao(entrada, 'pela sol', 'pela Sul');
  entrada = mesclarCorrecao(entrada, 'pela sol', 'pela Sul');
  assert.equal(entrada['pela sol'].contagem, 3);
});

test('mesclarCorrecao: teto do artista descarta a correção menos vista antes de crescer', () => {
  let entrada;
  for (let i = 0; i < 200; i += 1) {
    entrada = mesclarCorrecao(entrada, `ouvida-${i}`, `real-${i}`);
  }
  // A primeira já tem 200 vizinhas; a 201ª faz o teto cortar alguém.
  entrada = mesclarCorrecao(entrada, 'ouvida-nova', 'real-nova');
  assert.equal(Object.keys(entrada).length, 200);
  assert.ok('ouvida-nova' in entrada);
});

test('construirPrompt: só entra o que já foi visto ≥2 vezes, mais visto primeiro', () => {
  let entrada = mesclarCorrecao(undefined, 'a ful', 'afu');
  entrada = mesclarCorrecao(entrada, 'a ful', 'afu'); // 2x
  entrada = mesclarCorrecao(entrada, 'pela sol', 'pela Sul'); // 1x — não entra
  assert.equal(construirPrompt(entrada), 'afu');
});

test('construirPrompt: sem correções (ou nenhuma repetida) devolve string vazia', () => {
  assert.equal(construirPrompt(undefined), '');
  assert.equal(construirPrompt(mesclarCorrecao(undefined, 'x', 'y')), '');
});

test('construirPrompt: respeita o teto de tamanho, não corta uma forma no meio', () => {
  let entrada;
  for (let i = 0; i < 40; i += 1) {
    entrada = mesclarCorrecao(entrada, `ouvida-${i}`, `uma-forma-bem-comprida-${i}`);
    entrada = mesclarCorrecao(entrada, `ouvida-${i}`, `uma-forma-bem-comprida-${i}`); // 2x
  }
  const prompt = construirPrompt(entrada);
  assert.ok(prompt.length <= 200);
  // Cada pedaço entre vírgulas é uma forma INTEIRA, nunca um pedaço cortado.
  for (const forma of prompt.split(', ')) {
    assert.ok(/^uma-forma-bem-comprida-\d+$/.test(forma));
  }
});

test('criarVocabulario: registra em disco e promptPara lê de volta', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vocab-'));
  const arquivo = path.join(dir, 'vocabulario.json');
  try {
    const v1 = criarVocabulario({ arquivo, log: () => {} });
    await v1.registrar('Matuê', [
      { ouvido: 'a ful', real: 'afu' },
      { ouvido: 'a ful', real: 'afu' },
    ]);
    // Ainda não gravou (debounce de 2s) — mas a mesma instância já sabe.
    assert.equal(await v1.promptPara('matue'), 'afu');

    // Espera a gravação em disco e lê com uma instância NOVA (processo
    // reiniciado, o caso real: o importador cai e sobe nas atualizações).
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const v2 = criarVocabulario({ arquivo, log: () => {} });
    assert.equal(await v2.promptPara('MATUE'), 'afu');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('criarVocabulario: artista sem correção nenhuma devolve prompt vazio, nunca lança', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vocab-'));
  const arquivo = path.join(dir, 'nao-existe', 'vocabulario.json');
  try {
    const v = criarVocabulario({ arquivo, log: () => {} });
    assert.equal(await v.promptPara('Ninguém'), '');
    await assert.doesNotReject(v.registrar('', []));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
