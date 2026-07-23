import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

const howlCtor = vi.fn();

vi.mock('howler', () => {
  class MockHowl {
    constructor(options: unknown) {
      howlCtor(options);
    }
    on = vi.fn();
    once = vi.fn();
    unload = vi.fn();
    duration = vi.fn(() => 0);
    seek = vi.fn(() => 0);
    playing = vi.fn(() => false);
    play = vi.fn();
    pause = vi.fn();
    rate = vi.fn();
    volume = vi.fn();
    fade = vi.fn();
  }

  return {
    Howl: MockHowl,
    Howler: {},
  };
});

vi.mock('@/lib/api', () => ({
  resolveMediaUrl: (url: string) => url,
}));

import { AudioEngine } from '@/lib/audio/AudioEngine';

describe('AudioEngine format hint', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    howlCtor.mockClear();
    engine = AudioEngine.getInstance();
  });

  afterEach(() => {
    engine.destroy();
  });

  it('não força MP3 quando a URL não tem extensão', () => {
    engine.load(makeTrack('t1', { streamUrl: 'https://cdn.example/stream?id=1' }), {
      autoplay: false,
    });

    const options = howlCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toBeTruthy();
    expect(options).not.toHaveProperty('format');
  });

  it('mantém hint de formato quando a extensão existe', () => {
    engine.load(makeTrack('t2', { streamUrl: 'https://cdn.example/audio/file.ogg?token=x' }), {
      autoplay: false,
    });

    const options = howlCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toBeTruthy();
    expect(options).toHaveProperty('format');
    expect(options.format).toEqual(['ogg']);
  });
});
