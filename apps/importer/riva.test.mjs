// Funções puras do cliente Riva — sem rede. `node --test apps/importer/riva.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordemDeTentativa, segmentosDaResposta, FUNCOES_PALAVRA, FUNCOES_SEGMENTO } from './riva.mjs';

test('ordemDeTentativa: sem preferida mantém a ordem de qualidade', () => {
  assert.deepEqual(ordemDeTentativa(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
});

test('ordemDeTentativa: a que funcionou por último vai para a frente', () => {
  assert.deepEqual(ordemDeTentativa(['a', 'b', 'c'], 2), ['c', 'a', 'b']);
});

test('ordemDeTentativa: índice fora da lista é ignorado', () => {
  assert.deepEqual(ordemDeTentativa(['a', 'b'], 9), ['a', 'b']);
});

test('segmentosDaResposta: whisper com audio_processed vira janelas encadeadas', () => {
  const r = segmentosDaResposta({
    results: [
      { alternatives: [{ transcript: 'primeira parte' }], audio_processed: 30 },
      { alternatives: [{ transcript: '🎶' }], audio_processed: 45 },
      { alternatives: [{ transcript: 'segunda parte' }], audio_processed: 70.5 },
    ],
  });
  assert.deepEqual(r, [
    { text: 'primeira parte', startMs: 0, endMs: 30_000 },
    { text: 'segunda parte', startMs: 45_000, endMs: 70_500 },
  ]);
});

test('segmentosDaResposta: sem audio_processed, o tempo sai das palavras', () => {
  const r = segmentosDaResposta({
    results: [
      {
        alternatives: [
          { transcript: 'eu saí de casa', words: [{ start_time: 1200, end_time: 1500 }, { start_time: 2000, end_time: 2600 }] },
        ],
      },
      {
        alternatives: [{ transcript: 'cedo demais', words: [{ start_time: 5000, end_time: 5400 }, { start_time: 5500, end_time: 6100 }] }],
      },
    ],
  });
  assert.deepEqual(r, [
    { text: 'eu saí de casa', startMs: 1200, endMs: 2600 },
    { text: 'cedo demais', startMs: 5000, endMs: 6100 },
  ]);
});

test('segmentosDaResposta: nenhum relógio = inútil (lista vazia)', () => {
  const r = segmentosDaResposta({
    results: [{ alternatives: [{ transcript: 'a' }] }, { alternatives: [{ transcript: 'b' }] }],
  });
  assert.deepEqual(r, []);
});

test('há reserva para cada tipo de transcrição', () => {
  assert.ok(FUNCOES_PALAVRA.length >= 2);
  assert.ok(FUNCOES_SEGMENTO.length >= 2);
  for (const f of [...FUNCOES_PALAVRA, ...FUNCOES_SEGMENTO]) assert.match(f.id, /^[0-9a-f-]{36}$/);
});
