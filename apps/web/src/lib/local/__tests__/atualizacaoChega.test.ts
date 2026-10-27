/**
 * UM CONSERTO QUE NÃO ALCANÇA O APARELHO NÃO É UM CONSERTO.
 *
 * O erro continuava aparecendo horas depois da correção publicada. O motivo não
 * era a correção: era o atualizador do PWA, que só aplicava a versão nova quando
 * a música parava — e para quem ouve o tempo todo, "parar" era nunca.
 *
 * Agora o service worker é `autoUpdate` (skipWaiting + clientsClaim): o worker
 * novo assume as abas SOZINHO, e quando assume o navegador dispara
 * `controllerchange`. É aí que a página se recarrega para pegar o bundle novo —
 * preservando a música (grava a retomada TOCANDO antes de recarregar). Não
 * depende mais de o usuário pausar; vale para todo aparelho, automaticamente.
 *
 * As regras travadas aqui:
 *  - worker novo assumiu (controllerchange) com um worker ANTERIOR no controle
 *    → recarrega (é uma atualização);
 *  - primeira visita (nenhum worker anterior) → NÃO recarrega (seria refresh à
 *    toa na abertura);
 *  - tocando → grava a retomada antes de recarregar;
 *  - recarrega UMA vez só, mesmo se o evento repetir;
 *  - no meio de um gesto (toque, tecla, rolagem) → espera sossegar antes de
 *    recarregar ("o app fica reiniciando do nada", 27/10/2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSW, prepararRetomadaTocando, estadoPlayer, swListeners, reload, controller } =
  vi.hoisted(() => ({
    updateSW: vi.fn(),
    prepararRetomadaTocando: vi.fn(),
    estadoPlayer: { isPlaying: false },
    swListeners: new Map<string, (e?: unknown) => void>(),
    reload: vi.fn(),
    controller: { atual: null as unknown },
  }));

vi.mock('virtual:pwa-register', () => ({
  registerSW: () => updateSW,
}));

vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: { getState: () => estadoPlayer },
  prepararRetomadaTocando,
}));
vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));

/** Dispara o controllerchange como o navegador faz quando o worker novo assume. */
function workerNovoAssume(): void {
  swListeners.get('controllerchange')?.();
}

describe('a versão nova chega ao aparelho', () => {
  beforeEach(() => {
    vi.resetModules();
    updateSW.mockClear();
    prepararRetomadaTocando.mockClear();
    reload.mockClear();
    swListeners.clear();
    estadoPlayer.isPlaying = false;
    controller.atual = {}; // por padrão JÁ havia um worker no controle (é atualização)

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        get controller() {
          return controller.atual;
        },
        addEventListener: (tipo: string, fn: (e?: unknown) => void) => swListeners.set(tipo, fn),
      },
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });
  });

  it('worker novo assume → recarrega para pegar o bundle novo', async () => {
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerNovoAssume();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('primeira visita (sem worker anterior) → NÃO recarrega', async () => {
    controller.atual = null; // nada controlava a página ainda
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerNovoAssume();
    expect(reload).not.toHaveBeenCalled();
  });

  it('tocando → grava a retomada ANTES de recarregar (a música volta)', async () => {
    estadoPlayer.isPlaying = true;
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerNovoAssume();
    expect(prepararRetomadaTocando).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('parado → recarrega sem gravar retomada', async () => {
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerNovoAssume();
    expect(prepararRetomadaTocando).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recarrega UMA vez só, mesmo se o evento repetir', async () => {
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
    workerNovoAssume();
    workerNovoAssume();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe('no meio de um gesto', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('espera a pessoa sossegar antes de recarregar', async () => {
      const { initPwaUpdater } = await import('@/pwa');
      initPwaUpdater();
      window.dispatchEvent(new Event('pointerdown'));
      workerNovoAssume();
      expect(reload).not.toHaveBeenCalled();
      // Continua mexendo: continua esperando.
      vi.advanceTimersByTime(4_000);
      window.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(4_000);
      expect(reload).not.toHaveBeenCalled();
      // Sossegou: recarrega.
      vi.advanceTimersByTime(2_100);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
