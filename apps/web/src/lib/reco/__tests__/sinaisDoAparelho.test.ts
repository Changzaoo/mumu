/**
 * OS SINAIS QUE ALIMENTAM A CONTINUAÇÃO DA FILA (rádio de parecidas, playlist
 * emendada) TÊM QUE SER DA CONTA LOGADA, NÃO DO APARELHO.
 *
 * `localHistory.list()` é o histórico do device inteiro; num aparelho
 * compartilhado, uma conta recém-logada herdaria o gosto de quem usou antes
 * dela. `listForCurrentUser()` é o filtro certo — ver `localHistory.ts`. Este
 * arquivo prova que `sinaisDoAparelho` usa o filtro certo, e cobre também os
 * dois sinais adicionados junto (afinidade de gênero e curtida da FAIXA, não
 * só do artista).
 */
import { describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

const f = (id: string, artista: string, genre = 'Trap'): TrackDto =>
  makeTrack(id, { genre, artists: [{ id: artista, name: artista, slug: '', imageUrl: null }] });

// Histórico "do aparelho" (outra conta, ou dado antigo sem uid) tem MUITO mais
// peso para "Outra Pessoa" — se ele vazasse, a afinidade dela dominaria.
const historicoDoAparelho = Array.from({ length: 20 }, (_, i) => ({
  track: f(`estranho${i}`, 'Outra Pessoa'),
  playedAt: new Date(2026, 0, 1).toISOString(),
}));
// Histórico DA CONTA logada: só "Matuê".
const historicoDaConta = [
  { track: f('m1', 'Matuê'), playedAt: new Date(2026, 0, 1).toISOString() },
  { track: f('m2', 'Matuê'), playedAt: new Date(2026, 0, 1).toISOString() },
];

vi.mock('@/lib/local/localHistory', () => ({
  list: () => historicoDoAparelho,
  listForCurrentUser: () => historicoDaConta,
}));

const curtidas: TrackDto[] = [f('curtida1', 'Zé Ninguém', 'Sertanejo')];
vi.mock('@/lib/local/localLikes', () => ({ list: () => curtidas }));

const { sinaisDoAparelho } = await import('@/lib/reco/sinaisDoAparelho');

describe('sinaisDoAparelho', () => {
  it('a afinidade vem do histórico DA CONTA, não do aparelho inteiro', () => {
    const sinais = sinaisDoAparelho();
    expect(sinais.afinidade?.(f('x', 'Matuê'))).toBeGreaterThan(0);
    // "Outra Pessoa" só existe no histórico do aparelho — vazou se aparecer.
    expect(sinais.afinidade?.(f('y', 'Outra Pessoa')) ?? 0).toBe(0);
  });

  it('afinidade de gênero reflete o que a conta ouve', () => {
    const sinais = sinaisDoAparelho();
    expect(sinais.afinidadeDeGenero?.(f('x', 'Matuê', 'Trap'))).toBeGreaterThan(0);
    expect(sinais.afinidadeDeGenero?.(f('z', 'Alguém', 'Jazz')) ?? 0).toBe(0);
  });

  it('curtida marca a FAIXA, não o artista dela', () => {
    const sinais = sinaisDoAparelho();
    expect(sinais.curtida?.(curtidas[0]!)).toBe(true);
    // Mesmo artista, faixa diferente e não curtida: não conta como curtida.
    expect(sinais.curtida?.(f('outra-faixa', 'Zé Ninguém', 'Sertanejo'))).toBe(false);
  });

  it('sem gosto (comGosto: false) devolve só o fator de pulo — a ordem é da playlist', () => {
    const sinais = sinaisDoAparelho({ comGosto: false });
    expect(sinais.afinidade).toBeUndefined();
    expect(sinais.afinidadeDeGenero).toBeUndefined();
    expect(sinais.curtida).toBeUndefined();
  });
});
