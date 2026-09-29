import type { MouseEvent, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ScrollContainerContext } from '@/app/layout/scroll-context';
import { useVoltarAoTopo } from '@/app/layout/useVoltarAoTopo';

function montar(rota: string, scrollTop: number) {
  const main = document.createElement('main');
  Object.defineProperty(main, 'scrollTop', { value: scrollTop, configurable: true });
  const scrollTo = vi.fn();
  main.scrollTo = scrollTo as unknown as typeof main.scrollTo;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[rota]}>
      <ScrollContainerContext.Provider value={main}>{children}</ScrollContainerContext.Provider>
    </MemoryRouter>
  );
  const { result } = renderHook(() => useVoltarAoTopo(), { wrapper });
  return { handler: result.current, scrollTo };
}

function clique(extra: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  return { preventDefault: vi.fn(), ...extra } as unknown as MouseEvent<HTMLAnchorElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe('useVoltarAoTopo', () => {
  it('"Início" estando na Início rola suave de volta ao topo, sem navegar', () => {
    const { handler, scrollTo } = montar('/', 900);
    const ev = clique();
    handler(ev, '/');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('em outra rota, "Início" só navega', () => {
    const { handler, scrollTo } = montar('/search', 900);
    const ev = clique();
    handler(ev, '/');
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('outros destinos não são afetados', () => {
    const { handler, scrollTo } = montar('/', 900);
    const ev = clique();
    handler(ev, '/search');
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('Ctrl/⌘-clique continua abrindo em outra aba', () => {
    const { handler, scrollTo } = montar('/', 900);
    const ev = clique({ metaKey: true });
    handler(ev, '/');
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('já no topo, não faz nada (nem renavega)', () => {
    const { handler, scrollTo } = montar('/', 0);
    const ev = clique();
    handler(ev, '/');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
