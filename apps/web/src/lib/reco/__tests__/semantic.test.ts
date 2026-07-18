import { describe, expect, it } from 'vitest';
import {
  capPerKey,
  cosine,
  normalize,
  rankBySimilarity,
  recencyWeight,
  tasteVector,
  trackEmbeddingText,
} from '@/lib/reco/semantic';
import { makeTrack } from '@/test/factories';

describe('trackEmbeddingText', () => {
  it('junta título, artistas e gênero num texto estável', () => {
    const track = makeTrack('t1', {
      title: 'Sozinho',
      genre: 'MPB',
      artists: [{ id: 'a1', name: 'Caetano Veloso', slug: 'caetano', imageUrl: null }],
    });
    const text = trackEmbeddingText(track);
    expect(text).toContain('Sozinho');
    expect(text).toContain('Caetano Veloso');
    expect(text).toContain('MPB');
  });

  it('não quebra quando faltam gênero e álbum', () => {
    const track = makeTrack('t2', { title: 'Só o título', genre: null, album: null });
    expect(trackEmbeddingText(track)).toContain('Só o título');
  });
});

describe('cosine', () => {
  it('vale 1 para vetores idênticos e 0 para ortogonais', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('ignora magnitude — só a direção importa', () => {
    expect(cosine([1, 1], [10, 10])).toBeCloseTo(1);
  });

  it('devolve 0 para vetor nulo em vez de NaN', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([], [1])).toBe(0);
  });
});

describe('normalize', () => {
  it('devolve norma 1', () => {
    const v = normalize([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1);
  });

  it('não divide por zero', () => {
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});

describe('tasteVector', () => {
  it('puxa o centróide para o lado do sinal de maior peso', () => {
    const taste = tasteVector([
      { vector: [1, 0], weight: 3 },
      { vector: [0, 1], weight: 1 },
    ]);
    expect(taste).not.toBeNull();
    // Mais perto de [1,0] do que de [0,1] porque pesa 3×.
    expect(cosine(taste ?? [], [1, 0])).toBeGreaterThan(cosine(taste ?? [], [0, 1]));
  });

  it('normaliza antes de somar — magnitude não compra influência', () => {
    // Um vetor gigante na direção [0,1] não pode dominar dois na [1,0].
    const taste = tasteVector([
      { vector: [1, 0], weight: 1 },
      { vector: [0, 500], weight: 1 },
    ]);
    expect(cosine(taste ?? [], [1, 0])).toBeCloseTo(cosine(taste ?? [], [0, 1]), 5);
  });

  it('devolve null sem sinal utilizável', () => {
    expect(tasteVector([])).toBeNull();
    expect(tasteVector([{ vector: [], weight: 5 }])).toBeNull();
    expect(tasteVector([{ vector: [1, 0], weight: 0 }])).toBeNull();
  });
});

describe('recencyWeight', () => {
  it('cai pela metade a cada ~30 dias', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const hoje = recencyWeight('2026-07-18T12:00:00Z', now);
    const mes = recencyWeight('2026-06-18T12:00:00Z', now);
    expect(hoje).toBeCloseTo(1, 2);
    expect(mes).toBeCloseTo(0.5, 1);
  });

  it('devolve 0 para data inválida em vez de NaN', () => {
    expect(recencyWeight('não é data')).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  it('ordena do mais parecido ao menos parecido', () => {
    const vectors: Record<string, number[]> = { a: [1, 0], b: [0.8, 0.6], c: [0, 1] };
    const ranked = rankBySimilarity([1, 0], ['a', 'b', 'c'], (id) => vectors[id] ?? null);
    expect(ranked.map((r) => r.item)).toEqual(['a', 'b', 'c']);
  });

  it('descarta quem ainda não tem vetor, em vez de mandá-lo para o fim', () => {
    const ranked = rankBySimilarity([1, 0], ['a', 'semvetor'], (id) =>
      id === 'a' ? [1, 0] : null,
    );
    expect(ranked.map((r) => r.item)).toEqual(['a']);
  });
});

describe('capPerKey', () => {
  it('limita quantos itens por chave entram no mix', () => {
    const ranked = [
      { item: 'x1', score: 0.9 },
      { item: 'x2', score: 0.8 },
      { item: 'x3', score: 0.7 },
      { item: 'y1', score: 0.6 },
    ];
    const out = capPerKey(ranked, (s) => s[0] ?? '', 2);
    expect(out).toEqual(['x1', 'x2', 'y1']);
  });

  it('preserva a ordem de afinidade', () => {
    const ranked = [
      { item: 'a', score: 0.9 },
      { item: 'b', score: 0.5 },
    ];
    expect(capPerKey(ranked, () => 'k', 10)).toEqual(['a', 'b']);
  });
});
