import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SectionCarousel } from '@/components/media/SectionCarousel';

/**
 * jsdom não tem layout: o trilho é medido por getters fingidos. Uma tela de
 * 360 px, 40 cartões de 172 px, e cada CÓPIA do loop começando 10.000 px depois
 * da anterior (é o que `unidadeDe` lê em `offsetLeft`).
 */
const LARGURA_TELA = 360;
let posicao = 0;

beforeEach(() => {
  vi.useFakeTimers();
  posicao = 0;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => LARGURA_TELA,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 40 * 172,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      const copia = this.closest('[data-copia]')?.getAttribute('data-copia');
      return Number(copia ?? 0) * 10_000;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error — remove os getters fingidos
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — idem
  delete HTMLElement.prototype.scrollWidth;
  // @ts-expect-error — idem
  delete HTMLElement.prototype.offsetLeft;
});

function montar(total: number, inicial?: number) {
  const r = render(
    <MemoryRouter>
      <SectionCarousel title="Prateleira" inicial={inicial}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} data-testid="cartao" />
        ))}
      </SectionCarousel>
    </MemoryRouter>,
  );
  const trilho = r.container.querySelector<HTMLElement>('.carrossel-trilho')!;
  Object.defineProperty(trilho, 'scrollLeft', {
    configurable: true,
    get: () => posicao,
    set: (v: number) => {
      posicao = v;
    },
  });
  const cartoes = () => r.container.querySelectorAll('[data-testid="cartao"]').length;
  const copias = () => r.container.querySelectorAll('[data-copia]').length;
  /** Deixa passar o rAF da medição inicial e os 180 ms do "parou de rolar". */
  const assentar = () => act(() => void vi.advanceTimersByTime(400));
  return { trilho, cartoes, copias, assentar };
}

describe('SectionCarousel — a volta infinita só liga com gesto de verdade', () => {
  it('o encaixe de 4 px do boot (scroll programático) NÃO liga a volta nem cria cartões', () => {
    const { trilho, cartoes, copias, assentar } = montar(40);
    assentar();
    expect(copias()).toBe(1);
    expect(cartoes()).toBe(40);

    posicao = 4;
    fireEvent.scroll(trilho);
    assentar();

    expect(copias()).toBe(1);
    expect(cartoes()).toBe(40);
  });

  it('gesto real (dedo) que rola mais de meia tela liga a volta: 3 cópias', () => {
    const { trilho, cartoes, copias, assentar } = montar(40);
    assentar();

    fireEvent.touchStart(trilho);
    posicao = 300; // > meia tela (180 px), e ainda a menos de uma tela do começo
    fireEvent.scroll(trilho);
    fireEvent.touchEnd(trilho);
    assentar();

    expect(copias()).toBe(3);
    expect(cartoes()).toBe(120);
  });

  it('gesto pequeno (menos de meia tela) não liga', () => {
    const { trilho, copias, assentar } = montar(40);
    assentar();

    fireEvent.pointerDown(trilho);
    posicao = 100;
    fireEvent.scroll(trilho);
    assentar();

    expect(copias()).toBe(1);
  });

  it('roda do mouse conta como gesto', () => {
    const { trilho, copias, assentar } = montar(40);
    assentar();

    fireEvent.wheel(trilho);
    posicao = 250;
    fireEvent.scroll(trilho);
    assentar();

    expect(copias()).toBe(3);
  });

  it('o gesto vence o encaixe: um scroll de 4 px muito depois do gesto não conta', () => {
    const { trilho, copias, assentar } = montar(40);
    assentar();

    fireEvent.pointerDown(trilho);
    vi.advanceTimersByTime(5_000); // o gesto expirou sem rolar nada
    posicao = 4;
    fireEvent.scroll(trilho);
    assentar();

    expect(copias()).toBe(1);
  });
});

describe('SectionCarousel — cartões sob demanda (`inicial`)', () => {
  it('monta só N cartões no começo', () => {
    const { cartoes, assentar } = montar(40, 15);
    assentar();
    expect(cartoes()).toBe(15);
  });

  it('o encaixe de 4 px não libera cartões', () => {
    const { trilho, cartoes, assentar } = montar(40, 15);
    assentar();
    posicao = 4;
    fireEvent.scroll(trilho);
    assentar();
    expect(cartoes()).toBe(15);
  });

  it('rolar perto do fim do que existe libera mais um lote; a volta só liga com a fila inteira', () => {
    const { trilho, cartoes, copias, assentar } = montar(40, 15);
    assentar();

    fireEvent.pointerDown(trilho);
    posicao = 2600; // perto do fim (scrollWidth = 6880, mas o fingido responde 2 telas)
    // O scrollWidth fingido é fixo: duas telas adiante sempre "falta" fila.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 2600 + LARGURA_TELA + 200,
    });
    fireEvent.scroll(trilho);
    assentar();
    expect(cartoes()).toBeGreaterThan(15);
    expect(cartoes()).toBeLessThanOrEqual(40);
    // Enquanto a fila não está inteira, nada de cópias.
    if (cartoes() < 40) expect(copias()).toBe(1);

    // Continua rolando até a fila inteira existir: aí a volta pode ligar.
    for (let i = 0; i < 4; i++) {
      fireEvent.scroll(trilho);
      assentar();
    }
    // Fila inteira (40) e, se a volta ligou, as 3 cópias dela (120).
    expect([40, 120]).toContain(cartoes());
  });
});
