/**
 * O EMBED NASCE PRONTO PARA O MODO CLIPE — E ANTES DA API.
 *
 * O iframe é criado direto no clique, com tudo na URL: mudo e em autoplay,
 * sem controles, no segundo do som, e com `enablejsapi` + `origin` para a API
 * do YouTube se acoplar depois por `postMessage`. Se um destes parâmetros
 * sumir, o clipe ou não toca sozinho, ou toca com som em cima da música, ou
 * a API nunca consegue falar com ele (e a perseguição do áudio morre muda).
 */
import { describe, expect, it } from 'vitest';
import { criarIframeDoClipe, HOST_DO_EMBED, urlDoEmbed } from '../youtubeApi';

describe('urlDoEmbed', () => {
  it('leva autoplay mudo, sem controles, o início e a ponte com a API', () => {
    const u = new URL(urlDoEmbed('dQw4w9WgXcQ', 42.7, 'https://radinho.online'));
    expect(u.origin).toBe(HOST_DO_EMBED);
    expect(u.pathname).toBe('/embed/dQw4w9WgXcQ');
    const q = u.searchParams;
    expect(q.get('autoplay')).toBe('1');
    expect(q.get('mute')).toBe('1');
    expect(q.get('controls')).toBe('0');
    expect(q.get('playsinline')).toBe('1');
    expect(q.get('start')).toBe('42');
    expect(q.get('enablejsapi')).toBe('1');
    expect(q.get('origin')).toBe('https://radinho.online');
  });

  it('não começa antes do zero nem manda uma origem que não é http(s)', () => {
    const q = new URL(urlDoEmbed('dQw4w9WgXcQ', -3, 'file://')).searchParams;
    expect(q.get('start')).toBe('0');
    expect(q.has('origin')).toBe(false);
  });
});

describe('criarIframeDoClipe', () => {
  it('pendura o iframe na caixa já apontando para o embed, com autoplay permitido', () => {
    const caixa = document.createElement('div');
    const iframe = criarIframeDoClipe(caixa, 'dQw4w9WgXcQ', 10);
    expect(caixa.firstElementChild).toBe(iframe);
    expect(iframe.src.startsWith(`${HOST_DO_EMBED}/embed/dQw4w9WgXcQ?`)).toBe(true);
    expect(iframe.getAttribute('allow')).toContain('autoplay');
    expect(iframe.src).toContain('enablejsapi=1');
  });
});
