/**
 * NO CELULAR O SOM NÃO PODE PASSAR PELO WEB AUDIO — o conserto do "com a tela
 * apagada a próxima começa e para".
 *
 * Um `<audio>` comum é tratado pelo sistema como MÍDIA: segue tocando com a
 * tela apagada, aparece na tela de bloqueio, mantém a sessão viva. No instante
 * em que o elemento passa por `createMediaElementSource`, o som deixa de sair
 * dele e passa a sair do AudioContext — que o sistema suspende quando a página
 * vai para segundo plano. A faixa nova começa, toca cerca de um segundo e
 * emudece; e, sem som, o navegador passa a tratar a aba como silenciosa e
 * congela os temporizadores, então a faixa seguinte nem chega a começar. Os
 * dois sintomas relatados, a mesma causa.
 *
 * O iPhone já seguia esta regra. O Android ficou de fora e o sintoma
 * sobreviveu — a mesma forma do vazamento de alças de blob, que também existia
 * em duas cópias e teve só uma consertada. Estes testes existem para que a
 * terceira plataforma não fique de fora em silêncio.
 *
 * O que se prende aqui:
 *   1. celular (Android, iPhone, iPad disfarçado de Mac) NÃO cria AudioContext;
 *   2. computador continua criando — o EQ e o visualizador são de lá;
 *   3. sem grafo, o volume ainda tem que sair aplicado no próprio elemento,
 *      senão o conserto trocaria "não toca em segundo plano" por "toca sempre
 *      no volume máximo".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

const audioContextCtor = vi.fn();
const howlCtor = vi.fn();
const criouFonteDeElemento = vi.fn();

vi.mock('howler', () => {
  class MockHowl {
    constructor(options: unknown) {
      howlCtor(options);
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
    volume = vi.fn();
    fade = vi.fn();
  }
  return { Howl: MockHowl, Howler: {} };
});

vi.mock('@/lib/api', () => ({ resolveMediaUrl: (url: string) => url }));

/** AudioContext de mentira que anota que foi construído. */
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  constructor() {
    audioContextCtor();
  }
  createGain = (): unknown => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  createBiquadFilter = (): unknown => ({
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0 },
    connect: vi.fn(),
  });
  createAnalyser = (): unknown => ({
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
  });
  createMediaElementSource = (): unknown => {
    criouFonteDeElemento();
    return { connect: vi.fn(), disconnect: vi.fn() };
  };
  resume = (): Promise<void> => Promise.resolve();
  close = (): Promise<void> => Promise.resolve();
}

/**
 * Troca o `navigator` visto pelo módulo. Precisa vir ANTES do import: a
 * decisão de plataforma é uma constante de módulo, lida uma vez — de propósito,
 * porque ela não pode mudar no meio de uma sessão (ver o cabeçalho do engine:
 * elemento já ligado ao grafo não volta a tocar direto).
 */
function fingirAparelho(userAgent: string, extras: Record<string, unknown> = {}): void {
  vi.stubGlobal('navigator', {
    userAgent,
    platform: 'linux',
    maxTouchPoints: 0,
    ...extras,
  });
}

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function carregarEngine(): Promise<typeof import('@/lib/audio/AudioEngine')> {
  vi.resetModules();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return await import('@/lib/audio/AudioEngine');
}

beforeEach(() => {
  audioContextCtor.mockClear();
  howlCtor.mockClear();
  criouFonteDeElemento.mockClear();
  vi.unstubAllGlobals();
});

describe('rota de áudio por plataforma', () => {
  it('Android não monta o grafo Web Audio', async () => {
    fingirAparelho(UA_ANDROID);
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    // `unlock` é o primeiro gesto do usuário — era ele que montava o grafo.
    engine.unlock();
    engine.load(makeTrack('t1', { streamUrl: 'https://exemplo/a.mp3' }), { autoplay: false });

    expect(audioContextCtor).not.toHaveBeenCalled();
    expect(criouFonteDeElemento).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('iPhone continua sem grafo (não era regressão, era a regra certa)', async () => {
    fingirAparelho(UA_IPHONE);
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    engine.unlock();
    expect(audioContextCtor).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('iPad que se diz Mac também é celular para este fim', async () => {
    // Desde o iPadOS 13 o iPad manda user agent de Mac. Só os pontos de toque
    // o denunciam — e ele tem exatamente a mesma política de segundo plano.
    fingirAparelho(UA_DESKTOP, { platform: 'MacIntel', maxTouchPoints: 5 });
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    engine.unlock();
    expect(audioContextCtor).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('o navegador que se declara celular é acreditado', async () => {
    // `userAgentData.mobile` é a resposta do próprio navegador, e vale mais que
    // adivinhar por regex de user agent.
    fingirAparelho(UA_DESKTOP, { userAgentData: { mobile: true } });
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    engine.unlock();
    expect(audioContextCtor).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('no computador o grafo continua existindo — é de lá o EQ e o visualizador', async () => {
    fingirAparelho(UA_DESKTOP);
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    engine.unlock();

    // A contrapartida do conserto: se este teste cair junto com os de cima, o
    // grafo sumiu de todo mundo e o EQ virou enfeite morto no computador.
    expect(audioContextCtor).toHaveBeenCalled();
    engine.destroy();
  });

  it('sem grafo, o volume vai no próprio elemento em vez de ficar no máximo', async () => {
    fingirAparelho(UA_ANDROID);
    const { AudioEngine } = await carregarEngine();
    const engine = AudioEngine.getInstance();

    engine.setVolume(0.25);
    engine.load(makeTrack('t1', { streamUrl: 'https://exemplo/a.mp3' }), { autoplay: false });

    // Com grafo o Howl toca em 1 e quem manda no volume é o ganho principal.
    // Sem grafo não há ganho nenhum: o volume TEM que descer até o elemento,
    // senão todo celular passaria a tocar no talo.
    const opcoes = howlCtor.mock.calls[0]?.[0] as { volume?: number } | undefined;
    expect(opcoes?.volume).toBeCloseTo(0.25);
    engine.destroy();
  });
});
