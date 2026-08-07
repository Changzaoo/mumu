/**
 * GRAVAR O GÊNERO NÃO PODE APAGAR A FAIXA.
 *
 * As passagens de curadoria falam a sintaxe do Firestore: `{'track.genre': 'Trap'}`
 * significa "mude SÓ este campo". Lá isso era nativo. No Postgres o `data` é uma
 * coluna JSON e um `update` substitui o documento INTEIRO — então quem traduz é
 * o `aplicarPatch`.
 *
 * Se ele estiver errado, o estrago é máximo e silencioso: corrigir o gênero de
 * uma faixa apagaria título, artistas, capa e duração dela junto, em milhares de
 * faixas, sem erro nenhum no log. É o teste mais importante da migração.
 */
import { describe, expect, it } from 'vitest';
import { aplicarPatch } from './curation.worker.js';

const faixa = {
  track: {
    id: 'local:1',
    title: 'BENÇA',
    genre: 'Sertanejo',
    artists: [{ id: 'a1', name: 'Matuê' }],
    coverUrl: 'https://x/capa.jpg',
    durationMs: 180000,
  },
  addedAt: '2026-07-14T00:00:00.000Z',
  sizeBytes: 5037202,
};

describe('aplicarPatch — caminho pontilhado sobre JSON', () => {
  it('muda só o gênero e PRESERVA o resto da faixa', () => {
    const saida = aplicarPatch(faixa, { 'track.genre': 'Trap' });

    expect(saida.track?.genre).toBe('Trap');
    // O estrago que este teste existe para impedir:
    expect(saida.track?.title).toBe('BENÇA');
    expect(saida.track?.artists).toEqual([{ id: 'a1', name: 'Matuê' }]);
    expect(saida.track?.coverUrl).toBe('https://x/capa.jpg');
    expect(saida.track?.durationMs).toBe(180000);
    expect(saida.addedAt).toBe('2026-07-14T00:00:00.000Z');
    // `sizeBytes` não está no tipo — e é exatamente o ponto: campos que a
    // curadoria não conhece têm que atravessar a gravação intactos.
    expect((saida as Record<string, unknown>).sizeBytes).toBe(5037202);
  });

  it('grava campo de primeiro nível sem tocar em track', () => {
    const saida = aplicarPatch(faixa, { curatedAt: 1786000000000 });

    expect(saida.curatedAt).toBe(1786000000000);
    expect(saida.track?.title).toBe('BENÇA');
  });

  it('aceita vários caminhos de uma vez', () => {
    const saida = aplicarPatch(faixa, {
      'track.genre': 'Trap',
      'track.title': 'BENÇA (Remaster)',
      curatedAt: 1,
    });

    expect(saida.track?.genre).toBe('Trap');
    expect(saida.track?.title).toBe('BENÇA (Remaster)');
    expect(saida.curatedAt).toBe(1);
    expect(saida.track?.artists).toHaveLength(1);
  });

  it('grava null (é assim que o balde "Brasileira" é esvaziado)', () => {
    const saida = aplicarPatch(
      { track: { genre: 'Brasileira', title: 'X' } },
      {
        'track.genre': null,
      },
    );

    expect(saida.track?.genre).toBeNull();
    expect(saida.track?.title).toBe('X');
  });

  it('NÃO muta a entrada original', () => {
    const original = structuredClone(faixa);
    aplicarPatch(faixa, { 'track.genre': 'Trap' });

    // A varredura reusa o objeto entre passagens; mutar aqui faria uma passagem
    // enxergar o resultado da outra e decidir com dado que ainda não foi gravado.
    expect(faixa).toEqual(original);
  });

  it('cria o nível intermediário quando ele não existe', () => {
    const saida = aplicarPatch({}, { 'track.genre': 'Trap' });
    expect(saida.track?.genre).toBe('Trap');
  });

  it('não confunde array com objeto ao descer o caminho', () => {
    const saida = aplicarPatch(faixa, { 'track.artists': [{ id: 'a2', name: 'Teto' }] });
    expect(saida.track?.artists).toEqual([{ id: 'a2', name: 'Teto' }]);
    expect(saida.track?.title).toBe('BENÇA');
  });

  it('grava o vetor de DNA sem estragar a faixa', () => {
    const vetor = Array.from({ length: 8 }, (_, i) => i / 10);
    const saida = aplicarPatch(faixa, { dna: vetor });

    expect(saida.dna).toEqual(vetor);
    expect(saida.track?.title).toBe('BENÇA');
  });
});
