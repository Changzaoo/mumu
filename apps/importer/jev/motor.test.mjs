/**
 * O motor decide sem modelo: `embed` falso devolve vetores conhecidos, e a
 * memória falsa devolve vizinhos prontos. O que se prova aqui é a aritmética
 * (softmax, votos, mistura, confiança) e o contrato das respostas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confiancaDe,
  criteriosDe,
  decidir,
  misturar,
  softmax,
  textoDoCriterio,
  votosDaMemoria,
} from './motor.mjs';

/** Vetores 2D normalizados: ângulo → [cos, sin]. */
const v = (graus) => {
  const r = (graus * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};
/** `embed` falso: cada texto conhecido tem um ângulo; desconhecido fica em 90°. */
const embedDe = (mapa) => async (textos) => textos.map((t) => v(mapa[t] ?? 90));

test('softmax soma 1 e a temperatura abre ou fecha a distribuição', () => {
  const p = softmax([0.9, 0.8, 0.1], 0.05);
  assert.ok(Math.abs(p.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
  const frio = softmax([0.9, 0.8, 0.1], 0.01);
  assert.ok(frio[0] > p[0]); // mais frio = mais decidido
});

test('confiança é a margem entre a melhor e a segunda', () => {
  assert.ok(Math.abs(confiancaDe({ a: 0.7, b: 0.2, c: 0.1 }) - 0.5) < 1e-9);
  assert.equal(confiancaDe({ a: 0.5, b: 0.5 }), 0);
});

test('critério vira texto legível, com rótulo', () => {
  assert.equal(textoDoCriterio('baile funk', 'Funk'), 'Funk: baile funk');
  assert.equal(textoDoCriterio(null, 'Rock'), 'Rock');
  assert.equal(
    textoDoCriterio({ bpm: 'alto', clima: 'festa' }, 'Dance'),
    'Dance; bpm: alto; clima: festa',
  );
});

test('choice zero-shot: o critério mais parecido com o estado ganha', async () => {
  const embed = embedDe({
    'MC Kevin - Perto de Mim': 10,
    'Funk: baile funk': 12,
    'Rock: guitarra': 80,
  });
  const r = await decidir(
    {
      state: 'MC Kevin - Perto de Mim',
      questions: { genero: { type: 'choice', criteria: { Funk: 'baile funk', Rock: 'guitarra' } } },
    },
    { embed },
  );
  const a = r.answers.genero;
  assert.equal(a.type, 'choice');
  assert.equal(a.choice, 'Funk');
  assert.ok(a.probabilities.Funk > 0.9);
  assert.ok(a.confidence > 0.8);
  assert.equal(a.evidence, 0);
});

test('a memória vence o zero-shot quando tem vizinhos de verdade', async () => {
  // Zero-shot diria Rock (critério mais perto); 10 vizinhos quase idênticos dizem Funk.
  const embed = embedDe({ 'Faixa X': 10, 'Funk: baile funk': 60, 'Rock: guitarra': 12 });
  const memoria = {
    vizinhos: async () => Array.from({ length: 10 }, () => ({ rotulo: 'Funk', semelhanca: 0.97 })),
  };
  const r = await decidir(
    {
      state: 'Faixa X',
      questions: { genero: { type: 'choice', criteria: { Funk: 'baile funk', Rock: 'guitarra' } } },
    },
    { embed, memoria },
  );
  assert.equal(r.answers.genero.choice, 'Funk');
  assert.ok(r.answers.genero.evidence > 0.9);
});

test('vizinho pouco parecido não é evidência', () => {
  const { evidencia, probabilidades } = votosDaMemoria(
    [
      { rotulo: 'Funk', semelhanca: 0.5 },
      { rotulo: 'Rock', semelhanca: 0.6 },
    ],
    ['Funk', 'Rock'],
  );
  assert.equal(evidencia, 0);
  assert.equal(probabilidades.Funk, 0);
});

test('mistura: sem evidência fica o zero-shot; com evidência total fica a memória', () => {
  const zero = { a: 0.8, b: 0.2 };
  assert.deepEqual(misturar(zero, { probabilidades: { a: 0, b: 1 }, evidencia: 0 }), zero);
  assert.deepEqual(misturar(zero, { probabilidades: { a: 0, b: 1 }, evidencia: 1 }), {
    a: 0,
    b: 1,
  });
});

test('score: nota esperada entre os níveis, com legenda', async () => {
  const embed = embedDe({
    'música calma': 10,
    'nível 0: lenta': 12,
    'nível 1: média': 50,
    'nível 2: agitada': 100,
  });
  const r = await decidir(
    {
      state: 'música calma',
      questions: { energia: { type: 'score', criteria: ['lenta', 'média', 'agitada'] } },
    },
    { embed },
  );
  const a = r.answers.energia;
  assert.equal(a.type, 'score');
  assert.ok(a.score >= 0 && a.score < 0.5);
  assert.equal(a.legend['2'], 'agitada');
});

test('noul: probabilidade de sim, com critérios true/false ou só a instrução', async () => {
  const embed = embedDe({
    'letra com palavrão': 10,
    'sim: tem palavrão': 12,
    'não: letra limpa': 90,
  });
  const r = await decidir(
    {
      state: 'letra com palavrão',
      questions: {
        explicita: { type: 'noul', criteria: { true: 'tem palavrão', false: 'letra limpa' } },
      },
    },
    { embed },
  );
  assert.equal(r.answers.explicita.type, 'noul');
  assert.ok(r.answers.explicita.noul > 0.9);
  const c = criteriosDe({ type: 'noul', instructions: 'é ao vivo' });
  assert.deepEqual(
    c.map((x) => x.rotulo),
    ['true', 'false'],
  );
});

test('pedido inválido é recusado com erro claro', async () => {
  const embed = embedDe({});
  await assert.rejects(decidir({ state: 'x', questions: {} }, { embed }), /vazio/);
  await assert.rejects(
    decidir({ state: 'x', questions: { q: { type: 'choice', criteria: { a: 1 } } } }, { embed }),
    /2 a 255/,
  );
  await assert.rejects(
    decidir({ state: 'x', questions: { q: { type: 'box' } } }, { embed }),
    /choice, score ou noul/,
  );
});
