import { describe, expect, it } from 'vitest';
import { computePeaks } from './waveform.js';

function pcmOf(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe('computePeaks', () => {
  it('returns all zeros for empty input', () => {
    expect(computePeaks(Buffer.alloc(0), 8)).toEqual(new Array(8).fill(0));
  });

  it('normalizes the loudest window to 1', () => {
    const peaks = computePeaks(pcmOf([0, 100, -200, 50, 32767, -32768, 10, 20]), 4);
    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it('uses the max absolute value per window', () => {
    // 2 windows of 2 samples: [1000, -4000] and [2000, 500]
    const peaks = computePeaks(pcmOf([1000, -4000, 2000, 500]), 2);
    expect(peaks[0]).toBe(1); // 4000 is the global max
    expect(peaks[1]).toBeCloseTo(0.5, 2);
  });
});
