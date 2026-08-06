/**
 * A LETRA TEM QUE SER DESSA MÚSICA — falta de prova é reprovação.
 *
 * O casamento de título contra o LRCLIB é de propósito frouxo: "Warzone" precisa
 * casar com "Warzone (Remix)" e com "warzone". Frouxo assim, ele NUNCA pode
 * bastar sozinho — e bastava: quando a faixa não tinha artista conhecido (o
 * crédito "Desconhecido" é descartado antes da busca) e a linha do LRCLIB vinha
 * sem duração, a ausência dos dois dados contava como aprovação. Entrava a letra
 * de outra música, ia para o cache e ficava.
 *
 * A regra travada aqui: além do título, ou o ARTISTA bate, ou a DURAÇÃO bate.
 */
import { describe, expect, it } from 'vitest';
import { rowMatches, type LrclibRow } from '@/lib/lyrics/lyrics';

const linha = (r: Partial<LrclibRow>): LrclibRow => ({
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  ...r,
});

describe('a linha do LRCLIB é mesmo desta faixa?', () => {
  it('artista e duração batendo: aceita', () => {
    expect(rowMatches(linha({}), 'Warzone', ['Brandão85'], 166)).toBe(true);
  });

  it('título frouxo casa com a variação da mesma faixa', () => {
    expect(rowMatches(linha({ trackName: 'Warzone (Remix)' }), 'Warzone', ['Brandão85'], 166)).toBe(
      true,
    );
  });

  // ── O DEFEITO ────────────────────────────────────────────────────────────
  it('sem artista E sem duração, recusa — era aqui que entrava letra alheia', () => {
    const anonima = linha({ artistName: null, duration: null });
    expect(rowMatches(anonima, 'Warzone', [], 0)).toBe(false);
  });

  it('faixa sem artista conhecido ainda entra SE a duração provar', () => {
    // A prova mudou de dono, mas continua existindo.
    expect(rowMatches(linha({ artistName: null }), 'Warzone', [], 166)).toBe(true);
  });

  it('linha sem duração ainda entra SE o artista provar', () => {
    expect(rowMatches(linha({ duration: null }), 'Warzone', ['Brandão85'], 166)).toBe(true);
  });

  // ── o que já era recusado continua sendo ────────────────────────────────
  it('artista conhecido e diferente: recusa', () => {
    expect(
      rowMatches(linha({ artistName: 'Charlie Brown Jr.' }), 'Warzone', ['Brandão85'], 166),
    ).toBe(false);
  });

  it('duração longe demais: recusa (outra gravação da mesma música)', () => {
    expect(rowMatches(linha({ duration: 240 }), 'Warzone', ['Brandão85'], 166)).toBe(false);
  });

  it('título diferente: recusa antes de qualquer outra coisa', () => {
    expect(rowMatches(linha({ trackName: 'Só Os Loucos' }), 'Warzone', ['Brandão85'], 166)).toBe(
      false,
    );
  });

  it('acento e caixa não separam a mesma faixa', () => {
    expect(rowMatches(linha({ artistName: 'BRANDAO85' }), 'warzone', ['Brandão85'], 166)).toBe(
      true,
    );
  });
});
