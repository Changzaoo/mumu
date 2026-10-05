/**
 * O PULSO DE PROGRESSO É DE ~5 Hz — e o que dependia dos 60 Hz continua de pé.
 *
 * O `tick` era um rAF: 60 emissões/s até a store, que só grava a cada 200 ms.
 * Virou `setTimeout` encadeado de 200 ms, só com a tela acesa. Este arquivo
 * prova (1) a queda da cadência, (2) que o invariante de saída audível continua
 * rodando dentro do pulso (no máximo a cada 400 ms), (3) que nada novo repetido
 * roda com a tela apagada, e (4) que o pulso volta quando a tela acende.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

interface NoFalso {
  volume: number;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  duration: number;
  muted: boolean;
}
const howls: Array<{ node: NoFalso }> = [];

vi.mock('howler', () => {
  class MockHowl {
    handlers = new Map<string, () => void>();
    node: NoFalso = {
      volume: 1,
      currentTime: 0,
      paused: true,
      ended: false,
      duration: 180,
      muted: false,
    };
    _sounds = [{ _node: this.node, _volume: 1 }];
    _volume = 1;
    constructor() {
      howls.push(this as unknown as { node: NoFalso });
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

function esconder(oculta: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculta });
}

beforeEach(() => {
  howls.length = 0;
  vi.useFakeTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { userAgent: UA_ANDROID, platform: 'linux', maxTouchPoints: 0 });
  esconder(false);
});
afterEach(() => {
  esconder(false);
  vi.useRealTimers();
});

async function novoMotor() {
  vi.resetModules();
  const { AudioEngine } = await import('@/lib/audio/AudioEngine');
  return AudioEngine.getInstance();
}

/** Anda o relógio E o playhead do elemento, como o navegador faria tocando. */
function tocarPor(segundos: number): void {
  for (let t = 0; t < segundos; t += 0.05) {
    for (const h of howls) if (!h.node.paused) h.node.currentTime += 0.05;
    vi.advanceTimersByTime(50);
  }
}

describe('cadência do pulso', () => {
  it('~5 emissões por segundo (eram ~60) com a tela acesa', async () => {
    const engine = await novoMotor();
    let emissoes = 0;
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.on('timeupdate', () => void emissoes++); // depois do `load`, que emite uma
    tocarPor(10);
    // 10 s a 200 ms = 50; folga para a borda da janela. O rAF dava ~600.
    expect(emissoes).toBeGreaterThanOrEqual(45);
    expect(emissoes).toBeLessThanOrEqual(55);
    engine.destroy();
  });

  it('pausar para o pulso: nenhum temporizador fica rodando', async () => {
    const engine = await novoMotor();
    let emissoes = 0;
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.on('timeupdate', () => void emissoes++);
    tocarPor(1);
    engine.pause();
    const antes = emissoes;
    tocarPor(5);
    expect(emissoes).toBe(antes);
    expect(vi.getTimerCount()).toBe(0);
    engine.destroy();
  });
});

describe('o invariante de saída continua dentro do pulso', () => {
  it('elemento mudo por fora é corrigido em menos de 1 s (a conferência é de 400 ms)', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    tocarPor(1);
    const el = howls[0]!.node;
    el.muted = true; // alguém de fora calou o elemento
    tocarPor(1);
    expect(el.muted).toBe(false);
    engine.destroy();
  });

  it('volume do elemento fora do alvo (sem grafo) é recolocado', async () => {
    const engine = await novoMotor();
    engine.setVolume(0.6);
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    tocarPor(1);
    const el = howls[0]!.node;
    el.volume = 0; // ganho preso em zero
    tocarPor(1);
    expect(el.volume).toBeCloseTo(0.6, 2);
    engine.destroy();
  });
});

describe('tela apagada: nada novo repetido em segundo plano', () => {
  it('o pulso do primeiro plano não se reagenda; só o ticker oculto de 1 s segue', async () => {
    const engine = await novoMotor();
    let emissoes = 0;
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.on('timeupdate', () => void emissoes++);
    tocarPor(1);

    esconder(true);
    tocarPor(0.5); // deixa o pulso pendente disparar e (não) se reagendar
    const antes = emissoes;
    tocarPor(10);
    // Só o ticker oculto (1 s): ~10 emissões em 10 s, não ~50.
    const emOculto = emissoes - antes;
    expect(emOculto).toBeGreaterThanOrEqual(9);
    expect(emOculto).toBeLessThanOrEqual(11);
    // E o único repetido vivo é ele: o pulso não deixou um segundo temporizador.
    expect(vi.getTimerCount()).toBe(1);
    engine.destroy();
  });

  it('a tela acende: o pulso de 200 ms volta sozinho', async () => {
    const engine = await novoMotor();
    let emissoes = 0;
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.on('timeupdate', () => void emissoes++);
    esconder(true);
    tocarPor(2);
    esconder(false);
    document.dispatchEvent(new Event('visibilitychange'));
    const antes = emissoes;
    tocarPor(5);
    expect(emissoes - antes).toBeGreaterThanOrEqual(23);
    engine.destroy();
  });
});
