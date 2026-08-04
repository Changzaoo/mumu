/**
 * Troca de faixa com a tela apagada: "toca um pouco e logo para".
 *
 * A ordem antiga era matar a faixa velha e SÓ ENTÃO começar a nova. Entre as
 * duas cabe todo o carregamento da nova — segundos numa rede de celular — e
 * nesse buraco a página fica sem mídia nenhuma tocando. O Android lê isso como
 * "esse app parou" e encerra a sessão de mídia; quando o áudio novo enfim sai,
 * o sistema o pausa logo em seguida.
 *
 * O teste olha para a única coisa que o sistema operacional olha: existiu ou
 * não um instante sem elemento tocando entre uma faixa e outra.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

// `vi.mock` é içado para o topo do arquivo: as classes que a fábrica usa
// precisam nascer antes dela, e é isso que `vi.hoisted` garante.
const { FakeHowl } = vi.hoisted(() => {
  /** Elemento de áudio de mentira, só com o que o engine toca. */
  class FakeAudioNode {
    paused = true;
    currentTime = 0;
    duration = 180;
    ended = false;
    volume = 1;
    playbackRate = 1;
    preservesPitch = true;
    crossOrigin: string | null = null;
    seekable = { length: 0, end: (): number => 0 };
    buffered = { length: 0, start: (): number => 0, end: (): number => 0 };
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    play = vi.fn(() => {
      this.paused = false;
      this.currentTime = 0.05; // o navegador só anda depois de começar de verdade
      return Promise.resolve();
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
  }

  /** Howl de mentira: guarda os handlers para o teste disparar o 'load'. */
  class FakeHowlImpl {
    static instances: FakeHowlImpl[] = [];
    handlers = new Map<string, () => void>();
    node = new FakeAudioNode();
    _sounds = [{ _node: this.node }];
    unloaded = false;
    loaded = false;
    playPendente = false;

    constructor() {
      FakeHowlImpl.instances.push(this);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    unload = vi.fn(() => {
      this.unloaded = true;
      this.node.pause();
    });
    duration = (): number => 180;
    seek = (): number => this.node.currentTime;
    playing = (): boolean => !this.node.paused;
    // Como o Howler: pedir play antes de carregar só ENFILEIRA o play.
    play = vi.fn(() => {
      if (this.loaded) void this.node.play();
      else this.playPendente = true;
    });
    pause = vi.fn(() => this.node.pause());
    rate = vi.fn();
    volume = vi.fn();
    fade = vi.fn();

    /** Dispara o 'load' como o Howler faria quando o áudio fica pronto. */
    finishLoading(): void {
      this.loaded = true;
      this.handlers.get('load')?.();
      if (this.playPendente) {
        this.playPendente = false;
        void this.node.play();
      }
    }
  }

  return { FakeHowl: FakeHowlImpl };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: {} }));
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));

/** Grafo Web Audio mínimo — o engine só precisa que os nós se conectem. */
function fakeGain(): unknown {
  return {
    gain: {
      value: 0,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createGain = vi.fn(fakeGain);
  createBiquadFilter = vi.fn(() => ({
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createAnalyser = vi.fn(() => ({
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
}

import { AudioEngine } from '@/lib/audio/AudioEngine';

describe('troca de faixa não deixa a página sem mídia', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    FakeHowl.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    engine = AudioEngine.getInstance();
  });

  afterEach(() => {
    engine.destroy();
    vi.unstubAllGlobals();
  });

  const ultimoHowl = (): InstanceType<typeof FakeHowl> => {
    const howl = FakeHowl.instances.at(-1);
    if (!howl) throw new Error('nenhum Howl foi criado');
    return howl;
  };

  /** Carrega uma faixa e deixa ela tocando de verdade. */
  function tocar(id: string): InstanceType<typeof FakeHowl> {
    engine.load(makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3` }));
    const howl = ultimoHowl();
    howl.finishLoading();
    return howl;
  }

  it('a faixa que sai só é derrubada depois de a nova começar', () => {
    const primeira = tocar('a');
    expect(primeira.node.paused).toBe(false);

    // Troca de faixa. A nova ainda está carregando — é aqui que o buraco existia.
    engine.load(makeTrack('b', { streamUrl: 'https://cdn.example/b.mp3' }));
    const segunda = ultimoHowl();

    expect(segunda.node.paused).toBe(true); // ainda não carregou
    expect(primeira.unloaded).toBe(false);
    expect(primeira.node.paused).toBe(false); // ← sem isto o Android nos corta

    // A nova fica pronta e começa: só então a velha pode cair.
    segunda.finishLoading();
    expect(segunda.node.paused).toBe(false);
  });

  it('derruba a faixa que sai assim que a nova está tocando', async () => {
    const primeira = tocar('a');
    engine.load(makeTrack('b', { streamUrl: 'https://cdn.example/b.mp3' }));
    ultimoHowl().finishLoading();

    await vi.waitFor(() => expect(primeira.unloaded).toBe(true));
  });

  it('pausado, não há sessão de mídia a preservar: derruba na hora', () => {
    const primeira = tocar('a');
    engine.pause();

    engine.load(makeTrack('b', { streamUrl: 'https://cdn.example/b.mp3' }));
    expect(primeira.unloaded).toBe(true);
  });

  it('retoma o contexto suspenso ao começar a faixa nova', () => {
    tocar('a');
    const { ctx } = engine as unknown as { ctx: FakeAudioContext };
    ctx.resume.mockClear();

    engine.load(makeTrack('b', { streamUrl: 'https://cdn.example/b.mp3' }));
    ultimoHowl().finishLoading();

    expect(ctx.resume).toHaveBeenCalled();
  });
});
