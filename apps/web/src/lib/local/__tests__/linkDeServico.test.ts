/**
 * LINK DO SPOTIFY/APPLE MUSIC/DEEZER/TIDAL ENTRA NA FILA.
 *
 * Antes o diálogo recusava na hora ("não dá para importar desse serviço"). Agora
 * o link só identifica a música e o importador baixa o áudio do YouTube — então
 * a validação aceita, e álbum/playlist do serviço é expandido como playlist.
 */
import { describe, expect, it } from 'vitest';
import { isPlaylistUrl, servicoDeMusicaLabel } from '@/lib/local/importerHelper';
import { validateImportUrl } from '@/lib/local/localLibrary';

describe('links de serviço de música', () => {
  it('reconhece os hosts dos serviços (e só eles)', () => {
    expect(servicoDeMusicaLabel('open.spotify.com')).toBe('Spotify');
    expect(servicoDeMusicaLabel('music.apple.com')).toBe('Apple Music');
    expect(servicoDeMusicaLabel('www.deezer.com')).toBe('Deezer');
    expect(servicoDeMusicaLabel('listen.tidal.com')).toBe('Tidal');
    expect(servicoDeMusicaLabel('open.spotify.com.evil.com')).toBeNull();
    expect(servicoDeMusicaLabel('www.youtube.com')).toBeNull();
  });

  it('validateImportUrl aceita faixa, álbum e playlist dos serviços', () => {
    for (const url of [
      'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
      'https://open.spotify.com/intl-pt/album/4yP0hdKOZPNshxUOjY0cZj',
      'https://music.apple.com/br/album/after-hours/1499378108?i=1499378615',
      'https://www.deezer.com/br/track/3135556',
      'https://tidal.com/browse/track/77646168',
    ]) {
      expect(validateImportUrl(url)).toEqual({ ok: true });
    }
  });

  it('o resto do domínio do Spotify segue recusado', () => {
    expect(validateImportUrl('https://podcasters.spotify.com/pod/show/x').ok).toBe(false);
  });

  it('álbum/playlist do serviço é playlist; faixa (inclusive ?i= da Apple) não', () => {
    expect(isPlaylistUrl('https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj')).toBe(true);
    expect(isPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(true);
    expect(isPlaylistUrl('https://www.deezer.com/br/playlist/908622995')).toBe(true);
    expect(isPlaylistUrl('https://music.apple.com/br/album/after-hours/1499378108')).toBe(true);
    expect(isPlaylistUrl('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b')).toBe(false);
    expect(
      isPlaylistUrl('https://music.apple.com/br/album/after-hours/1499378108?i=1499378615'),
    ).toBe(false);
    expect(isPlaylistUrl('https://www.deezer.com/track/3135556')).toBe(false);
  });
});
