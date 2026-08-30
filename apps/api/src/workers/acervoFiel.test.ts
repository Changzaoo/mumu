/**
 * ESCONDER FAIXA É IRREVERSÍVEL NA PRÁTICA — a regra precisa ser óbvia.
 *
 * Este agente apaga o `remoteUrl` de entradas do acervo, e o app esconde
 * entrada sem cópia. Errar para o lado de "morta" tira do ar música que estava
 * viva; errar para o lado de "viva" só adia. Por isso os dois testes que
 * importam são: 404/403 é morte, e QUALQUER outra coisa não é — em especial o
 * 503, que é o cofre RECONSTRUINDO uma faixa podada e prestes a devolvê-la.
 *
 * E o patch não pode levar nada junto: o `sourceUrl` é o caminho de volta da
 * faixa, e perdê-lo transformaria "escondida por ora" em "perdida para sempre".
 */
import { describe, expect, it } from 'vitest';
import { semACopiaMorta, vereditoDeStatus } from './acervoFiel.worker.js';

describe('vereditoDeStatus', () => {
  it('404 e 403 são morte: o cofre não tem nem a meta da faixa', () => {
    expect(vereditoDeStatus(404)).toBe('morta');
    expect(vereditoDeStatus(403)).toBe('morta');
  });

  it('2xx/3xx é vida', () => {
    expect(vereditoDeStatus(200)).toBe('viva');
    expect(vereditoDeStatus(206)).toBe('viva');
    expect(vereditoDeStatus(302)).toBe('viva');
  });

  it('503 NÃO é morte — é o cofre reconstruindo a faixa podada', () => {
    expect(vereditoDeStatus(503)).toBe('incerta');
    expect(vereditoDeStatus(500)).toBe('incerta');
    expect(vereditoDeStatus(429)).toBe('incerta');
  });
});

describe('semACopiaMorta', () => {
  const morta = 'https://cofre/blob/local%3A1?k=abc';
  const entrada = {
    remoteUrl: morta,
    sourceUrl: 'https://www.youtube.com/watch?v=xyz',
    addedAt: '2026-08-01T00:00:00.000Z',
    track: { id: 'local:1', title: 'Faixa', streamUrl: morta, coverUrl: 'https://capa/1.jpg' },
  };

  it('tira a cópia morta e PRESERVA o caminho de volta', () => {
    const novo = semACopiaMorta(entrada, morta);
    expect(novo).not.toBeNull();
    expect(novo).not.toHaveProperty('remoteUrl');
    expect((novo?.track as Record<string, unknown>).streamUrl).toBeNull();
    // Nada mais pode sair junto: sem `sourceUrl` a faixa nunca volta.
    expect(novo?.sourceUrl).toBe(entrada.sourceUrl);
    expect(novo?.addedAt).toBe(entrada.addedAt);
    expect((novo?.track as Record<string, unknown>).title).toBe('Faixa');
    expect((novo?.track as Record<string, unknown>).coverUrl).toBe('https://capa/1.jpg');
  });

  it('não mexe quando a entrada já mudou de cópia — evita escrita à toa', () => {
    expect(semACopiaMorta(entrada, 'https://cofre/blob/outra?k=zzz')).toBeNull();
  });

  it('preserva um streamUrl que aponta para outro lugar', () => {
    const outra = { ...entrada, track: { ...entrada.track, streamUrl: 'https://outro/audio.mp3' } };
    const novo = semACopiaMorta(outra, morta);
    expect((novo?.track as Record<string, unknown>).streamUrl).toBe('https://outro/audio.mp3');
  });
});
