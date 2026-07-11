import { describe, expect, it } from 'vitest';
import { cn, clamp, formatTime, trackArtistNames } from '@/lib/utils';
import { makeTrack } from '@/test/factories';

describe('cn', () => {
  it('merges conflicting tailwind classes, last one wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-fg', 'text-accent')).toBe('text-accent');
  });

  it('handles conditionals and arrays', () => {
    const hidden = [true, false][1];
    expect(cn('base', hidden && 'hidden', ['rounded-lg', undefined], { block: true })).toBe(
      'base rounded-lg block',
    );
  });
});

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('is safe for invalid input', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('trackArtistNames', () => {
  it('joins artist names', () => {
    const track = makeTrack('x', {
      artists: [
        { id: '1', name: 'A', slug: 'a', imageUrl: null },
        { id: '2', name: 'B', slug: 'b', imageUrl: null },
      ],
    });
    expect(trackArtistNames(track)).toBe('A, B');
  });
});
