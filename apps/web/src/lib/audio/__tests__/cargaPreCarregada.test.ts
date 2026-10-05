/**
 * A FAIXA PROMOVIDA TEM QUE SAIR — três jeitos de ela ficar muda que não davam erro.
 *
 *  1. Sem grafo (Android), voltar para a faixa que a mistura ainda aposentava a
 *     promove no meio de uma rampa de volume rumo a 0: a rampa seguia e a faixa
 *     pedida tocava muda.
 *  2. Uma pré-carga que falha ENQUANTO ociosa não avisava ninguém (os handlers de
 *     erro só falam pelo slot ativo). Promovida, era silêncio sem causa.
 *  3. O ticker do rAF era reagendado DEPOIS dos ouvintes: um que lançasse parava o
 *     progresso, o temporizador de fim e o preload com a música ainda tocando.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

interface Falso {
  handlers: Map<string, () => void>;
  node: { volume: number; currentTime: number; paused: boolean; ended: boolean; duration: number };
  _sounds: Array<{ _node: Falso['node']; _volume: number }>;
  _volume: number;
}
const howls: Falso[] = [];

vi.mock('howler', () => {
  class MockHowl {
    handlers = new Map<string, () => void>();
    node = { volume: 1, currentTime: 0, paused: true, ended: false, duration: 180 };
    _sounds: Falso['_sounds'];
    _volume = 1;
    constructor(o: { volume?: number }) {
      this._volume = o.volume ?? 1;
      this.node.volume = this._volume;
      this._sounds = [{ _node: this.node, _volume: this._volume }];
      howls.push(this as unknown as Falso);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    unload = vi.fn();
    duration = vi.fn(() => 180);
    seek = vi.fn(() => 0);
    playing = vi.fn(() => !this.node.paused);
    play = vi.fn(() => {
      this.node.paused = false;
    });
    pause = vi.fn(() => {
      this.node.paused = true;
    });
    rate = vi.fn(() => 1);
    state = vi.fn(() => 'loading');
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

async function novoMotor() {
  vi.resetModules();
  const { AudioEngine } = await import('@/lib/audio/AudioEngine');
  return AudioEngine.getInstance();
}

describe('promoção de slot sem grafo (Android)', () => {
  it('voltar para a faixa que a mistura aposentava NÃO a deixa muda', async () => {
    const engine = await novoMotor();
    engine.setVolume(0.8);
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.load(makeTrack('b', { streamUrl: 'https://x/b.mp3' }), { crossfadeSeconds: 2 });
    vi.advanceTimersByTime(1000); // a está a meio caminho de 0

    // "Anterior" nos primeiros segundos de b: promove o slot de a, ainda montado.
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));

    const a = howls[0]!;
    expect(a._sounds[0]!._node.volume).toBeCloseTo(0.8);
    // O fim da rampa antiga (e o timer da mistura) não pode derrubá-la depois.
    vi.advanceTimersByTime(3000);
    expect(a._sounds[0]!._node.volume).toBeCloseTo(0.8);
    expect(a._sounds[0]!._volume).toBeCloseTo(0.8); // o play do Howler relê isto
    engine.destroy();
  });
});

describe('pré-carga que falhou enquanto ociosa', () => {
  it('avisa o erro de carga quando é PROMOVIDA — e não antes', async () => {
    const engine = await novoMotor();
    const erros: Array<{ kind: string; track: { id: string } | null }> = [];
    engine.on('error', (e) => erros.push(e));

    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/morta.mp3' }));
    // A fonte da pré-carga morre (404) com o slot ocioso: ninguém pode reagir
    // a uma faixa que nem começou.
    howls[1]!.handlers.get('loaderror')?.();
    expect(erros).toHaveLength(0);

    engine.load(makeTrack('b', { streamUrl: 'https://x/morta.mp3' }));
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatchObject({ kind: 'load', track: { id: 'b' } });
    engine.destroy();
  });

  it('pré-carga saudável promovida não emite erro nenhum', async () => {
    const engine = await novoMotor();
    const erros: unknown[] = [];
    engine.on('error', (e) => erros.push(e));
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/b.mp3' }));
    engine.load(makeTrack('b', { streamUrl: 'https://x/b.mp3' }));
    expect(erros).toHaveLength(0);
    engine.destroy();
  });
});

describe('ticker', () => {
  it('um ouvinte que lança não para o ticker (progresso e fim de faixa seguem)', async () => {
    const engine = await novoMotor();
    let chamadas = 0;
    let lancar = false;
    engine.on('timeupdate', () => {
      chamadas++;
      if (lancar) {
        lancar = false;
        throw new Error('ouvinte quebrado');
      }
    });
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    lancar = true; // só no ticker (o `load` também emite 'timeupdate')
    // A exceção do ouvinte continua visível (não é engolida), mas o próximo
    // pulso já estava agendado. O pulso é de ~200 ms (era um rAF de 16 ms — a
    // cadência caiu de propósito, ver `tick` no motor), daí as janelas de 250 ms.
    let pegou = false;
    try {
      vi.advanceTimersByTime(250);
    } catch {
      pegou = true;
    }
    expect(pegou).toBe(true);
    const antes = chamadas;
    vi.advanceTimersByTime(450);
    expect(chamadas).toBeGreaterThan(antes);
    engine.destroy();
  });
});
