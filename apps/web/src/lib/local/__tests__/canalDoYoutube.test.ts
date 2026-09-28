import { describe, expect, it } from 'vitest';
import { isPlaylistUrl } from '@/lib/local/importerHelper';

describe('link de canal do YouTube é uma lista', () => {
  it('@nome, channel/UC…, c/… e user/…, com ou sem a aba', () => {
    for (const u of [
      'https://www.youtube.com/@30praum',
      'https://www.youtube.com/@30praum/videos',
      'https://m.youtube.com/@30praum/featured',
      'https://www.youtube.com/channel/UCoHV8LxUFKeIvifJsB3c7Ww',
      'https://www.youtube.com/c/Fulano/videos',
      'https://www.youtube.com/user/fulano',
    ]) {
      expect(isPlaylistUrl(u), u).toBe(true);
    }
  });
  it('vídeo e outras páginas do canal não são lista', () => {
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isPlaylistUrl('https://www.youtube.com/@30praum/community')).toBe(false);
  });
});
