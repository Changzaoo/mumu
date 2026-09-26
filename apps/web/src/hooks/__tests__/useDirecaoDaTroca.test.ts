import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TrackDto } from '@radinho/shared';

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: {
    on: vi.fn(() => () => undefined),
    off: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    analyser: null,
  },
  AudioEngine: class {},
}));

import { useDirecaoDaTroca } from '@/hooks/useDirecaoDaTroca';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

const faixa = (id: string) => ({ id, title: id, artists: [] }) as unknown as TrackDto;
const FILA = [faixa('a'), faixa('b'), faixa('c')];

/** Põe a faixa `i` da fila como a atual, sem passar pelo motor de áudio. */
function tocar(i: number, fila = FILA) {
  usePlayerStore.setState({ queue: fila, queueIndex: i, currentTrack: fila[i] ?? null });
}

describe('useDirecaoDaTroca', () => {
  beforeEach(() => {
    useUiStore.setState({ direcaoDaTroca: 0, direcaoMarcadaEm: 0 });
    tocar(1);
  });

  it('o carimbo do botão manda: "anterior" entra pela esquerda', () => {
    const { result, rerender } = renderHook(({ chave }) => useDirecaoDaTroca(chave), {
      initialProps: { chave: 'b' },
    });
    expect(result.current).toBe(0);
    useUiStore.getState().marcarDirecaoDaTroca(-1);
    tocar(2); // mesmo que a fila diga "avançou", quem apertou disse "voltar"
    rerender({ chave: 'c' });
    expect(result.current).toBe(-1);
  });

  it('sem carimbo, avanço natural da fila entra pela direita', () => {
    const { result, rerender } = renderHook(({ chave }) => useDirecaoDaTroca(chave), {
      initialProps: { chave: 'b' },
    });
    tocar(2);
    rerender({ chave: 'c' });
    expect(result.current).toBe(1);
  });

  it('sem carimbo e sem vizinhança na fila (clique numa lista), só funde', () => {
    const { result, rerender } = renderHook(({ chave }) => useDirecaoDaTroca(chave), {
      initialProps: { chave: 'b' },
    });
    const outra = [faixa('x'), faixa('y')];
    tocar(0, outra);
    rerender({ chave: 'x' });
    expect(result.current).toBe(0);
  });

  it('carimbo velho não vale para a troca seguinte', () => {
    useUiStore.setState({ direcaoDaTroca: -1, direcaoMarcadaEm: Date.now() - 10_000 });
    const { result, rerender } = renderHook(({ chave }) => useDirecaoDaTroca(chave), {
      initialProps: { chave: 'b' },
    });
    tocar(2);
    rerender({ chave: 'c' });
    expect(result.current).toBe(1);
  });
});
