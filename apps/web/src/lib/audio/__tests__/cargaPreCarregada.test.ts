/**
 * A FAIXA PROMOVIDA TEM QUE SAIR — três jeitos de ela ficar muda que não davam erro.
 *
 *  1. Sem grafo (Android), voltar para a faixa que a mistura ainda aposentava a
 *     promove no meio de uma rampa de volume rumo a 0: a rampa seguia e a faixa
 *     pedida tocava muda.
 *  2. Uma pré-carga que falha ENQUANTO ociosa não avisava ninguém (os handlers de
 *     erro só falam pelo slot ativo). Promovida, era silêncio sem causa — e,
 *     reusada pela troca de fonte, silêncio PARA SEMPRE: hoje é refeita do zero.
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
  unload: ReturnType<typeof vi.fn>;
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
  it('promover a faixa REFAZ o slot do zero — nunca reusa o elemento morto', async () => {
    // SEMÂNTICA MUDADA DE PROPÓSITO. Antes a promoção reusava o slot morto e
    // emitia 'error' para a store trocar de fonte; mas a troca de fonte (e a
    // retentativa) pedia a MESMA faixa, caía no mesmo atalho e reusava o
    // elemento morto outra vez: o título trocava e a música nunca começava
    // (cofre com 503 passageiro, fim natural de uma faixa). Agora o slot que
    // não serve é refeito: a carga nova vai à rede e, se falhar, falha como
    // faixa ATIVA — que é o que a store sabe tratar (fonte alternativa, pular).
    const engine = await novoMotor();
    const erros: Array<{ kind: string; track: { id: string } | null }> = [];
    engine.on('error', (e) => erros.push(e));

    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/morta.mp3' }));
    // A fonte da pré-carga morre (503) com o slot ocioso: ninguém pode reagir
    // a uma faixa que nem começou.
    howls[1]!.handlers.get('loaderror')?.();
    expect(erros).toHaveLength(0);
    expect(engine.faixaPreCarregada('b')).toBeNull(); // a store não promove morta

    engine.load(makeTrack('b', { streamUrl: 'https://x/morta.mp3' }));
    expect(howls).toHaveLength(3); // um Howl NOVO, e não o morto
    expect(howls[1]!.unload).toHaveBeenCalled();
    expect(erros).toHaveLength(0); // a tentativa nova ainda não falhou
    // Falhando de novo, agora é a faixa ativa: o erro chega à store.
    howls[2]!.handlers.get('loaderror')?.();
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatchObject({ kind: 'load', track: { id: 'b' } });
    engine.destroy();
  });

  it('a fonte alternativa da mesma faixa NÃO cai no slot morto', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/borda.mp3' }));
    howls[1]!.handlers.get('loaderror')?.();
    // A store trocou de fonte: mesma faixa, endereço novo.
    engine.load(makeTrack('b', { streamUrl: 'https://x/origem.mp3' }));
    expect(howls).toHaveLength(3);
    engine.destroy();
  });

  it('pré-carga viva com ENDEREÇO DIFERENTE do pedido também é refeita', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/velha.mp3' }));
    engine.load(makeTrack('b', { streamUrl: 'https://x/nova.mp3' }));
    expect(howls).toHaveLength(3);
    engine.destroy();
  });

  it('elemento em erro sem evento (slot ocioso) não conta como pré-carga', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    engine.preloadNext(makeTrack('b', { streamUrl: 'https://x/b.mp3' }));
    expect(engine.faixaPreCarregada('b')).not.toBeNull();
    // O navegador marcou o erro no elemento e o evento nunca chegou.
    (howls[1]!.node as { error?: unknown }).error = { code: 4 };
    expect(engine.faixaPreCarregada('b')).toBeNull();
    engine.load(makeTrack('b', { streamUrl: 'https://x/b.mp3' }));
    expect(howls).toHaveLength(3);
    engine.destroy();
  });

  it('preloadNext refaz uma pré-carga que morreu (segunda chance perto do fim)', async () => {
    const engine = await novoMotor();
    engine.load(makeTrack('a', { streamUrl: 'https://x/a.mp3' }));
    const b = makeTrack('b', { streamUrl: 'https://x/b.mp3' });
    engine.preloadNext(b);
    howls[1]!.handlers.get('loaderror')?.();
    engine.preloadNext(b); // o preload de ~12 s antes do fim
    expect(howls).toHaveLength(3);
    expect(engine.faixaPreCarregada('b')).not.toBeNull();
    engine.preloadNext(b); // viva: não refaz de novo
    expect(howls).toHaveLength(3);
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
