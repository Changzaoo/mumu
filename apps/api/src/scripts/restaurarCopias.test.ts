import { describe, expect, it } from 'vitest';
import { lerIndice, nomeDoBackup, restaurar, semRemoteUrl, urlDaCopia } from './restaurarCopias.js';

const indice = lerIndice(
  JSON.stringify({
    'local:aaa': { c: 'r1', a: 'faixas/a.mp3', k: 'k1', t: 'audio/mpeg' },
    'local:bbb': { c: 'r1', a: 'faixas/b.m4a', k: 'k2', t: 'audio/mp4' },
    'local:sem-t': { k: 'k3' },
    'local:sem-k': { c: 'r1' },
    'local:k-ruim': { k: 'a b&c' },
    lixo: 5,
    nulo: null,
  }),
);

describe('lerIndice', () => {
  it('descarta entradas sem k válido', () => {
    expect([...indice.keys()].sort()).toEqual(['local:aaa', 'local:bbb', 'local:sem-t']);
  });
  it('rejeita raiz que não é objeto', () => {
    expect(() => lerIndice('[]')).toThrow();
    expect(() => lerIndice('5')).toThrow();
    expect(() => lerIndice('null')).toThrow();
  });
});

describe('semRemoteUrl', () => {
  it.each([
    [{}, true],
    [null, true],
    [undefined, true],
    ['x', true],
    [{ remoteUrl: '' }, true],
    [{ remoteUrl: '   ' }, true],
    [{ remoteUrl: null }, true],
    [{ remoteUrl: 5 }, true],
    [{ remoteUrl: 'https://x/blob/a?k=1' }, false],
  ])('%j -> %s', (d, esp) => expect(semRemoteUrl(d)).toBe(esp));
});

describe('urlDaCopia', () => {
  it('codifica o id e põe o k', () => {
    expect(urlDaCopia('local:aaa', 'k1')).toBe(
      'https://importer.radinho.online/blob/local%3Aaaa?k=k1',
    );
  });
});

describe('restaurar', () => {
  it('grava remoteUrl, streamUrl e mimeType sem mexer no resto', () => {
    const dados = {
      titulo: 'x',
      mimeType: 'audio/ogg',
      track: { id: 'local:aaa', title: 'T', streamUrl: null },
    };
    const r = restaurar('local:aaa', dados, indice)!;
    const url = 'https://importer.radinho.online/blob/local%3Aaaa?k=k1';
    expect(r).toEqual({
      titulo: 'x',
      mimeType: 'audio/mpeg',
      remoteUrl: url,
      track: { id: 'local:aaa', title: 'T', streamUrl: url },
    });
    expect(dados.track.streamUrl).toBeNull(); // entrada não é mutada
  });
  it('mimeType vem do t do índice; padrão audio/mpeg', () => {
    expect(restaurar('local:bbb', {}, indice)!.mimeType).toBe('audio/mp4');
    expect(restaurar('local:sem-t', {}, indice)!.mimeType).toBe('audio/mpeg');
  });
  it('sem track cria track.streamUrl', () => {
    const r = restaurar('local:aaa', { remoteUrl: '' }, indice)!;
    expect((r.track as { streamUrl: string }).streamUrl).toBe(r.remoteUrl);
  });
  it('quem já tem remoteUrl não muda', () => {
    expect(restaurar('local:aaa', { remoteUrl: 'https://x/blob/a?k=1' }, indice)).toBeNull();
  });
  it('id fora do índice não muda', () => {
    expect(restaurar('local:zzz', {}, indice)).toBeNull();
    expect(restaurar('local:sem-k', {}, indice)).toBeNull();
  });
  it('dados inválidos (null/array) viram objeto novo só com a cópia', () => {
    expect(restaurar('local:aaa', null, indice)).not.toBeNull();
    expect(Array.isArray(restaurar('local:aaa', [1, 2], indice))).toBe(false);
  });
  it('é idempotente', () => {
    const r = restaurar('local:aaa', {}, indice)!;
    expect(restaurar('local:aaa', r, indice)).toBeNull();
  });
  it('em massa: 2000 entradas, URLs únicas e válidas', () => {
    const grande = lerIndice(
      JSON.stringify(
        Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`local:${i}`, { k: `k${i}` }])),
      ),
    );
    const urls = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const r = restaurar(`local:${i}`, { track: {} }, grande)!;
      urls.add(r.remoteUrl as string);
      expect(() => new URL(r.remoteUrl as string)).not.toThrow();
    }
    expect(urls.size).toBe(2000);
  });
});

describe('nomeDoBackup', () => {
  it('YYYYMMDD em UTC', () => {
    expect(nomeDoBackup(new Date('2026-11-03T15:00:00Z'))).toBe(
      'catalog_backup_remoteurl_20261103',
    );
  });
});
