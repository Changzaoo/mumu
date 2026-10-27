/**
 * PARA ONDE VAI O CLIQUE — a regra do Spotify Connect, testada sem Firestore.
 *
 * Medido em 27/10/2026: o moto g34 (app) morreu em segundo plano com a presença
 * dizendo "tocando" e o computador mandou cliques e seeks para um aparelho
 * mudo; depois, com o celular pausado, cada clique no computador começava a
 * tocar NO COMPUTADOR em vez de continuar no celular. Estes testes prendem as
 * duas correções: o dono da posse recebe o clique mesmo pausado, e quem não
 * responde deixa de receber até dar sinal de vida.
 */
import { describe, expect, it } from 'vitest';
import { escolherAlvoRemoto } from '../alvoRemoto';
import type { DeviceInfo } from '../presence';

function aparelho(id: string, extra: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id,
    name: id,
    isSelf: false,
    isPlaying: false,
    isActive: false,
    online: true,
    track: { title: 'x', artist: 'y', coverUrl: null },
    trackId: 'local:x',
    volume: 1,
    progress: 0,
    duration: 100,
    seenAt: 1_000,
    aparelho: null,
    rate: 1,
    sono: null,
    eq: null,
    ...extra,
  };
}

describe('escolherAlvoRemoto', () => {
  it('manda para quem está tocando', () => {
    const lista = [aparelho('pc', { isSelf: true }), aparelho('celular', { isPlaying: true })];
    expect(escolherAlvoRemoto(lista, 'pc')?.id).toBe('celular');
  });

  it('manda para o dono da posse mesmo pausado (continuar no celular)', () => {
    const lista = [aparelho('pc', { isSelf: true }), aparelho('celular', { isActive: true })];
    expect(escolherAlvoRemoto(lista, 'pc')?.id).toBe('celular');
  });

  it('quem toca ganha do dono pausado', () => {
    const lista = [
      aparelho('tablet', { isActive: true }),
      aparelho('celular', { isPlaying: true }),
    ];
    expect(escolherAlvoRemoto(lista, 'pc')?.id).toBe('celular');
  });

  it('nunca manda para si mesmo, nem para offline, nem para quem não tem faixa', () => {
    const lista = [
      aparelho('pc', { isPlaying: true, isActive: true }),
      aparelho('velho', { isActive: true, online: false }),
      aparelho('vazio', { isPlaying: true, track: null }),
    ];
    expect(escolherAlvoRemoto(lista, 'pc')).toBeNull();
  });

  it('pula quem não respondeu até ele publicar de novo', () => {
    const lista = [aparelho('celular', { isPlaying: true, seenAt: 1_000 })];
    const surdos = new Map([['celular', 5_000]]);
    expect(escolherAlvoRemoto(lista, 'pc', surdos)).toBeNull();

    const vivo = [aparelho('celular', { isPlaying: true, seenAt: 9_000 })];
    expect(escolherAlvoRemoto(vivo, 'pc', surdos)?.id).toBe('celular');
  });
});
