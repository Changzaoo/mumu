/**
 * O GOSTO MORA NO localStorage — E O localStorage PODE ESTAR TORTO.
 *
 * JSON inválido, versão antiga, array com `null`: nada disso pode derrubar a Home
 * nem a fila. Cada teste reinicia os módulos, porque os três guardam cache de módulo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';

let uidAtual: string | null = null;
let ouvinte: ((u: { uid: string } | null) => void) | null = null;
vi.mock('@/lib/firebase', () => ({
  subscribeAuth: (cb: (u: { uid: string } | null) => void) => {
    ouvinte = cb;
    cb(uidAtual ? { uid: uidAtual } : null);
    return () => undefined;
  },
}));
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({
    setUser: () => undefined,
    push: () => undefined,
    remove: () => undefined,
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  uidAtual = null;
  ouvinte = null;
  vi.resetModules();
});

const faixa = (id: string): TrackDto => makeTrack(id);
const play = (id: string, uid?: string | null) => ({
  id: `p-${id}`,
  playedAt: '2026-07-14T00:00:00.000Z',
  playedMs: 60_000,
  source: 'queue',
  uid,
  track: faixa(id),
});

describe('localHistory com armazenamento ruim', () => {
  it.each([
    ['JSON inválido', '{nao é json'],
    ['não é array', '{"a":1}'],
    ['string vazia', ''],
  ])('%s: lista vazia, sem exceção', async (_nome, bruto) => {
    window.localStorage.setItem('aurial:local-history', bruto);
    const h = await import('@/lib/local/localHistory');
    expect(h.list()).toEqual([]);
    expect(h.listForCurrentUser()).toEqual([]);
  });

  it('entradas nulas/sem faixa no array não chegam a quem recomenda', async () => {
    window.localStorage.setItem(
      'aurial:local-history',
      JSON.stringify([null, 3, {}, { track: null }, play('ok')]),
    );
    const h = await import('@/lib/local/localHistory');
    expect(h.listForCurrentUser().map((e) => e.track.id)).toEqual(['ok']);
  });

  it('GOSTO É DA CONTA: com uid logado, plays de outra conta não entram', async () => {
    uidAtual = 'ana';
    window.localStorage.setItem(
      'aurial:local-history',
      JSON.stringify([play('da-ana', 'ana'), play('do-beto', 'beto'), play('antigo', null)]),
    );
    const h = await import('@/lib/local/localHistory');
    expect(
      h
        .listForCurrentUser()
        .map((e) => e.track.id)
        .sort(),
    ).toEqual(['antigo', 'da-ana']);
    expect(ouvinte).not.toBeNull();
  });
});

describe('localLikes com armazenamento ruim', () => {
  it('JSON inválido nos dois baús: sem curtidas, sem exceção', async () => {
    window.localStorage.setItem('aurial:local-likes', 'xx');
    window.localStorage.setItem('aurial:local-liked-tracks', '[[');
    const l = await import('@/lib/local/localLikes');
    expect(l.list()).toEqual([]);
    expect(l.count()).toBe(0);
  });

  it('id curtido cuja faixa sumiu, ou virou null, não vira curtida fantasma', async () => {
    window.localStorage.setItem('aurial:local-likes', JSON.stringify(['a', 'b', 'c']));
    window.localStorage.setItem(
      'aurial:local-liked-tracks',
      JSON.stringify({ a: faixa('a'), b: null }),
    );
    const l = await import('@/lib/local/localLikes');
    expect(l.list().map((t) => t.id)).toEqual(['a']);
  });
});

describe('pulos com armazenamento ruim', () => {
  it('JSON inválido: sem pulos', async () => {
    window.localStorage.setItem('aurial:pulos', '%%%');
    const p = await import('@/lib/reco/pulos');
    expect(p.lerPulos()).toEqual([]);
  });

  it('pulo nulo/torto no array não derruba o fator nem o registro de um pulo novo', async () => {
    const p = await import('@/lib/reco/pulos');
    // Injeta lixo pelo mesmo caminho do armazenamento: a chave real é descoberta
    // registrando um pulo válido primeiro.
    p.registrarPulo(faixa('x'), 5, 200);
    const [chaveReal] = Object.keys(window.localStorage).filter((k) => k.includes('pulo'));
    expect(chaveReal).toBeDefined();
    window.localStorage.setItem(
      chaveReal!,
      JSON.stringify([null, 7, { id: 'y' }, { id: 'x', em: Date.now(), fracao: 0.1 }]),
    );
    vi.resetModules();
    const p2 = await import('@/lib/reco/pulos');
    expect(() => p2.fatorDePulo(faixa('x'), p2.lerPulos(), Date.now())).not.toThrow();
    expect(() => p2.registrarPulo(faixa('z'), 5, 200)).not.toThrow();
  });
});
