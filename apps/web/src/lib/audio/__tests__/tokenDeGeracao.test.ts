/**
 * RF1 — A TROCA RÁPIDA DE FAIXA NUNCA DEIXA O PLAYER PARADO.
 *
 * Quem aperta "próxima" cinco vezes seguidas dispara cinco `load()` antes de o
 * primeiro áudio sequer existir. Cada `load()` interrompe o `play()` que ainda
 * estava pendente do anterior, e o navegador responde a isso com um
 * **`AbortError`** — que NÃO é falha de reprodução: é o navegador dizendo "esse
 * pedido ficou obsoleto, o novo manda". Confundir os dois é o defeito:
 *
 *  1. o motor tratava toda rejeição de `play()` como bloqueio de autoplay,
 *     emitia `error` de tipo `'play'`, e a store respondia com `isPlaying:false`
 *     + um toast vermelho. O player ficava PARADO e acusando o navegador por um
 *     erro que ele mesmo tinha causado ao trocar de faixa;
 *  2. junto com o erro, o motor pendurava ouvintes de `pointerdown`/`keydown`
 *     para "retomar no próximo gesto" — de um elemento que já não é o da vez.
 *
 * O que estes testes prendem é o token de geração: todo `load`/`play` carrega um
 * `seq`, evento de slot com `seq` velho é descartado, e `AbortError` é engolido
 * em silêncio nos DOIS caminhos de slot (elemento e howler — risco 7 da fase 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';
import {
  instalarArnesDeAudio,
  type ElementoDeAudioFalso,
} from '@/lib/audio/__tests__/arnesDeAudio';

const { FakeHowl } = vi.hoisted(() => {
  /** Howl de mentira cujo `play()` pode rejeitar como o elemento real. */
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
    unloaded = false;

    constructor() {
      FakeHowlImpl.instances.push(this);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    unload = vi.fn(() => {
      this.unloaded = true;
      this.node.paused = true;
    });
    duration = (): number => 180;
    seek = (): number => 0;
    playing = (): boolean => !this.node.paused;
    play = vi.fn(() => {
      this.node.paused = false;
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
    /** O Howler chama 'playerror' quando o `play()` interno rejeita. */
    dispararPlayError(): void {
      this.handlers.get('playerror')?.();
    }
  }
  return { FakeHowl: FakeHowlImpl };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: {} }));
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));
// Sem MediaSource no jsdom o hls.js nem se aplica; o mock só torna o caminho
// determinístico (e rápido — o pacote real tem meio megabyte).
vi.mock('hls.js', () => ({ default: { isSupported: (): boolean => false, Events: {} } }));

import { AudioEngine, type AudioEngineEventMap } from '@/lib/audio/AudioEngine';

/** URL `.m3u8` força o caminho de ELEMENTO; `.mp3` força o caminho do howler. */
const porElemento = (id: string): ReturnType<typeof makeTrack> =>
  makeTrack(id, { streamUrl: `https://cdn.example/${id}/master.m3u8` });
const porHowler = (id: string): ReturnType<typeof makeTrack> =>
  makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3` });

describe('token de geração: trocar de faixa depressa não para o player', () => {
  let engine: AudioEngine;
  let arnes: ReturnType<typeof instalarArnesDeAudio>;
  let erros: AudioEngineEventMap['error'][];
  let carregadas: AudioEngineEventMap['loaded'][];

  beforeEach(() => {
    FakeHowl.instances = [];
    arnes = instalarArnesDeAudio();
    engine = AudioEngine.getInstance();
    erros = [];
    carregadas = [];
    engine.on('error', (e) => erros.push(e));
    engine.on('loaded', (e) => carregadas.push(e));
  });

  afterEach(() => {
    engine.destroy();
    arnes.restaurar();
    vi.unstubAllGlobals();
  });

  /** Deixa as promessas de `play()` (e as rejeições) chegarem aos `catch`. */
  const escoar = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it('AbortError no meio de cinco trocas não vira erro de reprodução', async () => {
    // Todo `play()` é interrompido pela carga seguinte — é o AbortError que o
    // navegador entrega em toda troca rápida de verdade.
    arnes.definirModoPadrao('abortar');
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      engine.load(porElemento(id));
      await escoar();
    }
    await escoar();

    // ANTES: a última rejeição chegava com o slot ainda ativo, virava
    // `error{kind:'play'}` e a store parava o player com um toast vermelho.
    expect(erros.filter((e) => e.kind === 'play')).toEqual([]);
    expect(erros).toEqual([]);
  });

  it('bloqueio de autoplay continua sendo reportado — o silêncio é só do AbortError', async () => {
    arnes.definirModoPadrao('bloqueado');
    engine.load(porElemento('a'));
    await escoar();

    // Perder isto trocaria um defeito por outro: sem o aviso, a faixa fica
    // parada e ninguém sabe que basta tocar na página.
    expect(erros.map((e) => e.kind)).toContain('play');
  });

  it('evento de slot velho não fala pela faixa nova', async () => {
    engine.load(porElemento('a'));
    const primeiro = arnes.criados.at(-1) as ElementoDeAudioFalso;
    for (const id of ['b', 'c', 'd', 'e']) {
      engine.load(porElemento(id));
      await escoar();
    }
    carregadas.length = 0;

    // O primeiro elemento só agora recebe a metadata da rede — quatro faixas
    // atrasado. Ele não pode reescrever a duração da que está tocando.
    primeiro.chegouMetadata(999);
    primeiro.falhou();

    expect(carregadas).toEqual([]);
    expect(erros).toEqual([]);
  });

  it('no caminho do howler o playerror não repõe uma faixa velha no ar', async () => {
    engine.load(porHowler('a'));
    const primeiro = FakeHowl.instances.at(-1)!;
    primeiro.dispararLoad();

    engine.load(porHowler('b'));
    const segundo = FakeHowl.instances.at(-1)!;
    segundo.dispararLoad();
    await escoar();

    primeiro.play.mockClear();
    primeiro.dispararPlayError(); // chega tarde, do slot que já saiu

    expect(primeiro.play).not.toHaveBeenCalled();
    expect(erros).toEqual([]);
  });

  it('depois de dez trocas, no máximo um elemento está tocando (RNF5)', async () => {
    for (let i = 0; i < 10; i++) {
      engine.load(porElemento(`f${i}`));
      await escoar();
    }
    await escoar();

    expect(arnes.tocando().length).toBeLessThanOrEqual(1);
  });
});
