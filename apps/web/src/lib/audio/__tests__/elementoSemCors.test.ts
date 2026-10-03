/**
 * "O TEMPO PASSA E A MÚSICA NÃO TOCA" — o elemento sem CORS que entra no grafo.
 *
 * `createMediaElementSource` não lança com mídia de outra origem carregada por um
 * elemento sem `crossOrigin`: o som passa a sair do contexto e o navegador o
 * zera. O `currentTime` continua andando, o contexto está `running`, o ganho é 1
 * — nenhum elo da cadeia está errado, e entrar no grafo é irreversível.
 *
 * O Howler abastece o próprio estoque com `new Audio()` cru no primeiro toque e
 * tira sempre do FIM dele; o estoque do app entra pela frente. Os elementos crus
 * eram os usados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

const { pool, howls } = vi.hoisted(() => ({
  pool: [] as Array<{ crossOrigin: string | null }>,
  howls: [] as Array<{
    handlers: Map<string, () => void>;
    node: Record<string, unknown>;
    _volume: number;
    _sounds: Array<{ _node: Record<string, unknown>; _volume: number }>;
  }>,
}));

vi.mock('howler', () => {
  class MockHowl {
    handlers = new Map<string, () => void>();
    node: Record<string, unknown>;
    _volume = 1;
    _sounds: Array<{ _node: Record<string, unknown>; _volume: number }>;
    constructor(o: { src: string[]; volume?: number }) {
      // Como o Howler: o elemento vem do FIM do estoque, e leva o src.
      const doEstoque = pool.pop() as Record<string, unknown> | undefined;
      this.node = doEstoque ?? { crossOrigin: null };
      Object.assign(this.node, {
        src: o.src[0],
        paused: true,
        muted: false,
        currentTime: 0,
        duration: 180,
        ended: false,
        volume: o.volume ?? 1,
        playbackRate: 1,
        seekable: { length: 0, end: (): number => 0 },
        buffered: { length: 0, start: (): number => 0, end: (): number => 0 },
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
      });
      this._sounds = [{ _node: this.node, _volume: 1 }];
      howls.push(this);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    unload = vi.fn();
    duration = (): number => 180;
    seek = (): number => 0;
    state = (): string => 'loaded';
    playing = (): boolean => !this.node.paused;
    play = vi.fn(() => {
      this.node.paused = false;
    });
    pause = vi.fn();
    rate = (): number => 1;
  }
  return { Howl: MockHowl, Howler: { _html5AudioPool: pool } };
});
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));

const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML) Chrome/124 Safari/537.36';

const fontes: unknown[] = [];
const ganhos: Array<{ gain: { value: number } }> = [];
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createGain = vi.fn(() => {
    const g = {
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    ganhos.push(g);
    return g;
  });
  createBiquadFilter = vi.fn(() => ({
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createAnalyser = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createMediaElementSource = vi.fn(() => {
    const f = { connect: vi.fn(), disconnect: vi.fn() };
    fontes.push(f);
    return f;
  });
}

beforeEach(() => {
  howls.length = 0;
  pool.length = 0;
  fontes.length = 0;
  ganhos.length = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { userAgent: UA_DESKTOP, platform: 'Linux', maxTouchPoints: 0 });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  // `Audio` do jsdom tem propriedades só-leitura; o Howler de mentira precisa escrever.
  vi.stubGlobal('Audio', function () {
    return { crossOrigin: null };
  });
});
afterEach(() => vi.unstubAllGlobals());

async function novoMotor() {
  vi.resetModules();
  const { AudioEngine } = await import('@/lib/audio/AudioEngine');
  return AudioEngine.getInstance();
}

describe('estoque do Howler no computador', () => {
  it('todo elemento do estoque vira CORS antes de o Howl pegar um', async () => {
    // Os "crus" que o próprio Howler cria no primeiro toque.
    pool.push({ crossOrigin: null }, { crossOrigin: null });
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://cdn.example/a.mp3' }));
    expect(howls[0]!.node.crossOrigin).toBe('anonymous');
    expect(pool.every((el) => el.crossOrigin === 'anonymous')).toBe(true);
    engine.destroy();
  });

  it('estoque vazio: o elemento que o Howl recebe também é CORS', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://cdn.example/a.mp3' }));
    expect(howls[0]!.node.crossOrigin).toBe('anonymous');
    engine.destroy();
  });
});

describe('rede de segurança: elemento sem CORS fica FORA do grafo', () => {
  it('não chama createMediaElementSource (senão sairia mudo) e o volume é do elemento', async () => {
    const engine = await novoMotor();
    engine.setVolume(0.6);
    engine.load(makeTrack('a', { streamUrl: 'https://cdn.example/a.mp3' }));
    // Simula o elemento cru que escapou do estoque.
    howls[0]!.node.crossOrigin = null;
    howls[0]!.handlers.get('load')?.();
    expect(fontes).toHaveLength(0);
    expect(howls[0]!.node.volume).toBeCloseTo(0.6);
    // Mudar o volume depois chega ao elemento (o master não o alcança).
    engine.setVolume(0.3);
    expect(howls[0]!.node.volume).toBeCloseTo(0.3);
    engine.destroy();
  });

  it('elemento CORS continua entrando no grafo', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://cdn.example/a.mp3' }));
    howls[0]!.handlers.get('load')?.();
    expect(fontes).toHaveLength(1);
    engine.destroy();
  });
});
