import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import {
  guardarRolagem,
  LIMITE_DE_ENTRADAS,
  lerRolagem,
  useRolagemPorEntrada,
} from '@/app/layout/useRolagemPorEntrada';

/** O contêiner que rola, com altura controlada pelo teste (jsdom não tem layout). */
function criarScroller(alturaInicial: number) {
  const el = document.createElement('main');
  let altura = alturaInicial;
  let topo = 0;
  Object.defineProperty(el, 'scrollHeight', { get: () => altura, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 800, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => topo,
    set: (v: number) => {
      topo = v;
    },
    configurable: true,
  });
  el.scrollTo = ((arg: ScrollToOptions | number) => {
    topo = typeof arg === 'number' ? arg : (arg.top ?? 0);
  }) as typeof el.scrollTo;
  return {
    el,
    /** A pessoa rola até `y` (move a posição e despacha o evento). */
    rolarPara(y: number) {
      topo = y;
      el.dispatchEvent(new Event('scroll'));
    },
    crescer(novaAltura: number) {
      altura = novaAltura;
    },
    topo: () => topo,
  };
}

/** ResizeObserver de mentira: o teste dispara à mão quando o conteúdo cresce. */
const observadores: Array<() => void> = [];
class ROFalso {
  constructor(private cb: () => void) {
    observadores.push(cb);
  }
  observe() {}
  disconnect() {
    const i = observadores.indexOf(this.cb);
    if (i >= 0) observadores.splice(i, 1);
  }
  unobserve() {}
}

let nav: NavigateFunction;
function Arnes({ scroller, conteudo }: { scroller: HTMLElement; conteudo: HTMLElement }) {
  useRolagemPorEntrada(scroller, conteudo);
  const navigate = useNavigate();
  useEffect(() => {
    nav = navigate;
  });
  return null;
}
function montar(scroller: HTMLElement, conteudo: HTMLElement): ReactNode {
  return (
    <MemoryRouter initialEntries={['/library']}>
      <Arnes scroller={scroller} conteudo={conteudo} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  observadores.length = 0;
  vi.stubGlobal('ResizeObserver', ROFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRolagemPorEntrada', () => {
  it('PUSH começa do topo; POP devolve a posição em que a página foi deixada', async () => {
    const s = criarScroller(5000);
    render(montar(s.el, document.createElement('div')));

    s.rolarPara(1200); // rolou a biblioteca
    await act(async () => nav('/artista/x')); // abriu um artista (PUSH)
    expect(s.topo()).toBe(0);

    await act(async () => nav(-1)); // voltou (POP)
    expect(s.topo()).toBe(1200);
  });

  it('cada entrada guarda a sua posição (A → B → C, e volta por B e A)', async () => {
    const s = criarScroller(9000);
    render(montar(s.el, document.createElement('div')));

    s.rolarPara(300);
    await act(async () => nav('/b'));
    s.rolarPara(700);
    await act(async () => nav('/c'));
    expect(s.topo()).toBe(0);

    await act(async () => nav(-1));
    expect(s.topo()).toBe(700);
    await act(async () => nav(-1));
    expect(s.topo()).toBe(300);
  });

  it('lista virtual: restaura DEPOIS que a altura existe, não antes', async () => {
    const s = criarScroller(5000);
    render(montar(s.el, document.createElement('div')));
    s.rolarPara(2000);
    await act(async () => nav('/artista/x'));

    // Na volta a página ainda é um esqueleto: pouca altura.
    s.crescer(900);
    await act(async () => nav(-1));
    expect(s.topo()).not.toBe(2000);

    // A lista monta e ganha altura: o observador dispara e a posição entra.
    s.crescer(6000);
    await act(async () => observadores.forEach((cb) => cb()));
    expect(s.topo()).toBe(2000);
  });

  it('a pessoa que rola antes da lista chegar não é puxada de volta', async () => {
    const s = criarScroller(5000);
    render(montar(s.el, document.createElement('div')));
    s.rolarPara(2000);
    await act(async () => nav('/artista/x'));
    s.crescer(900);
    await act(async () => nav(-1));

    s.el.dispatchEvent(new Event('touchstart')); // pegou na tela
    s.crescer(6000);
    await act(async () => observadores.forEach((cb) => cb()));
    expect(s.topo()).not.toBe(2000);
  });

  it('mesma página com outra chave (?q= trocado por REPLACE) mantém a rolagem', async () => {
    const s = criarScroller(5000);
    render(montar(s.el, document.createElement('div')));
    s.rolarPara(640);
    await act(async () => nav('/library?q=a', { replace: true }));
    expect(s.topo()).toBe(640);
  });

  it('o armazenamento tem teto de entradas (as mais velhas saem)', () => {
    for (let i = 0; i < LIMITE_DE_ENTRADAS + 15; i++) guardarRolagem(`k${i}`, i + 1);
    expect(lerRolagem('k0')).toBeUndefined();
    expect(lerRolagem(`k${LIMITE_DE_ENTRADAS + 14}`)).toBe(LIMITE_DE_ENTRADAS + 15);
    expect(
      Object.keys(JSON.parse(window.sessionStorage.getItem('radinho:rolagem') ?? '{}')),
    ).toHaveLength(LIMITE_DE_ENTRADAS);
  });
});
