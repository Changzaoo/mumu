import { describe, expect, it } from 'vitest';
import { parseWhisperJson } from './whisper.js';

/** Minimal builder for the JSON shape the Whisper CLI emits. */
function whisperJson(segments: unknown[], language = 'pt'): string {
  return JSON.stringify({ language, segments, text: 'ignored' });
}

const word = (text: string, start: number, end: number) => ({
  word: text,
  start,
  end,
  probability: 0.9,
});

describe('parseWhisperJson', () => {
  it('reads the detected language', () => {
    const { language } = parseWhisperJson(whisperJson([{ start: 0, end: 1, text: 'oi' }], 'en'));
    expect(language).toBe('en');
  });

  it('falls back to segment text when no word timestamps are present', () => {
    const { lines } = parseWhisperJson(
      whisperJson([{ start: 1.25, end: 4, text: '  uma linha inteira  ' }]),
    );
    expect(lines).toEqual([{ timeMs: 1250, text: 'uma linha inteira' }]);
  });

  it('splits a long segment into readable lines at word boundaries', () => {
    // One 12s segment well past the 42-char cap — must not stay a single line.
    const words = [
      word('caminhando', 0, 1),
      word('contra', 1, 2),
      word('o', 2, 2.4),
      word('vento', 2.4, 3.2),
      word('sem', 3.2, 3.8),
      word('lenço', 3.8, 4.5),
      word('e', 4.5, 4.8),
      word('sem', 4.8, 5.4),
      word('documento', 5.4, 6.4),
    ];
    const { lines } = parseWhisperJson(
      whisperJson([{ start: 0, end: 6.4, text: words.map((w) => w.word).join(' '), words }]),
    );

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.text.length).toBeLessThanOrEqual(42);
    }
    // Timing must come from the first word of each line, in order.
    expect(lines[0]?.timeMs).toBe(0);
    expect(lines.map((l) => l.timeMs)).toEqual(
      [...lines.map((l) => l.timeMs)].sort((a, b) => a - b),
    );
    // No words lost in the fold.
    expect(lines.map((l) => l.text).join(' ')).toBe(words.map((w) => w.word).join(' '));
  });

  it('breaks a slow segment on the time cap even when it is short', () => {
    // Three words dragged across 20s: under the char cap, over the 7s cap.
    const words = [word('aaa', 0, 1), word('bbb', 9, 10), word('ccc', 18, 19)];
    const { lines } = parseWhisperJson(
      whisperJson([{ start: 0, end: 19, text: 'aaa bbb ccc', words }]),
    );
    expect(lines.length).toBeGreaterThan(1);
  });

  it('never emits an empty line when a single word blows the budget', () => {
    const long = 'a'.repeat(80);
    const { lines } = parseWhisperJson(
      whisperJson([{ start: 0, end: 2, text: long, words: [word(long, 0, 2)] }]),
    );
    expect(lines).toEqual([{ timeMs: 0, text: long }]);
  });

  it('drops empty and untimed segments instead of emitting blank lines', () => {
    const { lines } = parseWhisperJson(
      whisperJson([
        { start: 0, end: 1, text: '   ' },
        { start: null, end: 2, text: 'sem tempo' },
        { start: 3, end: 4, text: 'boa' },
      ]),
    );
    expect(lines).toEqual([{ timeMs: 3000, text: 'boa' }]);
  });

  it('returns no lines for an instrumental (no segments)', () => {
    expect(parseWhisperJson(whisperJson([])).lines).toEqual([]);
  });

  it('sorts lines by time even if segments arrive out of order', () => {
    const { lines } = parseWhisperJson(
      whisperJson([
        { start: 10, end: 11, text: 'depois' },
        { start: 2, end: 3, text: 'antes' },
      ]),
    );
    expect(lines.map((l) => l.text)).toEqual(['antes', 'depois']);
  });
});
