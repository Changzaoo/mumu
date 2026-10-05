/**
 * O REGISTRO DOS DOWNLOADS (localStorage) — leitura tolerante e sem custo
 * quadrado. Ele é lido no boot de TODA tela que mostra um botão de baixar; se a
 * leitura lança por uma entrada torta, a lista inteira de faixas quebra.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

const faixa = (id: string): TrackDto =>
  ({ id, title: id, artists: [], durationMs: 1 }) as unknown as TrackDto;

async function montar() {
  vi.resetModules();
  return import('@/features/downloads/registry');
}

beforeEach(() => window.localStorage.clear());

describe('registry de downloads', () => {
  it('entradas tortas no localStorage (null, sem track) não derrubam a leitura', async () => {
    window.localStorage.setItem(
      'aurial:downloads',
      JSON.stringify([null, {}, { track: null }, { track: faixa('ok'), sizeBytes: 5 }, 7]),
    );
    const reg = await montar();

    expect(() => reg.isDownloaded('x')).not.toThrow();
    expect(reg.isDownloaded('ok')).toBe(true);
    expect(reg.getDownloads().every((e) => typeof e?.track?.id === 'string')).toBe(true);
    expect(() => reg.totalDownloadedBytes()).not.toThrow();
  });

  it('JSON corrompido vira lista vazia, sem lançar', async () => {
    window.localStorage.setItem('aurial:downloads', '{nao e json');
    const reg = await montar();
    expect(reg.getDownloads()).toEqual([]);
  });

  it('o mesmo id duas vezes não duplica a linha nem soma o tamanho em dobro', async () => {
    const reg = await montar();
    reg.addDownload(faixa('a'), 100);
    reg.addDownload(faixa('a'), 100);
    expect(reg.getDownloads()).toHaveLength(1);
    expect(reg.totalDownloadedBytes()).toBe(100);
  });

  it('persiste e volta no próximo boot com a mesma chave (track.id)', async () => {
    const a = await montar();
    a.addDownload(faixa('persiste'), 10);
    const b = await montar();
    expect(b.isDownloaded('persiste')).toBe(true);
  });

  it('3.000 faixas baixadas × 3.000 consultas da lista não custam tempo quadrático perceptível', async () => {
    const reg = await montar();
    for (let i = 0; i < 3000; i++) reg.addDownload(faixa(`t${i}`), 1);
    const t0 = performance.now();
    let achadas = 0;
    for (let i = 0; i < 3000; i++) if (reg.isDownloaded(`t${i}`)) achadas += 1;
    expect(achadas).toBe(3000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
