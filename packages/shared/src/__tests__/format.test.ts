import { describe, expect, it } from 'vitest';
import {
  dbToLinear,
  formatBytes,
  formatCompactNumber,
  formatDuration,
  formatDurationLong,
  replayGainDb,
  slugify,
} from '../utils/format.js';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(245000)).toBe('4:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59999)).toBe('0:59');
  });
  it('includes hours when needed', () => {
    expect(formatDuration(3845000)).toBe('1:04:05');
  });
  it('handles invalid input', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('formatDurationLong', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationLong(3720000)).toBe('1 h 2 min');
    expect(formatDurationLong(300000)).toBe('5 min');
    expect(formatDurationLong(3600000)).toBe('1 h');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB');
  });
});

describe('formatCompactNumber', () => {
  it('compacts large numbers', () => {
    expect(formatCompactNumber(1500, 'en-US')).toBe('1.5K');
  });
});

describe('slugify', () => {
  it('normalizes accents and spaces', () => {
    expect(slugify('Céu Azul — Ao Vivo!')).toBe('ceu-azul-ao-vivo');
    expect(slugify('  Multiple   Spaces ')).toBe('multiple-spaces');
  });
});

describe('replayGain', () => {
  it('computes gain toward -14 LUFS', () => {
    expect(replayGainDb(-10)).toBe(-4);
    expect(replayGainDb(-20)).toBe(6);
  });
  it('clamps boost at +12 dB', () => {
    expect(replayGainDb(-40)).toBe(12);
  });
  it('converts dB to linear', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.5, 1);
  });
});
