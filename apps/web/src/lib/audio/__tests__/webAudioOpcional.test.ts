/**
 * RF5/RNF5 — COM A TELA APAGADA, O SOM SAI DO `<audio>`, E DE MAIS NADA.
 *
 * ── POR QUE ESTE ARQUIVO NÃO TESTA "DESCONECTAR O GRAFO AO ESCONDER" ──
 *
 * O plano desta fase dizia: conectar o grafo Web Audio só com a página visível
 * e desconectar quando ela esconder. **Não dá, e a razão é física, não de
 * gosto**: depois que um elemento passa por `createMediaElementSource`, o som
 * deixa de sair dele e passa a sair do `AudioContext`. Desconectar o nó não
 * devolve o som ao elemento — deixa MUDO. A escolha é por elemento e para
 * sempre (ver o bloco no topo de `AudioEngine.ts`).
 *
 * O projeto já resolve isso de um jeito estritamente mais forte: no CELULAR o
 * grafo nunca nasce (`SEM_GRAFO_WEB_AUDIO`). Sem grafo não há o que
 * desconectar, o `<audio>` é a saída de verdade, e o sistema operacional o
 * trata como mídia — segue tocando com a tela apagada, aparece no bloqueio e
 * mantém a sessão viva. O preço, assumido, é não ter equalizador nem
 * visualizador no celular (`equalizadorDisponivel` diz isso à interface).
 *
 * O que se prende aqui é o efeito que RF5 pede, medido onde ele importa:
 * esconder a página não pode calar a música.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';
import { instalarArnesDeAudio } from '@/lib/audio/__tests__/arnesDeAudio';

const { FakeHowl, contadorDeContexto } = vi.hoisted(() => {
  const contador = { criados: 0 };
  class FakeHowlImpl {
    static instances: FakeHowlImpl[] = [];
    handlers = new Map<string, () => void>();
    node = {
      paused: true,
      currentTime: 0,
      duration: 180,
      ended: false,
      volume: 1,
      playbackRate: 1,
      preservesPitch: true,
      crossOrigin: null as string | null,
      seekable: { length: 0, end: (): number => 0 },
      buffered: { length: 0, start: (): number => 0, end: (): number => 0 },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
    };
    _sounds = [{ _node: this.node }];

    constructor() {
      FakeHowlImpl.instances.push(this);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    // `Howl.unload()` descarrega E PARA o som — sem isto o duplo mentiria
    // dizendo que dez faixas ficaram tocando ao mesmo tempo.
    unload = vi.fn(() => {
      this.node.paused = true;
    });
    duration = (): number => 180;
    seek = (): number => this.node.currentTime;
    playing = (): boolean => !this.node.paused;
    play = vi.fn(() => {
      this.node.paused = false;
      this.node.currentTime = 0.05;
    });
    pause = vi.fn(() => {
      this.node.paused = true;
    });
    rate = vi.fn();
    volume = vi.fn();
    fade = vi.fn();

    dispararLoad(): void {
      this.handlers.get('load')?.();
    }
  }
  return { FakeHowl: FakeHowlImpl, contadorDeContexto: contador };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: {} }));
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));
vi.mock('hls.js', () => ({ default: { isSupported: (): boolean => false, Events: {} } }));

/** Contexto que só existe para ser CONTADO: no celular ele não pode nascer. */
class ContextoContado {
  currentTime = 0;
  state = 'running';
  destination = {};
  constructor() {
    contadorDeContexto.criados++;
  }
  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createGain = vi.fn(() => ({
    gain: {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
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

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';

/** Reimporta o motor com o `navigator` do aparelho pedido — a decisão de grafo
 *  é lida no topo do módulo, então só um módulo novo a reavalia. */
async function motorPara(userAgent: string): Promise<typeof import('@/lib/audio/AudioEngine')> {
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    userAgent,
    platform: 'Linux',
    maxTouchPoints: userAgent === UA_ANDROID ? 5 : 0,
  });
  vi.resetModules();
  return import('@/lib/audio/AudioEngine');
}

/** Esconde a página e dispara o evento, como o sistema faz ao apagar a tela. */
function apagarATela(): void {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function acenderATela(): void {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('esconder a página não pode calar a música', () => {
  let arnes: ReturnType<typeof instalarArnesDeAudio>;

  beforeEach(() => {
    FakeHowl.instances = [];
    contadorDeContexto.criados = 0;
    arnes = instalarArnesDeAudio();
    vi.stubGlobal('AudioContext', ContextoContado);
    acenderATela();
  });

  afterEach(() => {
    acenderATela();
    arnes.restaurar();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('no celular nenhum AudioContext nasce, e a tela apagada não muda isso', async () => {
    const { AudioEngine } = await motorPara(UA_ANDROID);
    const engine = AudioEngine.getInstance();
    try {
      engine.load(makeTrack('a', { streamUrl: 'https://cdn.example/a.mp3' }));
      const howl = FakeHowl.instances.at(-1)!;
      howl.dispararLoad();
      expect(howl.node.paused).toBe(false);

      apagarATela();

      // Nenhum grafo em momento nenhum: não há o que desconectar, e por isso
      // não há como emudecer. É esta a garantia que RF5 precisa.
      expect(contadorDeContexto.criados).toBe(0);
      expect(howl.node.paused).toBe(false); // ← o som continua saindo do <audio>
    } finally {
      engine.destroy();
    }
  });

  it('no celular o equalizador se declara indisponível em vez de mentir', async () => {
    const { equalizadorDisponivel } = await motorPara(UA_ANDROID);
    // Um controle que não faz nada é pior que um controle ausente: a pessoa
    // mexe, não ouve diferença e conclui que o app está quebrado.
    expect(equalizadorDisponivel).toBe(false);
  });

  it('no computador o grafo existe — e esconder a página também não o derruba', async () => {
    const { AudioEngine } = await motorPara(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    );
    const engine = AudioEngine.getInstance();
    try {
      engine.load(makeTrack('b', { streamUrl: 'https://cdn.example/b.mp3' }));
      const howl = FakeHowl.instances.at(-1)!;
      howl.dispararLoad();
      expect(contadorDeContexto.criados).toBe(1);

      const { ctx } = engine as unknown as { ctx: ContextoContado };
      apagarATela();

      // Suspender ou desconectar aqui seria emudecer de propósito: o elemento
      // já não é mais a saída de som neste caminho.
      expect(ctx.suspend).not.toHaveBeenCalled();
      expect(howl.node.paused).toBe(false);

      // Ao voltar, o contexto é retomado — alguns navegadores o suspendem
      // sozinhos em segundo plano e sem isto o som não volta.
      ctx.resume.mockClear();
      acenderATela();
      expect(ctx.resume).toHaveBeenCalled();
    } finally {
      engine.destroy();
    }
  });

  it('um dono do foco de áudio: dez trocas, no máximo um elemento tocando', async () => {
    const { AudioEngine } = await motorPara(UA_ANDROID);
    const engine = AudioEngine.getInstance();
    try {
      for (let i = 0; i < 10; i++) {
        engine.load(makeTrack(`t${i}`, { streamUrl: `https://cdn.example/t${i}.mp3` }));
        FakeHowl.instances.at(-1)!.dispararLoad();
      }
      const tocando = FakeHowl.instances.filter((h) => !h.node.paused);
      expect(tocando).toHaveLength(1);
    } finally {
      engine.destroy();
    }
  });
});
