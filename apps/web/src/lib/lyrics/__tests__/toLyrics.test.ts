import { describe, expect, it } from 'vitest';
import { toLyrics } from '@/lib/lyrics/lyrics';

describe('toLyrics: LRC e preview', () => {
  it('lê [mm:ss.xx], [mm:ss.xxx], vários tempos por linha e ordena', () => {
    const l = toLyrics({ syncedLyrics: '[00:10.5]b\n[00:01.25][00:20.123]a' });
    expect(l?.synced).toBe(true);
    expect(l?.lines.map((x) => [x.timeMs, x.text])).toEqual([
      [1250, 'a'],
      [10500, 'b'],
      [20123, 'a'],
    ]);
  });

  it('aplica [offset:] (positivo adianta a letra)', () => {
    const l = toLyrics({ syncedLyrics: '[offset:+500]\n[00:02.00]x' });
    expect(l?.lines[0]?.timeMs).toBe(1500);
  });

  it('preview de 30s nunca recebe tempo da música inteira', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00]oi\n[00:05.00]tchau' }, true);
    expect(l?.synced).toBe(false);
    expect(l?.lines.map((x) => x.text)).toEqual(['oi', 'tchau']);
  });
});
