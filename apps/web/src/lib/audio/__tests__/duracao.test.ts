/**
 * RF2 — O TEMPO TOTAL NUNCA É 0:00, NaN OU INFINITO.
 *
 * `HTMLMediaElement.duration` mente com frequência, e sempre do mesmo jeito:
 *
 *  - **`NaN`** antes do `loadedmetadata` — ou seja, durante todo o começo da
 *    faixa, que é justamente quando a pessoa olha para a barra;
 *  - **`Infinity`** em stream sem `Content-Length` (o `/stream` do ajudante
 *    responde em chunks, e é a fonte da maior parte do acervo importado);
 *  - **`0`** quando a fonte falhou e o elemento nunca chegou a saber nada.
 *
 * Nenhum desses três é um tempo. Mas o acervo SABE quanto dura a faixa — a
 * duração vem da importação e mora no registro (`durationMs`, IndexedDB e
 * catálogo). O defeito era o motor entregar o número do elemento cru: o evento
 * `loaded` saía com `Infinity`, e a duração conhecida, que estava ali do lado,
 * não era consultada.
 *
 * A regra que estes testes prendem: **nada não-finito sai de `getDuration()`
 * nem do evento `loaded`**, e a duração persistida cobre o buraco até o
 * elemento aprender a sua — quando aprender, ela ganha, porque é medida.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';
import { instalarArnesDeAudio } from '@/lib/audio/__tests__/arnesDeAudio';

const { FakeHowl } = vi.hoisted(() => {
  class FakeHowlImpl {
    static instances: FakeHowlImpl[] = [];
    /** O que `duration()` devolve — os testes trocam para NaN/Infinity/0. */
    duracaoRelatada: number = Number.NaN;
    handlers = new Map<string, () => void>();
    node = {
      paused: true,
      currentTime: 0,
      duration: Number.NaN,
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
    unload = vi.fn();
    duration = (): number => this.duracaoRelatada;
    seek = (): number => 0;
    playing = (): boolean => !this.node.paused;
    play = vi.fn(() => {
      this.node.paused = false;
    });
    pause = vi.fn();
    rate = vi.fn();
    volume = vi.fn();
    fade = vi.fn();

    dispararLoad(): void {
      this.handlers.get('load')?.();
    }
  }
  return { FakeHowl: FakeHowlImpl };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: {} }));
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));
vi.mock('hls.js', () => ({ default: { isSupported: (): boolean => false, Events: {} } }));

import { AudioEngine, type AudioEngineEventMap } from '@/lib/audio/AudioEngine';

/** 3:45 — a duração que o acervo conhece e guarda no registro. */
const CONHECIDA_MS = 225_000;

describe('a duração que o elemento não sabe, o registro sabe', () => {
  let engine: AudioEngine;
  let arnes: ReturnType<typeof instalarArnesDeAudio>;
  let carregadas: AudioEngineEventMap['loaded'][];

  beforeEach(() => {
    FakeHowl.instances = [];
    arnes = instalarArnesDeAudio();
    engine = AudioEngine.getInstance();
    carregadas = [];
    engine.on('loaded', (e) => carregadas.push(e));
  });

  afterEach(() => {
    engine.destroy();
    arnes.restaurar();
    vi.unstubAllGlobals();
  });

  const porHowler = (id: string, durationMs = CONHECIDA_MS): ReturnType<typeof makeTrack> =>
    makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3`, durationMs });
  const porElemento = (id: string, durationMs = CONHECIDA_MS): ReturnType<typeof makeTrack> =>
    makeTrack(id, { streamUrl: `https://cdn.example/${id}/master.m3u8`, durationMs });

  it.each([
    ['NaN (antes da metadata)', Number.NaN],
    ['Infinity (stream em chunks)', Number.POSITIVE_INFINITY],
    ['0 (fonte que nunca soube)', 0],
    ['negativo (elemento em estado inválido)', -1],
  ])('com duration %s, o tempo total vem do registro', (_nome, relatada) => {
    engine.load(porHowler('a'));
    const howl = FakeHowl.instances.at(-1)!;
    howl.duracaoRelatada = relatada;
    howl.node.duration = relatada;

    expect(engine.getDuration()).toBe(CONHECIDA_MS / 1000);
  });

  it('o evento `loaded` nunca carrega Infinity — é o que ia parar na barra', () => {
    engine.load(porHowler('b'));
    const howl = FakeHowl.instances.at(-1)!;
    howl.duracaoRelatada = Number.POSITIVE_INFINITY;
    howl.node.duration = Number.POSITIVE_INFINITY;
    howl.dispararLoad();

    // ANTES: `howl.duration() || this.getDuration()` deixava o Infinity passar,
    // porque Infinity é verdadeiro.
    const ultima = carregadas.at(-1);
    expect(ultima?.duration).toBe(CONHECIDA_MS / 1000);
    expect(Number.isFinite(ultima?.duration)).toBe(true);
  });

  it('no caminho de ELEMENTO o mesmo vale: metadata suja não vira tempo', async () => {
    engine.load(porElemento('c'));
    await Promise.resolve();
    const el = arnes.criados.at(-1)!;
    carregadas.length = 0;

    // O elemento anuncia que "sabe" a duração — e o que ele sabe é Infinity.
    el.chegouMetadata(Number.POSITIVE_INFINITY);

    for (const evento of carregadas) {
      expect(Number.isFinite(evento.duration)).toBe(true);
      expect(evento.duration).toBeGreaterThan(0);
    }
    expect(engine.getDuration()).toBe(CONHECIDA_MS / 1000);
  });

  it('quando o elemento aprende a duração de verdade, ela ganha do registro', async () => {
    engine.load(porElemento('d'));
    await Promise.resolve();
    const el = arnes.criados.at(-1)!;

    el.chegouMetadata(200); // medida: a faixa é 25s mais curta do que o registro dizia

    expect(engine.getDuration()).toBe(200);
    expect(carregadas.at(-1)?.duration).toBe(200);
  });

  it('sem duração em lugar nenhum, o total é 0 — nunca NaN', () => {
    // Faixa importada de um arquivo sem tags: o registro também não sabe.
    engine.load(porHowler('e', Number.NaN));
    const howl = FakeHowl.instances.at(-1)!;
    howl.duracaoRelatada = Number.NaN;
    howl.node.duration = Number.NaN;

    // ANTES: `slot.track.durationMs / 1000` devolvia NaN, e a barra virava
    // "NaN:aN" — o mesmo buraco, só que na saída em vez da entrada.
    const total = engine.getDuration();
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBe(0);
  });

  it('a faixa `seekable` cobre o caso do stream que só revela o fim tarde', () => {
    engine.load(porHowler('f', 0)); // registro sem duração
    const howl = FakeHowl.instances.at(-1)!;
    howl.duracaoRelatada = Number.POSITIVE_INFINITY;
    howl.node.duration = Number.POSITIVE_INFINITY;
    howl.dispararLoad(); // conecta o elemento ao slot
    howl.node.seekable = { length: 1, end: (): number => 187 };

    expect(engine.getDuration()).toBe(187);
  });
});
