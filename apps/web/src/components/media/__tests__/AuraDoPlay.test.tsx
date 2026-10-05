import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: { getPosition: vi.fn(() => 0), on: vi.fn(() => () => undefined) },
  AudioEngine: class {},
}));
vi.mock('@/lib/devices/presence', () => ({ posicaoDoQueToca: () => null }));

import { AuraDoPlay } from '@/components/media/AuraDoPlay';
import { MediaCard } from '@/components/media/MediaCard';

/** rAF controlado: cada `andar` roda UM quadro, 40 ms depois do anterior. */
let fila: Array<(t: number) => void> = [];
let relogio = 1000;
function andar(quadros: number): void {
  for (let i = 0; i < quadros; i++) {
    const cb = fila.shift();
    if (!cb) return;
    relogio += 40;
    act(() => cb(relogio));
  }
}

beforeEach(() => {
  fila = [];
  relogio = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => fila.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    fila = [];
  });
  vi.spyOn(performance, 'now').mockImplementation(() => relogio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => undefined,
        fillStyle: '#000',
      }) as unknown as CanvasRenderingContext2D,
  );
  document.documentElement.removeAttribute('data-perf');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-perf');
});

describe('AuraDoPlay — o laço só roda quando há o que animar', () => {
  it('botão parado não monta laço nenhum', () => {
    render(<AuraDoPlay playing={false} toque={false} />);
    expect(fila.length).toBe(0);
  });

  it('tocando anima; ao pausar assenta e o laço DORME (custo zero)', () => {
    const { rerender } = render(<AuraDoPlay playing toque={false} />);
    expect(fila.length).toBe(1);
    andar(10);
    expect(fila.length).toBe(1); // segue vivo enquanto toca

    rerender(<AuraDoPlay playing={false} toque={false} />);
    // A vivacidade e o giro freiam com inércia (~1 s): deixa assentar.
    andar(400);
    expect(fila.length).toBe(0);
  });

  it('voltar a tocar acorda o laço', () => {
    const { rerender } = render(<AuraDoPlay playing={false} toque={false} />);
    expect(fila.length).toBe(0);
    rerender(<AuraDoPlay playing toque={false} />);
    expect(fila.length).toBe(1);
  });

  it('baixando (carregando) anima; terminando, dorme', () => {
    const { rerender } = render(<AuraDoPlay playing={false} toque={false} carregando />);
    expect(fila.length).toBe(1);
    rerender(<AuraDoPlay playing={false} toque={false} carregando={false} />);
    andar(400);
    expect(fila.length).toBe(0);
  });

  it('aba oculta: não roda quadro', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      render(<AuraDoPlay playing toque={false} />);
      expect(fila.length).toBe(0);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });

  it('modo leve (data-perf=baixo): aura estática, sem laço nem com música tocando', () => {
    document.documentElement.setAttribute('data-perf', 'baixo');
    const { container, rerender } = render(<AuraDoPlay playing toque />);
    expect(fila.length).toBe(0);
    const cd = container.querySelector<HTMLElement>('.aura-play-cd');
    // O CD gira por CSS, não por JavaScript.
    expect(cd?.dataset.estatica).toBe('true');
    expect(cd?.dataset.girando).toBe('true');
    rerender(<AuraDoPlay playing={false} toque />);
    expect(fila.length).toBe(0);
    expect(cd?.dataset.girando).toBe('false');
  });
});

describe('AuraDoPlay — nova máquina: leve, movimento reduzido, troca de faixa', () => {
  it('modo leve: 4 camadas pintadas, sem rAF, e a fase vai para o CSS', () => {
    document.documentElement.setAttribute('data-perf', 'baixo');
    const { container, rerender, unmount } = render(
      <AuraDoPlay playing toque faixa="a" carregando />,
    );
    const raiz = container.querySelector<HTMLElement>('.aura-play-leve')!;
    expect(raiz.querySelectorAll('canvas').length).toBe(4);
    expect(raiz.dataset.fase).toBe('reunindo');
    rerender(<AuraDoPlay playing toque faixa="a" />);
    expect(raiz.dataset.fase).toBe('girando'); // fade por CSS, sem JS por quadro
    expect(fila.length).toBe(0);
    unmount(); // limpa os timers sem erro
  });

  it('movimento reduzido: quadro estático, sem laço, mesmo tocando e baixando', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore');
    useSettingsStore.setState({ reducedMotion: 'on' });
    try {
      render(<AuraDoPlay playing toque={false} carregando faixa="a" />);
      expect(fila.length).toBe(0);
    } finally {
      useSettingsStore.setState({ reducedMotion: 'system' });
    }
  });

  it('trocar a faixa acorda o laço (dissipa e reúne) e depois dorme', () => {
    const { rerender } = render(<AuraDoPlay playing={false} toque={false} faixa="a" />);
    expect(fila.length).toBe(0);
    rerender(<AuraDoPlay playing={false} toque={false} faixa="b" />);
    expect(fila.length).toBe(1);
    andar(1000);
    expect(fila.length).toBe(0);
  });

  it('desmontar cancela o rAF pendente', () => {
    const { unmount } = render(<AuraDoPlay playing toque={false} faixa="a" />);
    expect(fila.length).toBe(1);
    unmount();
    expect(fila.length).toBe(0);
  });
});

describe('cartões da Home não montam aura', () => {
  it('MediaCard com onPlay não tem canvas de névoa (só os players têm)', () => {
    const { container } = render(
      <MemoryRouter>
        <MediaCard title="Faixa" trackId="t1" onPlay={() => undefined} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.aura-play-nevoa')).toBeNull();
    expect(fila.length).toBe(0);
  });
});
