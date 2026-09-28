import { describe, expect, it } from 'vitest';
import { extrairLink, prepararLink } from '../linkColado';

describe('link colado', () => {
  it('acha o link dentro do texto de compartilhamento', () => {
    expect(
      extrairLink('Ouça Garota de Ipanema no Spotify: https://open.spotify.com/track/abc?si=x.'),
    ).toBe('https://open.spotify.com/track/abc?si=x');
  });

  it('tira os rastreadores e mantém o que aponta a música', () => {
    const r = prepararLink('https://www.youtube.com/watch?v=abc&list=PL1&si=zz&utm_source=wa&t=30');
    expect(r).toEqual({ ok: true, url: 'https://www.youtube.com/watch?v=abc&list=PL1&t=30' });
    expect(prepararLink('https://open.spotify.com/track/abc?si=123#x')).toEqual({
      ok: true,
      url: 'https://open.spotify.com/track/abc',
    });
  });

  it('recusa o que não é site público', () => {
    for (const ruim of [
      'http://192.168.0.1/musica.mp3',
      'http://localhost:3000/x',
      'http://[::1]/x',
      'https://nas.local/x.mp3',
      'https://open.spotify.com@evil.example/x',
      'https://example.com:8080/a.mp3',
      'javascript:alert(1)',
      'sem link nenhum',
    ]) {
      expect(prepararLink(ruim).ok, ruim).toBe(false);
    }
  });
});
