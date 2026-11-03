import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chaveDeDedup,
  deveTentar,
  escolherComMotivo,
  escolherResultado,
  estadoVazio,
  gravarEstado,
  lerEstado,
  lerLista,
  semRepetidas,
} from './semear.js';

const r = (titulo: string, canal = 'Djavan', duracaoSeg = 240) => ({
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  titulo,
  canal,
  duracaoSeg,
  capa: null,
});

describe('lerLista', () => {
  const ok = { fonte: 'x', coletadoEm: '2026-11-03', musicas: [{ artista: 'A', titulo: 'B' }] };
  it('aceita lista válida', () => {
    expect(lerLista(ok).musicas).toHaveLength(1);
  });
  it('rejeita lista inválida', () => {
    expect(() => lerLista(null)).toThrow();
    expect(() => lerLista({ ...ok, fonte: '' })).toThrow(/fonte/);
    expect(() => lerLista({ ...ok, musicas: 'x' })).toThrow(/musicas/);
    expect(() => lerLista({ ...ok, musicas: [{ artista: 'A' }] })).toThrow(/titulo/);
  });
});

describe('dedup', () => {
  it('ignora acento, caixa e parênteses', () => {
    expect(chaveDeDedup('Djavan', 'Oceano (Ao Vivo)')).toBe(chaveDeDedup('DJAVAN', 'oceano'));
    const m = semRepetidas([
      { artista: 'Djavan', titulo: 'Oceano' },
      { artista: 'djavan', titulo: 'OCEANO' },
      { artista: 'Djavan', titulo: 'Sina' },
    ]);
    expect(m).toHaveLength(2);
  });
});

describe('escolherResultado', () => {
  it('aceita a música certa', () => {
    const e = escolherResultado('Djavan', 'Oceano', [r('Djavan - Oceano (Clipe Oficial)')]);
    expect(e?.resultado.titulo).toContain('Oceano');
  });
  it('rejeita remix, ao vivo e título diferente', () => {
    expect(escolherResultado('Djavan', 'Oceano', [r('Djavan - Oceano (Remix)')])).toBeNull();
    expect(escolherResultado('Djavan', 'Oceano', [r('Djavan - Oceano ao vivo')])).toBeNull();
    expect(escolherResultado('Djavan', 'Oceano', [r('Djavan - Sina')])).toBeNull();
  });
  it('exige fronteira de palavra', () => {
    expect(escolherResultado('Djavan', 'Sin', [r('Djavan - Sina')])).toBeNull();
  });
  it('rejeita duração fora de 90 s a 8 min', () => {
    expect(escolherResultado('Djavan', 'Oceano', [r('Djavan - Oceano', 'Djavan', 60)])).toBeNull();
    expect(escolherResultado('Djavan', 'Oceano', [r('Djavan - Oceano', 'Djavan', 900)])).toBeNull();
  });
  it('prefere canal Topic', () => {
    const e = escolherResultado('Djavan', 'Oceano', [
      r('Djavan - Oceano', 'Fulano Uploads'),
      r('Djavan - Oceano', 'Djavan - Topic'),
    ]);
    expect(e?.resultado.canal).toBe('Djavan - Topic');
  });
  it('sem resultados devolve null', () => {
    expect(escolherResultado('Djavan', 'Oceano', [])).toBeNull();
  });
});

describe('estado retomável', () => {
  it('grava, relê e decide o que tentar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semear-'));
    try {
      const f = join(dir, 'e.json');
      expect(lerEstado(f)).toEqual(estadoVazio());
      const e = estadoVazio();
      e.feitas['a|b'] = { id: 'local:1', em: 'x' };
      e.semResultado['c|d'] = { em: 'x' };
      e.falhas['e|f'] = { em: 'x', motivo: 'm', tentativas: 3 };
      e.falhas['g|h'] = { em: 'x', motivo: 'm', tentativas: 1 };
      gravarEstado(f, e);
      const lido = lerEstado(f);
      expect(lido).toEqual(e);
      expect(deveTentar(lido, 'a|b')).toBe(false);
      expect(deveTentar(lido, 'c|d')).toBe(false);
      expect(deveTentar(lido, 'e|f')).toBe(false);
      expect(deveTentar(lido, 'g|h')).toBe(true);
      expect(deveTentar(lido, 'novo|x')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('escolherResultado — régua estrita (03/11/2026)', () => {
  it('"Ana" não casa "Mariana" nem "Ana Castela"', () => {
    expect(escolherResultado('Ana', 'Pipoco', [r('Mariana - Pipoco', 'Mariana', 171)])).toBeNull();
    expect(
      escolherResultado('Ana', 'Pipoco', [r('Ana Castela - Pipoco', 'Ana Castela', 171)]),
    ).toBeNull();
  });
  it('vídeo de OUTRO artista com o mesmo título não é escolhido', () => {
    expect(
      escolherResultado('Djavan', 'Oceano', [
        r('Gal Costa - Oceano', 'Gal Costa'),
        r('Oceano', 'Fulano'),
      ]),
    ).toBeNull();
  });
  it('cover, karaokê, reação e playlist não passam', () => {
    for (const t of [
      'Djavan - Oceano (cover)',
      'Oceano - Karaokê - Djavan',
      'REAGINDO a Djavan - Oceano',
      'Playlist Djavan: Oceano e mais',
      'Djavan - Oceano (slowed + reverb)',
      'Djavan - Oceano (Versão Estendida)',
    ]) {
      expect(escolherResultado('Djavan', 'Oceano', [r(t)])).toBeNull();
    }
  });
  it('empate entre gravações diferentes devolve null com o motivo', () => {
    const d = escolherComMotivo('Djavan', 'Oceano', [
      r('Djavan - Oceano', 'Canal A', 200),
      r('Djavan - Oceano (Lyrics)', 'Canal B', 290),
    ]);
    expect(d.escolha).toBeNull();
    expect(d.motivo).toMatch(/empate/);
  });
  it('a faixa gravada leva o artista e o título DA LISTA', () => {
    const e = escolherResultado('Djavan', 'Oceano', [r('DJAVAN - OCEANO (Clipe Oficial)')]);
    expect(e?.faixa).toEqual({ title: 'Oceano', artists: ['Djavan'] });
  });
  it('duração conhecida: ±15% ou 20 s', () => {
    expect(
      escolherComMotivo('Djavan', 'Oceano', [r('Djavan - Oceano', 'Djavan', 250)], 240).escolha,
    ).not.toBeNull();
    expect(
      escolherComMotivo('Djavan', 'Oceano', [r('Djavan - Oceano', 'Djavan', 330)], 240).escolha,
    ).toBeNull();
  });
});
