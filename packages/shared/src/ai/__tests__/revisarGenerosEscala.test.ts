/**
 * `revisarGeneros` era O(N²): a 2ª passada chamava `generoDoArtista` por faixa
 * e cada chamada varria o acervo inteiro normalizando o nome de todo artista
 * (NFD + 2 regex). Num Moto G34 emulado com 5.744 faixas isso travou a thread
 * principal por ~165 s. Aqui ficam as duas provas de que o conserto é só de
 * CUSTO: a saída é idêntica à antiga, e o tempo deixou de crescer com N².
 */
import { describe, expect, it } from 'vitest';
import {
  generoDoArtista,
  generoDoSelo,
  indexarVotos,
  revisarGeneros,
  type FaixaMinima,
} from '../generoCoerencia.js';
import { acervoSintetico, prng } from './acervoSintetico.js';
import {
  generoDoArtistaLegado,
  generoDoSeloLegado,
  revisarGenerosLegado,
} from './revisarGenerosLegado.js';

/** FNV-1a de 32 bits: impressão digital curta de uma saída longa. */
function impressao(valor: unknown): string {
  const s = JSON.stringify(valor);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

describe('revisarGeneros — saída idêntica à implementação O(N²)', () => {
  it('bate com o gabarito antigo em acervos sintéticos variados', () => {
    let totalMudancas = 0;
    for (let semente = 1; semente <= 10; semente++) {
      const acervo = acervoSintetico(semente, 350, 40, semente % 2 === 0);
      const esperado = revisarGenerosLegado(acervo);
      totalMudancas += esperado.length;
      expect(revisarGeneros(acervo)).toEqual(esperado);
    }
    // O gerador precisa de fato provocar revisões, senão a igualdade é trivial.
    expect(totalMudancas).toBeGreaterThan(100);
  }, 60_000);

  it('cobre todos os motivos de revisão', () => {
    const motivos = new Set<string>();
    for (let semente = 1; semente <= 10; semente++) {
      for (const m of revisarGenerosLegado(acervoSintetico(semente, 350, 40, true)))
        motivos.add(m.motivo);
    }
    expect([...motivos].sort()).toEqual(
      ['balde', 'discrepante', 'genero-do-artista', 'genero-do-selo', 'normalizado'].sort(),
    );
  }, 60_000);

  it('saída congelada: impressão digital medida na implementação antiga', () => {
    const impressoes = [1, 2, 3].map((s) => impressao(revisarGeneros(acervoSintetico(s, 500, 40))));
    expect(impressoes).toEqual(['3545:98429102', '2796:e9bd6b13', '2791:f996f8c6']);
  });

  it('generoDoArtista / generoDoSelo públicos continuam iguais ao gabarito', () => {
    const acervo = acervoSintetico(7, 400, 30);
    const r = prng(99);
    for (let i = 0; i < 200; i++) {
      const f = acervo[Math.floor(r() * acervo.length)]!;
      const nome = f.artistas[0] ?? '';
      expect(generoDoArtista(acervo, nome, f.id)).toEqual(
        generoDoArtistaLegado(acervo, nome, f.id),
      );
      expect(generoDoArtista(acervo, nome)).toEqual(generoDoArtistaLegado(acervo, nome));
      const selo = f.label ?? '';
      expect(generoDoSelo(acervo, selo, f.id)).toEqual(generoDoSeloLegado(acervo, selo, f.id));
    }
  });
});

describe('indexarVotos — índice incremental', () => {
  it('continua igual ao gabarito depois de gêneros mudarem no lugar', () => {
    const acervo: FaixaMinima[] = acervoSintetico(5, 500, 40).map((f) => ({ ...f }));
    const indice = indexarVotos(acervo);
    const r = prng(1234);
    const generos = ['Pop', 'Gospel', 'Trap', 'Funk', null, 'lixo'];
    for (let passo = 0; passo < 300; passo++) {
      const alvo = acervo[Math.floor(r() * acervo.length)]!;
      alvo.genre = generos[Math.floor(r() * generos.length)]!;
      indice.atualizar(alvo);
      const f = acervo[Math.floor(r() * acervo.length)]!;
      const nome = f.artistas[0] ?? '';
      expect(indice.artista(nome, f.id)).toEqual(generoDoArtistaLegado(acervo, nome, f.id));
      expect(indice.artista(nome)).toEqual(generoDoArtistaLegado(acervo, nome));
      expect(indice.selo(f.label ?? '', f.id)).toEqual(
        generoDoSeloLegado(acervo, f.label ?? '', f.id),
      );
    }
  });
});

describe('revisarGeneros — escala', () => {
  it('6.000 faixas, ~900 artistas: bem abaixo de 1 s (teto folgado de 2 s)', () => {
    const acervo = acervoSintetico(42, 6000, 900);
    const t0 = performance.now();
    const mudancas = revisarGeneros(acervo);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[escala] revisarGeneros(6000 faixas, 900 artistas): ${ms.toFixed(0)} ms, ${mudancas.length} mudanças`,
    );
    expect(mudancas.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  }, 600_000);
});
