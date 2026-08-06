/**
 * UM CONSERTO QUE NÃO ALCANÇA O APARELHO NÃO É UM CONSERTO.
 *
 * O erro do Firestore continuou aparecendo no celular horas depois de a correção
 * estar publicada. O motivo não era a correção: era o atualizador do PWA.
 *
 * Ele aplica a versão nova na hora quando nada está tocando — certo. Mas quando
 * há música tocando ele só avisava e ia embora, e NINGUÉM voltava para aplicar:
 * `onNeedRefresh` dispara uma vez por worker novo, e a trava do aviso garantia
 * que nem o aviso se repetisse. Quem ouve música com o app aberto (o uso normal)
 * ficava preso no build antigo por tempo indeterminado.
 *
 * A regra travada aqui: tocando, fica um vigia; a música parou, a versão nova
 * entra.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSW, opcoes, estadoPlayer, ouvintes } = vi.hoisted(() => ({
  updateSW: vi.fn(),
  opcoes: { atual: null as { onNeedRefresh?: () => void } | null },
  estadoPlayer: { isPlaying: false },
  ouvintes: new Set<(estado: { isPlaying: boolean }) => void>(),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: { onNeedRefresh?: () => void }) => {
    opcoes.atual = opts;
    return updateSW;
  },
}));

vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: {
    getState: () => estadoPlayer,
    subscribe: (fn: (estado: { isPlaying: boolean }) => void) => {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
  },
}));

vi.mock('@/stores/notificationsStore', () => ({ pushNotification: vi.fn() }));

/** Simula o player mudando de estado. */
function tocando(valor: boolean): void {
  estadoPlayer.isPlaying = valor;
  for (const fn of [...ouvintes]) fn(estadoPlayer);
}

describe('a versão nova chega ao aparelho', () => {
  beforeEach(async () => {
    vi.resetModules();
    updateSW.mockClear();
    ouvintes.clear();
    estadoPlayer.isPlaying = false;
    const { initPwaUpdater } = await import('@/pwa');
    initPwaUpdater();
  });

  it('parado: aplica na hora', () => {
    opcoes.atual?.onNeedRefresh?.();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('tocando: NÃO corta a música', () => {
    estadoPlayer.isPlaying = true;
    opcoes.atual?.onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();
  });

  // ── O DEFEITO ────────────────────────────────────────────────────────────
  it('tocando e depois pausado: aplica sozinho — antes ficava preso para sempre', () => {
    estadoPlayer.isPlaying = true;
    opcoes.atual?.onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();

    tocando(false); // o usuário pausou

    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('continuar tocando não dispara nada', () => {
    estadoPlayer.isPlaying = true;
    opcoes.atual?.onNeedRefresh?.();
    tocando(true); // trocou de faixa, seguiu tocando
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('o vigia se desfaz depois de aplicar — não aplica duas vezes', () => {
    estadoPlayer.isPlaying = true;
    opcoes.atual?.onNeedRefresh?.();
    tocando(false);
    tocando(true);
    tocando(false);
    expect(updateSW).toHaveBeenCalledTimes(1);
  });
});
