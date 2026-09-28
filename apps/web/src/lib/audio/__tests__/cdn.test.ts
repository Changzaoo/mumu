import { describe, expect, it } from 'vitest';
import { candidatosDaCopia, marcarBordaFora, ordenarBordas } from '../cdn';

const ORIGEM = 'https://importer.exemplo.com';
const COPIA = `${ORIGEM}/blob/abc123?k=tok`;
const BORDAS = ['https://cdn1.exemplo.com', 'https://cdn2.exemplo.com', 'https://cdn3.exemplo.com'];

describe('cdn de áudio', () => {
  it('sem bordas configuradas, toca da origem', () => {
    expect(candidatosDaCopia(COPIA, [])).toEqual([COPIA]);
  });

  it('põe todas as bordas antes e a origem por último, com o mesmo caminho', () => {
    const c = candidatosDaCopia(COPIA, BORDAS, 0);
    expect(c).toHaveLength(4);
    expect(c[3]).toBe(COPIA);
    for (const url of c.slice(0, 3))
      expect(url).toMatch(/^https:\/\/cdn\d\.exemplo\.com\/blob\/abc123\?k=tok$/);
  });

  it('a mesma faixa escolhe sempre a mesma borda; faixas diferentes se espalham', () => {
    expect(ordenarBordas('/blob/a', BORDAS)).toEqual(ordenarBordas('/blob/a', BORDAS));
    const primeiras = new Set(
      Array.from({ length: 60 }, (_, i) => ordenarBordas(`/blob/f${i}`, BORDAS)[0]),
    );
    expect(primeiras.size).toBe(3);
  });

  it('tirar uma borda só muda as faixas que eram dela (hash consistente)', () => {
    const menos = BORDAS.slice(0, 2);
    for (let i = 0; i < 60; i++) {
      const antes = ordenarBordas(`/blob/f${i}`, BORDAS)[0]!;
      if (antes !== BORDAS[2]) expect(ordenarBordas(`/blob/f${i}`, menos)[0]).toBe(antes);
    }
  });

  it('borda que falhou fica de fora por um minuto', () => {
    const [primeira] = candidatosDaCopia(COPIA, BORDAS, 0);
    marcarBordaFora(primeira!, 1000);
    const agora = candidatosDaCopia(COPIA, BORDAS, 2000);
    expect(agora).toHaveLength(3);
    expect(agora).not.toContain(primeira);
    expect(candidatosDaCopia(COPIA, BORDAS, 1000 + 61_000)).toHaveLength(4);
  });

  it('não mexe no que não é cópia do cofre', () => {
    const vivo = `${ORIGEM}/stream?url=x&token=y`;
    expect(candidatosDaCopia(vivo, BORDAS)).toEqual([vivo]);
    expect(candidatosDaCopia('blob:local', BORDAS)).toEqual(['blob:local']);
  });
});
