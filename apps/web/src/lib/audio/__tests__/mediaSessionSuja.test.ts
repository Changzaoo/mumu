/**
 * RF2/RF4 — NADA SUJO CHEGA À TELA DE BLOQUEIO.
 *
 * `setPositionState` LANÇA com qualquer entrada fora do contrato, e as entradas
 * fora do contrato são o dia a dia deste player: `duration` é `NaN` antes da
 * metadata e `Infinity` em stream sem `Content-Length`; `position` passa de
 * `duration` no instante da troca de faixa (o playhead já é o da faixa nova, a
 * duração ainda é a da velha); `playbackRate` vem de preferência persistida e
 * já chegou como `0`.
 *
 * A assinatura da store roda a cada `setState` do player — ou seja, várias
 * vezes por segundo, no meio da música. Uma exceção ali não é um enfeite que
 * quebra: é a cadeia de assinantes interrompida com a música tocando.
 *
 * Este arquivo usa um `mediaSession` que se recusa a aceitar lixo (como o
 * navegador de verdade faz) e afirma duas coisas: nada inválido é entregue, e
 * nada explode.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/playerStore', () => {
  type Ouvinte = (estado: Record<string, unknown>) => void;
  const ouvintes: Ouvinte[] = [];
  let estado: Record<string, unknown> = {
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    duration: 0,
    playbackRate: 1,
  };
  return {
    usePlayerStore: {
      getState: () => estado,
      setState: (parcial: Record<string, unknown>) => {
        estado = { ...estado, ...parcial };
        for (const o of ouvintes) o(estado);
      },
      subscribe: (o: Ouvinte) => {
        ouvintes.push(o);
        return () => undefined;
      },
    },
  };
});

import { initMediaSession } from '@/lib/audio/mediaSession';
import { usePlayerStore } from '@/stores/playerStore';
import { makeTrack } from '@/test/factories';

interface PosicaoEntregue {
  duration: number;
  position: number;
  playbackRate: number;
}

let entregues: PosicaoEntregue[];
let handlers: string[];

/** Um `mediaSession` tão exigente quanto o do navegador. */
function instalarMediaSession(): void {
  entregues = [];
  handlers = [];
  const ms = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: (acao: string): void => {
      handlers.push(acao);
      // Vários navegadores recusam ações que não implementam. RF4: cada
      // registro tem que sobreviver a isso sozinho.
      if (acao === 'seekto') throw new TypeError('unsupported action');
    },
    setPositionState: (estado: PosicaoEntregue): void => {
      const { duration, position, playbackRate } = estado;
      if (!Number.isFinite(duration) || duration < 0) throw new TypeError('duration inválida');
      if (!Number.isFinite(position) || position < 0 || position > duration) {
        throw new TypeError('position fora do intervalo');
      }
      if (!Number.isFinite(playbackRate) || playbackRate === 0) {
        throw new TypeError('playbackRate inválido');
      }
      entregues.push(estado);
    },
  };
  vi.stubGlobal('navigator', { ...globalThis.navigator, mediaSession: ms });
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: unknown) {
        Object.assign(this, init);
      }
    },
  );
}

/** Empurra um estado e espera o intervalo de 1s que a barra respeita. */
function publicar(parcial: Record<string, unknown>): void {
  vi.setSystemTime(Date.now() + 2000);
  usePlayerStore.setState(parcial);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  instalarMediaSession();
  initMediaSession();
});

describe('a tela de bloqueio não recebe número inválido', () => {
  it('registra as ações mesmo quando o navegador recusa uma delas', () => {
    // `seekto` explode no mock; sem try/catch por ação, `previoustrack` e
    // `nexttrack` nunca seriam registrados e os botões do fone parariam.
    expect(handlers).toContain('play');
    expect(handlers).toContain('nexttrack');
    expect(handlers).toContain('seekto');
  });

  it.each([
    ['duração NaN (antes da metadata)', Number.NaN, 0],
    ['duração Infinity (stream em chunks)', Number.POSITIVE_INFINITY, 0],
    ['duração 0 (fonte que nunca soube)', 0, 0],
    ['posição além do fim (instante da troca)', 180, 999],
    ['posição NaN', 180, Number.NaN],
  ])('%s não derruba nem chega ao navegador', (_nome, duration, progress) => {
    expect(() => {
      publicar({ currentTrack: makeTrack('a'), isPlaying: true, duration, progress });
    }).not.toThrow();

    for (const entregue of entregues) {
      expect(Number.isFinite(entregue.duration)).toBe(true);
      expect(entregue.position).toBeLessThanOrEqual(entregue.duration);
      expect(entregue.position).toBeGreaterThanOrEqual(0);
    }
  });

  it('velocidade 0 vira 1 em vez de explodir', () => {
    expect(() => {
      publicar({
        currentTrack: makeTrack('b'),
        isPlaying: true,
        duration: 180,
        progress: 10,
        playbackRate: 0,
      });
    }).not.toThrow();

    expect(entregues.at(-1)?.playbackRate).toBe(1);
  });

  it('com números limpos, a posição chega de verdade', () => {
    publicar({ currentTrack: makeTrack('c'), isPlaying: true, duration: 180, progress: 42 });

    expect(entregues.at(-1)).toEqual({ duration: 180, position: 42, playbackRate: 1 });
  });

  it('o estado de reprodução acompanha play e pause', () => {
    publicar({ currentTrack: makeTrack('d'), isPlaying: true, duration: 180, progress: 1 });
    expect(navigator.mediaSession.playbackState).toBe('playing');

    publicar({ isPlaying: false });
    expect(navigator.mediaSession.playbackState).toBe('paused');
  });
});
