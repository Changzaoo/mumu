import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { generosDoGosto } from '../generosDoGosto';

function faixa(id: string, genre: string, artista: string): TrackDto {
  return {
    id,
    title: `t-${id}`,
    artists: [{ id: `a-${artista}`, name: artista }],
    genre,
  } as unknown as TrackDto;
}

function grupo(genre: string, n: number, artista = 'X') {
  return {
    genre,
    tracks: Array.from({ length: n }, (_, i) =>
      faixa(`${genre}-${i}`, genre, `${artista}${i % 4}`),
    ),
  };
}

describe('generosDoGosto', () => {
  const genres = [grupo('Pop', 30), grupo('Trap', 20), grupo('Rock', 10), grupo('Jazz', 5)];
  const now = new Date('2026-08-16T12:00:00Z');

  it('põe o gênero mais ouvido na frente, não o maior', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      track: faixa(`Trap-${i % 20}`, 'Trap', 'Y'),
      playedAt: now.toISOString(),
    }));
    const out = generosDoGosto(genres, history, [], { now });
    const first = out[0]!;
    expect(first.genre).toBe('Trap');
    expect(first.motivo).toBeTruthy();
  });

  it('limita o número de prateleiras e o tamanho por prateleira', () => {
    const out = generosDoGosto(genres, [], [], { now, maxGeneros: 2, porGenero: 6 });
    expect(out).toHaveLength(2);
    for (const p of out) expect(p.tracks.length).toBeLessThanOrEqual(6);
  });

  it('respeita o teto por artista quando há artistas distintos suficientes', () => {
    // 40 faixas, 40 artistas distintos → dá pra encher 12 sem repetir.
    const tracks = Array.from({ length: 40 }, (_, i) => faixa(`Pop-${i}`, 'Pop', `Art${i}`));
    const g = [{ genre: 'Pop', tracks }];
    const out = generosDoGosto(g, [], [], { now, maxGeneros: 1, porGenero: 12, maxPorArtista: 2 });
    const first = out[0]!;
    const cont = new Map<string, number>();
    for (const t of first.tracks) {
      const k = t.artists[0]!.name;
      cont.set(k, (cont.get(k) ?? 0) + 1);
    }
    for (const c of cont.values()) expect(c).toBeLessThanOrEqual(2);
    expect(first.tracks).toHaveLength(12);
  });

  it('enche a prateleira mesmo com poucos artistas (relaxa o teto por necessidade)', () => {
    const g = [grupo('Pop', 40, 'A')]; // só 4 artistas distintos (A0..A3)
    const out = generosDoGosto(g, [], [], { now, maxGeneros: 1, porGenero: 12, maxPorArtista: 2 });
    expect(out[0]!.tracks).toHaveLength(12);
  });

  it('é determinístico no mesmo dia', () => {
    const a = generosDoGosto(genres, [], [], { now });
    const b = generosDoGosto(genres, [], [], { now });
    expect(a.map((p) => p.genre)).toEqual(b.map((p) => p.genre));
    expect(a[0]!.tracks.map((t) => t.id)).toEqual(b[0]!.tracks.map((t) => t.id));
  });
});

describe('generosDoGosto — a semente do onboarding', () => {
  const genres = [grupo('Pop', 30), grupo('Trap', 20), grupo('Rock', 10), grupo('Jazz', 5)];
  const now = new Date('2026-08-16T12:00:00Z');

  it('no primeiro dia, o gênero escolhido passa na frente do maior do acervo', () => {
    // Sem histórico nem curtida, a ordem cairia no tamanho: Pop (30) primeiro.
    // É exatamente o caso que o onboarding existe para consertar.
    const semSemente = generosDoGosto(genres, [], [], { now });
    expect(semSemente[0]!.genre).toBe('Pop');

    const out = generosDoGosto(genres, [], [], { now, sementes: ['Jazz'] });
    expect(out[0]!.genre).toBe('Jazz');
    expect(out[0]!.motivo).toBe('Você escolheu ao entrar');
  });

  it('o comportamento real vence a escolha — quem disse rock e ouve trap vê trap', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      track: faixa(`Trap-${i}`, 'Trap', 'Y'),
      playedAt: now.toISOString(),
    }));
    const out = generosDoGosto(genres, history, [], { now, sementes: ['Rock'] });
    expect(out[0]!.genre).toBe('Trap');
    expect(out[0]!.motivo).toBe('Porque você ouve bastante');
  });

  it('a escolha perde força à medida que o histórico cresce, sem sumir de vez', () => {
    const posicaoDoJazz = (plays: number): number => {
      const history = Array.from({ length: plays }, (_, i) => ({
        track: faixa(`Pop-${i}`, 'Pop', 'Z'),
        playedAt: now.toISOString(),
      }));
      const out = generosDoGosto(genres, history, [], { now, sementes: ['Jazz'] });
      return out.findIndex((p) => p.genre === 'Jazz');
    };
    // Sem histórico manda; com histórico de sobra deixa de mandar…
    expect(posicaoDoJazz(0)).toBe(0);
    expect(posicaoDoJazz(60)).toBeGreaterThan(0);
    // …mas continua presente: o palpite vira desempate, não vira lixo.
    expect(posicaoDoJazz(60)).toBeGreaterThanOrEqual(0);
  });

  it('gênero escolhido que não existe no acervo não inventa prateleira', () => {
    const out = generosDoGosto(genres, [], [], { now, sementes: ['K-pop'] });
    expect(out.map((p) => p.genre)).not.toContain('K-pop');
    expect(out.length).toBeGreaterThan(0);
  });

  it('casa a escolha mesmo com diferença de caixa', () => {
    const out = generosDoGosto(genres, [], [], { now, sementes: ['jazz  '] });
    expect(out[0]!.genre).toBe('Jazz');
  });

  it('sem semente, a ordem é exatamente a de antes', () => {
    const antes = generosDoGosto(genres, [], [], { now });
    const depois = generosDoGosto(genres, [], [], { now, sementes: [] });
    expect(depois.map((p) => p.genre)).toEqual(antes.map((p) => p.genre));
  });
});
