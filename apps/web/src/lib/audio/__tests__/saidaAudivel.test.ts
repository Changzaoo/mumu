/**
 * "O TEMPO ANDA E NÃO SAI SOM" NO COMPUTADOR — a saída audível como invariante.
 *
 * No desktop o elemento não é a saída: ele passa por `createMediaElementSource`
 * e o som sai do AudioContext (`trim` → `fade` → EQ → `master` → destino). O
 * `currentTime` do elemento anda de qualquer jeito, então o contador de tempo da
 * tela NÃO prova que há som. O som some em qualquer elo dessa cadeia: contexto
 * suspenso, ganho de fade preso em 0, nó desconectado, elemento mudo.
 *
 * Este arquivo modela a cadeia com um AudioContext que sabe (a) o estado
 * `running/suspended`, (b) automação de ganho de verdade (set/ramp/cancel,
 * avaliada no relógio do contexto) e (c) conexões. `audivel()` lê tudo isso e
 * responde o que o ouvido responderia.
 *
 * O que NÃO está modelado: o getter de `AudioParam.value` do Chrome, que devolve
 * o último valor renderizado (defasado com o contexto suspenso). Aqui ele devolve
 * o valor exato — então um defeito que dependa dessa defasagem NÃO aparece neste
 * arquivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';
// Importado DEPOIS do resetModules (no beforeEach): o motor usa a instância nova.
let lerCorrecoesDeSaida: typeof import('@/lib/telemetry/avancoDeFaixa').lerCorrecoesDeSaida;
let zerarCorrecoesDeSaida: typeof import('@/lib/telemetry/avancoDeFaixa').zerarCorrecoesDeSaida;

const { FakeHowl, relogio } = vi.hoisted(() => {
  /** `nivel`: o que o analisador no fim da cadeia lê (desvio de 128). */
  const relogio = { agora: 0, nivel: 60 };
  class FakeHowlImpl {
    static instances: FakeHowlImpl[] = [];
    handlers = new Map<string, () => void>();
    node = {
      paused: true,
      muted: false,
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
    };
    _sounds = [{ _node: this.node, _volume: 1 }];
    _volume = 1;
    constructor() {
      FakeHowlImpl.instances.push(this);
    }
    on = (event: string, handler: () => void): void => {
      this.handlers.set(event, handler);
    };
    once = vi.fn();
    unload = vi.fn(() => {
      this.node.paused = true;
    });
    duration = (): number => 180;
    seek = (): number => this.node.currentTime;
    state = (): string => 'loaded';
    playing = (): boolean => !this.node.paused;
    play = vi.fn(() => {
      this.node.paused = false;
    });
    pause = vi.fn(() => {
      this.node.paused = true;
    });
    rate = (): number => 1;
    volume = vi.fn();
    fade = vi.fn();
    dispararLoad(): void {
      this.handlers.get('load')?.();
    }
  }
  return { FakeHowl: FakeHowlImpl, relogio };
});

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: {} }));
vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));
vi.mock('hls.js', () => ({ default: { isSupported: (): boolean => false, Events: {} } }));

type Evento = { tipo: 'set' | 'rampa'; t: number; v: number };

/** AudioParam com automação avaliada no relógio do contexto. */
class ParamFalso {
  private eventos: Evento[] = [];
  private base = 1;
  set value(v: number) {
    this.eventos = [];
    this.base = v;
  }
  get value(): number {
    return this.em(relogio.agora);
  }
  cancelScheduledValues = (t: number): void => {
    // Fixa onde estava antes de apagar o futuro, como o navegador faz.
    const atual = this.em(relogio.agora);
    this.eventos = this.eventos.filter((e) => e.t < t);
    if (this.eventos.length === 0) this.base = atual;
  };
  setValueAtTime = (v: number, t: number): void => {
    this.eventos.push({ tipo: 'set', t, v });
  };
  linearRampToValueAtTime = (v: number, t: number): void => {
    this.eventos.push({ tipo: 'rampa', t, v });
  };
  private em(t: number): number {
    let valor = this.base;
    let tAnt = -Infinity;
    for (const e of [...this.eventos].sort((a, b) => a.t - b.t)) {
      if (e.tipo === 'set') {
        if (e.t <= t) {
          valor = e.v;
          tAnt = e.t;
        }
      } else if (t >= e.t) {
        valor = e.v;
        tAnt = e.t;
      } else {
        const t0 = tAnt === -Infinity ? t : tAnt;
        const p = e.t === t0 ? 1 : (t - t0) / (e.t - t0);
        return valor + (e.v - valor) * Math.max(0, Math.min(1, p));
      }
    }
    return valor;
  }
}

