/**
 * CROSSFADE NO ANDROID: a faixa que entra NÃO pode ficar muda.
 *
 * O `howl.fade()` do Howler empurra o fade para uma fila interna quando o Howl
 * ainda não carregou ou o `play()` HTML5 está pendente (`_playLock`) — e essa
 * fila não anda depois de um 'play'. O volume ficava no 0 do `volume(0)` de
 * `load()` para sempre: a interface trocava e não saía som. Aqui o dublê do
 * Howl imita isso (fade/volume viram no-op), e o motor tem que chegar ao volume
 * cheio sozinho, escrevendo no elemento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

interface Falso {
  _sounds: Array<{ _node: { volume: number }; _volume: number }>;
  _volume: number;
}
const howls: Falso[] = [];

vi.mock('howler', () => {
  class MockHowl {
    _sounds = [{ _node: { volume: 1, currentTime: 0 }, _volume: 1 }];
    _volume = 1;
    constructor(o: { volume?: number }) {
      this._volume = o.volume ?? 1;
      this._sounds[0]!._volume = this._volume;
      this._sounds[0]!._node.volume = this._volume;
      howls.push(this as unknown as Falso);
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
    state = vi.fn(() => 'loading');
    // Fila do Howler travada: nada disto chega ao elemento.
    volume = vi.fn();
    fade = vi.fn();
  }
  return { Howl: MockHowl, Howler: {} };
});
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36';

beforeEach(() => {
  howls.length = 0;
  vi.useFakeTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { userAgent: UA_ANDROID, platform: 'linux', maxTouchPoints: 0 });
});
afterEach(() => vi.useRealTimers());

describe('crossfade sem grafo (Android)', () => {
  it('a que entra sobe até o volume cheio e a que sai chega a zero', async () => {
    vi.resetModules();
    const { AudioEngine } = await import('@/lib/audio/AudioEngine');
    const engine = AudioEngine.getInstance();
    engine.setVolume(0.8);
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.load(makeTrack('b', { streamUrl: 'https://x/b.mp3' }), { crossfadeSeconds: 2 });

    const [a, b] = howls as [Falso, Falso];
    expect(b._sounds[0]!._node.volume).toBe(0); // nasce em 0, sem depender da fila do Howler
    vi.advanceTimersByTime(1000);
    const meio = b._sounds[0]!._node.volume;
    expect(meio).toBeGreaterThan(0.2);
    expect(meio).toBeLessThan(0.6);

    vi.advanceTimersByTime(1200);
    expect(b._sounds[0]!._node.volume).toBeCloseTo(0.8);
    expect(b._sounds[0]!._volume).toBeCloseTo(0.8); // play/retomada relêem isto
    expect(a._sounds[0]!._node.volume).toBe(0);
    engine.destroy();
  });

  it('mudar o volume com o play pendente chega ao elemento (a fila do Howler não anda)', async () => {
    vi.resetModules();
    const { AudioEngine } = await import('@/lib/audio/AudioEngine');
    const engine = AudioEngine.getInstance();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.load(makeTrack('b', { streamUrl: 'https://x/b.mp3' }), { crossfadeSeconds: 2 });
    vi.advanceTimersByTime(2500);
    engine.setVolume(0.3);
    const b = howls[1]!;
    expect(b._sounds[0]!._node.volume).toBeCloseTo(0.3);
    expect(b._volume).toBeCloseTo(0.3);
    engine.destroy();
  });
});
