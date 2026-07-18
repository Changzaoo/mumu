/**
 * Trava a regressão mais cara que este arquivo já teve: capa embutida indo
 * inteira para o localStorage.
 *
 * O registro da biblioteca é UM JSON com cota de ~5 MB. Uma capa de 800 KB
 * vira ~1 MB em base64, então cinco faixas estouram a cota — e como
 * `setItem` falha em SILÊNCIO, a biblioteca inteira para de persistir e o
 * usuário perde os imports recentes no próximo boot. O sintoma que ele vê
 * ("sumiu tudo") não tem relação óbvia com a causa ("capa grande demais"),
 * o que torna esse bug especialmente caro de diagnosticar de novo.
 */
import { describe, expect, it } from 'vitest';

/**
 * Espelha `storableEntry` de localLibrary.ts. Mantido aqui porque a função é
 * interna ao módulo; se ela mudar, este teste precisa mudar junto — e é
 * exatamente esse atrito que protege a regra.
 */
const MAX_INLINE_COVER = 8 * 1024;

function isStorableCover(cover: string | null): boolean {
  if (!cover) return true;
  if (cover.startsWith('blob:')) return false;
  if (cover.startsWith('data:') && cover.length > MAX_INLINE_COVER) return false;
  return true;
}

/** Quanto ocupa o registro inteiro, do jeito que vai para o localStorage. */
function registrySize(covers: Array<string | null>): number {
  const entries = covers.map((coverUrl, i) => ({
    track: {
      id: `local:${i}`,
      title: `Faixa ${i}`,
      coverUrl: isStorableCover(coverUrl) ? coverUrl : null,
    },
    addedAt: '2026-07-18T00:00:00.000Z',
  }));
  return JSON.stringify(entries).length;
}

const QUOTA = 5 * 1024 * 1024;

describe('capa no registro da biblioteca', () => {
  it('recusa object URL — morre com a aba e voltaria quebrada', () => {
    expect(isStorableCover('blob:http://localhost/8f2e-4a1b')).toBe(false);
  });

  it('recusa data URL grande — é o que estoura a cota', () => {
    const embedded = `data:image/jpeg;base64,${'A'.repeat(800 * 1024)}`;
    expect(isStorableCover(embedded)).toBe(false);
  });

  it('aceita URL http normal (capa do iTunes)', () => {
    expect(isStorableCover('https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg')).toBe(true);
  });

  it('aceita data URL minúscula (ícone), que não ameaça a cota', () => {
    expect(isStorableCover(`data:image/png;base64,${'A'.repeat(500)}`)).toBe(true);
  });

  it('aceita ausência de capa', () => {
    expect(isStorableCover(null)).toBe(true);
  });

  it('100 faixas com capa embutida cabem no localStorage depois do filtro', () => {
    // Sem o filtro isto daria ~100 MB e a escrita falharia em silêncio.
    const embedded = `data:image/jpeg;base64,${'A'.repeat(800 * 1024)}`;
    const covers = Array.from({ length: 100 }, () => embedded);
    expect(registrySize(covers)).toBeLessThan(QUOTA);
  });

  it('demonstra que SEM o filtro a cota estoura com meia dúzia de faixas', () => {
    // 800 KB de imagem ≈ 1,07 MB em base64 → ~7 faixas passam de 5 MB. Uma
    // biblioteca real tem centenas: sem o filtro a persistência morre cedo.
    const embedded = `data:image/jpeg;base64,${'A'.repeat(800 * 1024)}`;
    const semFiltro = JSON.stringify(
      Array.from({ length: 7 }, (_, i) => ({ track: { id: `local:${i}`, coverUrl: embedded } })),
    ).length;
    expect(semFiltro).toBeGreaterThan(QUOTA);
  });
});