class NoFalso {
  gain = new ParamFalso();
  destino: unknown = null;
  connect = vi.fn((n: unknown) => {
    this.destino = n;
  });
  disconnect = vi.fn(() => {
    this.destino = null;
  });
}

class ContextoFalso {
  state: 'running' | 'suspended' = 'running';
  destination = {};
  /** `resume()` pode ser recusado (autoplay) ou pendurar: o teste decide. */
  resumeResolve = true;
  get currentTime(): number {
    return relogio.agora;
  }
  resume = vi.fn(() => {
    if (this.resumeResolve) this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => Promise.resolve());
  createGain = (): NoFalso => new NoFalso();
  createBiquadFilter = (): NoFalso & {
    type: string;
    frequency: { value: number };
    Q: { value: number };
  } => Object.assign(new NoFalso(), { type: '', frequency: { value: 0 }, Q: { value: 0 } });
  createAnalyser = (): NoFalso & {
    fftSize: number;
    smoothingTimeConstant: number;
    getByteTimeDomainData: (a: Uint8Array) => void;
  } =>
    Object.assign(new NoFalso(), {
      fftSize: 32,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (a: Uint8Array) => a.fill(128 + relogio.nivel),
    });
  createMediaElementSource = (): NoFalso => new NoFalso();
}

interface SlotInterno {
  source: { kind: 'howl'; howl: InstanceType<typeof FakeHowl> } | null;
  track: { id: string } | null;
  fade: NoFalso | null;
  trim: NoFalso | null;
  mediaSource: NoFalso | null;
}
interface MotorInterno {
  slots: [SlotInterno, SlotInterno];
  activeIndex: 0 | 1;
  ctx: ContextoFalso | null;
  master: NoFalso | null;
}

/** O que o ouvido responderia sobre a faixa ativa — a cadeia inteira. */
function audivel(engine: unknown): { ok: boolean; motivo: string } {
  const m = engine as MotorInterno;
  const slot = m.slots[m.activeIndex];
  const howl = slot.source?.howl;
  if (!howl) return { ok: false, motivo: 'sem fonte no slot ativo' };
  const el = howl.node;
  if (el.paused) return { ok: false, motivo: 'elemento pausado' };
  if (el.muted) return { ok: false, motivo: 'elemento mudo' };
  if (el.volume <= 0) return { ok: false, motivo: 'volume do elemento 0' };
  if (!m.ctx) return { ok: true, motivo: 'sem grafo' };
  if (m.ctx.state !== 'running') return { ok: false, motivo: `contexto ${m.ctx.state}` };
  if (!slot.mediaSource || slot.mediaSource.destino !== slot.trim) {
    return { ok: false, motivo: 'elemento fora do grafo' };
  }
  if ((slot.fade?.gain.value ?? 0) < 0.99) {
    return { ok: false, motivo: `ganho do fade em ${slot.fade?.gain.value}` };
  }
  if ((m.master?.gain.value ?? 0) <= 0) return { ok: false, motivo: 'master em 0' };
  return { ok: true, motivo: '' };
}

/** Anda o relógio do contexto E os temporizadores juntos. */
function avancar(segundos: number): void {
  const passo = 0.05;
  for (let t = 0; t < segundos; t += passo) {
    relogio.agora += passo;
    for (const h of FakeHowl.instances) if (!h.node.paused) h.node.currentTime += passo;
    vi.advanceTimersByTime(passo * 1000);
  }
}

describe('computador: se o tempo anda, o som tem que sair', () => {
  let AudioEngine: typeof import('@/lib/audio/AudioEngine').AudioEngine;
  let engine: ReturnType<typeof AudioEngine.getInstance>;
  let ctx: ContextoFalso;

  beforeEach(async () => {
    vi.useFakeTimers();
    relogio.agora = 100;
    relogio.nivel = 60;
    FakeHowl.instances = [];

    ctx = new ContextoFalso();
    vi.stubGlobal('AudioContext', function () {
      return ctx;
    } as unknown as typeof AudioContext);
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: () => void) => setTimeout(cb, 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.resetModules();
    ({ AudioEngine } = await import('@/lib/audio/AudioEngine'));
    ({ lerCorrecoesDeSaida, zerarCorrecoesDeSaida } =
      await import('@/lib/telemetry/avancoDeFaixa'));
    zerarCorrecoesDeSaida();
    engine = AudioEngine.getInstance();
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const faixa = (id: string) => makeTrack(id, { streamUrl: `https://cdn.example/${id}.mp3` });

  /** Carrega e deixa o Howl "carregado", como o `canplay` real faria. */
  function carregar(id: string, opcoes?: { crossfadeSeconds?: number }): void {
    engine.load(faixa(id), { autoplay: true, ...opcoes });
    FakeHowl.instances.at(-1)!.dispararLoad();
  }

  it('linha de base: uma faixa, depois outra com crossfade — termina audível', () => {
    carregar('a');
    avancar(5);
    carregar('b', { crossfadeSeconds: 4 });
    avancar(6);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('pular no meio do crossfade — a faixa que fica termina audível', () => {
    carregar('a');
    avancar(5);
    carregar('b', { crossfadeSeconds: 6 });
    avancar(1);
    carregar('c', { crossfadeSeconds: 6 });
    avancar(1);
    carregar('d', { crossfadeSeconds: 6 });
    avancar(12);
    expect(engine.currentTrack?.id).toBe('d');
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('voltar para a faixa que ainda está saindo do crossfade — não desmonta a que voltou', () => {
    carregar('a');
    avancar(5);
    carregar('b', { crossfadeSeconds: 6 });
    avancar(1);
    // "Anterior" durante a mistura: o slot de A ainda existe (saindo) e é
    // tratado como pré-carregado — com o temporizador de desmontagem da saída
    // ainda armado contra ele.
    carregar('a', { crossfadeSeconds: 6 });
    avancar(12);
    expect(engine.currentTrack?.id).toBe('a');
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('voltar para a faixa que está sendo aposentada na troca seca — não a desmonta', () => {
    carregar('a');
    avancar(5);
    // B ainda não carregou (sem dispararLoad): A fica viva e muda, esperando.
    engine.load(faixa('b'), { autoplay: true });
    avancar(0.3);
    carregar('a');
    avancar(12);
    expect(engine.currentTrack?.id).toBe('a');
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('promover o pré-carregado com crossfade — termina audível', () => {
    carregar('a');
    avancar(5);
    engine.preloadNext(faixa('b'));
    FakeHowl.instances.at(-1)!.dispararLoad();
    carregar('b', { crossfadeSeconds: 4 });
    avancar(6);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('contexto suspenso DEPOIS de a faixa começar — o motor tem que retomá-lo e deixar rastro', () => {
    carregar('a');
    avancar(2);
    expect(audivel(engine).ok).toBe(true);

    // Troca de dispositivo de saída / política do navegador: o contexto cai
    // para 'suspended' sem ninguém pedir, e o <audio> segue andando.
    ctx.state = 'suspended';
    ctx.resume.mockClear();
    avancar(1);

    expect(ctx.resume).toHaveBeenCalled();
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
    expect(lerCorrecoesDeSaida().some((c) => c.motivo === 'contexto')).toBe(true);
  });

  it('contexto suspenso na hora da troca, com resume() recusado — segue tentando, sem laço apertado', () => {
    carregar('a');
    avancar(2);
    ctx.resumeResolve = false;
    ctx.state = 'suspended';
    carregar('b');
    ctx.resume.mockClear();
    avancar(3);
    // Tentou de novo (o gesto do usuário pode ter chegado), mas não a cada quadro.
    expect(ctx.resume.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.resume.mock.calls.length).toBeLessThan(10);
    // Quando o navegador finalmente deixa, o som volta sozinho.
    ctx.resumeResolve = true;
    avancar(2);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('ganho do slot ativo preso em 0 fora de qualquer fade — o invariante o restaura', () => {
    carregar('a');
    avancar(2);
    const m = engine as unknown as MotorInterno;
    // Simula a rampa cancelada sem restaurar: valor fixo em 0, nada agendado.
    m.slots[m.activeIndex].fade!.gain.value = 0;
    expect(audivel(engine).ok).toBe(false);
    avancar(1);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
    expect(lerCorrecoesDeSaida().some((c) => c.motivo === 'ganho')).toBe(true);
  });

  it('elemento mudo (muted) com o usuário sem silenciar — o invariante o desmuta', () => {
    carregar('a');
    avancar(2);
    FakeHowl.instances.at(-1)!.node.muted = true;
    avancar(1);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
    expect(lerCorrecoesDeSaida().some((c) => c.motivo === 'mudo')).toBe(true);
  });

  it('tudo confere e o analisador lê zero por 6 s — o slot RENASCE num elemento novo, no mesmo ponto', () => {
    carregar('a');
    avancar(3);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
    const antes = FakeHowl.instances.length;
    // O navegador calou o elemento por dentro (mídia sem CORS capturada pelo
    // grafo): nenhum ganho está errado, e o analisador lê silêncio digital.
    relogio.nivel = 0;
    avancar(4);
    expect(FakeHowl.instances.length).toBe(antes); // ainda não: 6 s de tolerância
    avancar(3);
    expect(FakeHowl.instances.length).toBe(antes + 1); // renasceu
    expect(lerCorrecoesDeSaida().some((c) => c.motivo === 'silencio')).toBe(true);
    const novo = FakeHowl.instances.at(-1)!;
    expect(FakeHowl.instances[antes - 1]!.unload).toHaveBeenCalled(); // o mudo foi desmontado
    novo.node.currentTime = 9.5; // o 'load' posiciona (seek) antes de tocar
    novo.dispararLoad();
    expect(novo.play).toHaveBeenCalled();
    expect(engine.currentTrack?.id).toBe('a');
    expect(engine.isPlaying).toBe(true);
    // O som voltou: nada mais a fazer.
    relogio.nivel = 60;
    avancar(10);
    expect(FakeHowl.instances.length).toBe(antes + 1);
    expect(audivel(engine)).toEqual({ ok: true, motivo: '' });
  });

  it('renasce UMA vez por carga — se o novo também sair mudo, não vira laço', () => {
    carregar('a');
    avancar(2);
    relogio.nivel = 0;
    avancar(7);
    const depoisDoPrimeiro = FakeHowl.instances.length;
    FakeHowl.instances.at(-1)!.dispararLoad();
    avancar(30);
    expect(FakeHowl.instances.length).toBe(depoisDoPrimeiro);
  });

  it('silêncio com o volume do usuário em zero não é defeito — não renasce', () => {
    carregar('a');
    avancar(2);
    engine.setVolume(0);
    relogio.nivel = 0;
    const antes = FakeHowl.instances.length;
    avancar(12);
    expect(FakeHowl.instances.length).toBe(antes);
  });

  it('o usuário silenciou de propósito — o invariante NÃO desfaz', () => {
    carregar('a');
    avancar(2);
    engine.setMuted(true);
    avancar(1);
    expect(lerCorrecoesDeSaida()).toHaveLength(0);
    const m = engine as unknown as MotorInterno;
    expect(m.master!.gain.value).toBe(0);
  });
});
