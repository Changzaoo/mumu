/**
 * CORPUS DE TÍTULOS DE VÍDEO (03/11/2026) — tabela de casos realistas
 * (funk, sertanejo, trap, pagode, gospel, forró, pop, k-pop, reggaeton, rock,
 * MPB, eletrônica) com o resultado ESPERADO escrito à mão, nunca copiado da
 * saída do parser. Se um caso falha, o parser é que está errado.
 *
 * Regra: nome da música no campo da música, gente no campo de artistas, selo
 * no campo do selo — e canal que não é gente nunca vira artista.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerTituloDeVideo } from '../tituloDeVideo.js';
import { ehGravadora } from '../gravadoraComoArtista.js';

interface Caso {
  id: string;
  grupo: string;
  video: string;
  canal: string | null;
  esperado: { titulo: string; artistas: string[]; gravadora?: string };
}

const casos = JSON.parse(
  readFileSync(new URL('./fixtures/titulosDeVideo.json', import.meta.url), 'utf8'),
) as Caso[];

describe('corpus de títulos de vídeo', () => {
  it('tem volume suficiente e cobre os gêneros pedidos', () => {
    expect(casos.length).toBeGreaterThanOrEqual(300);
    const grupos = new Set(casos.map((c) => c.grupo.split('/')[0]));
    for (const g of [
      'funk',
      'sertanejo',
      'trap',
      'pagode',
      'gospel',
      'forro',
      'pop',
      'kpop',
      'reggaeton',
      'rock',
      'mpb',
      'eletronica',
    ]) {
      expect(grupos.has(g), g).toBe(true);
    }
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
  });

  it.each(casos.map((c) => [`${c.id} ${c.grupo}: ${c.video} [${c.canal ?? ''}]`, c] as const))(
    '%s',
    (_nome, c) => {
      const r = lerTituloDeVideo(c.video, c.canal);
      const como = (t: string, a: string[]): string => `${t} || ${a.join(' ; ')}`;
      const got = como(r.title, r.artists);
      const exp = como(c.esperado.titulo, c.esperado.artistas);
      if (got !== exp) throw new Error(`GOT ${got} <> EXP ${exp}`);
      if (c.esperado.gravadora)
        expect(r.label?.toLowerCase()).toBe(c.esperado.gravadora.toLowerCase());
      // Invariante que vale para TODO caso: selo nunca é artista.
      for (const a of r.artists) expect(ehGravadora(a), `selo como artista: ${a}`).toBe(false);
    },
  );
});
