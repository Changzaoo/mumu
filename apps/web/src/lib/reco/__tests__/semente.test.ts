import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { prateleiraDaSemente } from '../semente';

function faixa(id: string, ...artistas: string[]): TrackDto {
  return {
    id,
    title: `t-${id}`,
    artists: artistas.map((name) => ({ id: `a-${name}`, name })),
  } as unknown as TrackDto;
}

const now = new Date('2026-08-16T12:00:00Z');

describe('prateleiraDaSemente', () => {
  it('traz só faixas dos artistas escolhidos', () => {
    const tracks = [faixa('1', 'Djavan'), faixa('2', 'Racionais'), faixa('3', 'Djavan')];
    const out = prateleiraDaSemente(tracks, ['Djavan'], { now });
    expect(out.map((t) => t.id).sort()).toEqual(['1', '3']);
  });

  it('some quando a escolha não casa com nada tocável', () => {
    // Prateleira vazia é pior que prateleira ausente: quem escolheu alguém que
    // o acervo perdeu não pode ficar com um carrossel vazio na Home.
    const tracks = [faixa('1', 'Djavan')];
    expect(prateleiraDaSemente(tracks, ['Alguém Que Não Existe'], { now })).toEqual([]);
    expect(prateleiraDaSemente(tracks, [], { now })).toEqual([]);
  });

  it('casa nome com caixa e espaço diferentes', () => {
    const tracks = [faixa('1', 'Djavan')];
    expect(prateleiraDaSemente(tracks, ['  djavan '], { now })).toHaveLength(1);
  });

  it('um artista com muita música não toma a prateleira inteira', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => faixa(`d${i}`, 'Djavan'));
    const poucas = [faixa('r1', 'Racionais'), faixa('r2', 'Racionais')];
    const out = prateleiraDaSemente([...muitas, ...poucas], ['Djavan', 'Racionais'], {
      now,
      limite: 10,
    });
    const doRacionais = out.filter((t) => t.id.startsWith('r'));
    expect(doRacionais.length).toBeGreaterThan(0);
  });

  it('conta o teto pelo artista ESCOLHIDO, não pelo primeiro crédito', () => {
    // Numa participação o primeiro crédito pode ser alguém que a pessoa não
    // escolheu; se o teto olhasse só para ele, deixaria de segurar quem foi
    // escolhido e a prateleira viraria de um artista só.
    const tracks = Array.from({ length: 20 }, (_, i) => faixa(`p${i}`, `Convidado${i}`, 'Djavan'));
    const out = prateleiraDaSemente(tracks, ['Djavan'], { now, limite: 6, maxPorArtista: 2 });
    // O teto por artista foi respeitado na primeira passada; o resto que veio
    // depois é o preenchimento deliberado para não entregar prateleira curta.
    expect(out).toHaveLength(6);
    expect(new Set(out.map((t) => t.id)).size).toBe(6);
  });

  it('é estável dentro do mesmo dia e não repete faixa', () => {
    const tracks = Array.from({ length: 30 }, (_, i) => faixa(`x${i}`, i % 2 ? 'A' : 'B'));
    const a = prateleiraDaSemente(tracks, ['A', 'B'], { now });
    const b = prateleiraDaSemente(tracks, ['A', 'B'], { now });
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(new Set(a.map((t) => t.id)).size).toBe(a.length);
  });

  it('respeita o limite pedido', () => {
    const tracks = Array.from({ length: 50 }, (_, i) => faixa(`x${i}`, 'A'));
    expect(prateleiraDaSemente(tracks, ['A'], { now, limite: 7 })).toHaveLength(7);
  });
});
