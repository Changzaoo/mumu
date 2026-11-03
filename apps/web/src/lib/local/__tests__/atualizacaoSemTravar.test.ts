/**
 * A VERSÃO NOVA NÃO PODE TRAVAR O APP NO CAMINHO.
 *
 * Com `autoUpdate`, o worker novo ativava sozinho no deploy e apagava o
 * precache antigo enquanto a página velha seguia aberta: a tela seguinte pedia
 * um chunk que já não existia, nada pintava, o vigia recarregava, e a recarga
 * encadeava outras (iPhone do dono, 03/11/2026: quatro boots em 30 s). Agora o
 * worker fica EM ESPERA (`registerType: 'prompt'`) e a página só o manda
 * assumir quando pode recarregar logo em seguida.
 *
 * Regras travadas aqui:
 *  - worker em espera (`onNeedRefresh`) → a página pede a troca (`updateSW`)
 *    só depois de sossegar; NUNCA recarrega antes de o worker assumir;
 *  - tela apagada com música → não pede a troca; ao acender, pede;
 *  - pede UMA vez, mesmo que o aviso repita;
 *  - worker assumiu (`controllerchange`) → recarrega preservando a música;
 *  - chunk de página que não chega → recarrega preservando a música, no
 *    máximo uma vez por 30 s; erro comum segue para a tela de erro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  updateSW,
  registerOpts,
  prepararRetomadaTocando,
  estadoPlayer,
  swListeners,
  reload,
  controller,
} = vi.hoisted(() => ({
  updateSW: vi.fn(async () => undefined),
  registerOpts: { atual: null as null | { onNeedRefresh?: () => void } },
  prepararRetomadaTocando: vi.fn(),
  estadoPlayer: { isPlaying: false },
  swListeners: new Map<string, (e?: unknown) => void>(),
  reload: vi.fn(),
  controller: { atual: null as unknown },
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: { onNeedRefresh?: () => void }) => {
    registerOpts.atual = opts;
    return updateSW;
  },
}));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: {
    getState: () => estadoPlayer,
    subscribe: () => () => undefined,
  },
  prepararRetomadaTocando,
}));
vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));

const workerEmEspera = (): void => registerOpts.atual?.onNeedRefresh?.();
const workerAssumiu = (): void => swListeners.get('controllerchange')?.();

describe('a versão nova chega sem travar o app', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    updateSW.mockClear();
    prepararRetomadaTocando.mockClear();
    reload.mockClear();
    swListeners.clear();
    estadoPlayer.isPlaying = false;
    controller.atual = {};
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        get controller() {
          return controller.atual;
        },
        addEventListener: (tipo: string, fn: (e?: unknown) => void) => swListeners.set(tipo, fn),
      },
    });
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  afterEach(() => vi.useRealTimers());

  it('worker em espera → pede a troca depois de sossegar; só recarrega quando ele assume', async () => {
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    window.dispatchEvent(new Event('pointerdown'));
    workerEmEspera();
    expect(updateSW).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6_100);
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(updateSW).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled(); // o precache antigo ainda está lá
    workerAssumiu();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tela apagada com música tocando → não pede a troca; ao acender, pede', async () => {
    estadoPlayer.isPlaying = true;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerEmEspera();
    vi.advanceTimersByTime(10_000);
    expect(updateSW).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10);
    expect(updateSW).toHaveBeenCalledTimes(1);
    workerAssumiu();
    expect(prepararRetomadaTocando).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('o aviso repetido pede a troca UMA vez só', async () => {
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerEmEspera();
    workerEmEspera();
    workerEmEspera();
    vi.advanceTimersByTime(10);
    expect(updateSW).toHaveBeenCalledTimes(1);
  });

  it('primeira visita: worker assume sem anterior → não recarrega', async () => {
    controller.atual = null;
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerAssumiu();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('chunk da página que não chega', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  it('reconhece o erro de chunk perdido e não confunde com erro comum', async () => {
    const { chunkPerdido } = await import('@/app/router');
    expect(
      chunkPerdido(new TypeError('Failed to fetch dynamically imported module: /assets/X.js')),
    ).toBe(true);
    expect(chunkPerdido(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(chunkPerdido(new TypeError('Load failed'))).toBe(true);
    expect(chunkPerdido(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(chunkPerdido(new RangeError('Maximum call stack size exceeded'))).toBe(false);
  });

  it('recarrega no máximo uma vez por 30 s', async () => {
    const { podeRecarregarPorChunk } = await import('@/app/router');
    expect(podeRecarregarPorChunk(1_000_000)).toBe(true);
    expect(podeRecarregarPorChunk(1_010_000)).toBe(false);
    expect(podeRecarregarPorChunk(1_031_000)).toBe(true);
  });

  it('carregador que falha por chunk perdido recarrega preservando a música; erro comum é relançado', async () => {
    const recarregar = vi.fn();
    vi.doMock('@/lib/recarregar', () => ({ recarregarPreservandoMusica: recarregar }));
    vi.doMock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));
    const { comRecargaSeFaltar } = await import('@/app/router');
    const perdido = comRecargaSeFaltar('HomePage', () =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );
    const pendente = perdido();
    await Promise.resolve();
    await Promise.resolve();
    expect(recarregar).toHaveBeenCalledTimes(1);
    // A promessa fica pendente: a página vai embora.
    let resolveu = false;
    void pendente.then(() => {
      resolveu = true;
    });
    await Promise.resolve();
    expect(resolveu).toBe(false);

    const comum = comRecargaSeFaltar('HomePage', () => Promise.reject(new Error('bug na página')));
    await expect(comum()).rejects.toThrow('bug na página');
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
