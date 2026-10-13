import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));
vi.mock('@/stores/playerStore', () => ({
  prepararRetomadaTocando: vi.fn(),
  usePlayerStore: { getState: () => ({ isPlaying: true }) },
}));
vi.mock('@/stores/uiStore', () => ({ guardarTelaParaRecarregar: vi.fn() }));

import {
  ESPERA_MS,
  destinoDoLink,
  instalarVigiaDoMenu,
  marcarRotaPintada,
  type RouterMinimo,
} from '@/lib/telemetry/menuTravado';

const router: RouterMinimo & { navigate: ReturnType<typeof vi.fn> } = {
  navigate: vi.fn(),
  state: { navigation: { state: 'idle' }, location: { pathname: '/' } },
};
const assign = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign, origin: 'http://localhost', href: 'http://localhost/' },
  });
  instalarVigiaDoMenu(router);
  // O jsdom não navega: quem segue o link no app é o router, não o navegador.
  document.addEventListener('click', (e) => e.preventDefault());
});

beforeEach(() => {
  vi.useFakeTimers();
  anotar.mockClear();
  router.navigate.mockReset();
  assign.mockClear();
  sessionStorage.clear();
  marcarRotaPintada('/');
  document.body.innerHTML = `
    <nav><a id="buscar" href="/search">Buscar</a></nav>
    <main><a id="card" href="/disco/x">card</a></main>`;
});

afterEach(() => {
  vi.useRealTimers();
});

function tocar(id: string): void {
  document.getElementById(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

describe('vigia do menu', () => {
  it('toque que trocou a tela: nada a fazer', () => {
    tocar('buscar');
    marcarRotaPintada('/search');
    vi.advanceTimersByTime(ESPERA_MS * 3);
    expect(anotar).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('toque perdido: anota, pede de novo ao router e, se não pegar, recarrega lá', () => {
    tocar('buscar');
    vi.advanceTimersByTime(ESPERA_MS);
    expect(anotar).toHaveBeenCalledWith(
      'erro',
      'menu-sem-efeito',
      expect.stringContaining('/search'),
    );
    expect(router.navigate).toHaveBeenCalledWith('/search');
    expect(assign).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ESPERA_MS);
    expect(anotar).toHaveBeenCalledWith('erro', 'menu-recarga', expect.stringContaining('/search'));
    expect(assign).toHaveBeenCalledWith('/search');
  });

  it('o segundo degrau resolve: sem recarga', () => {
    tocar('buscar');
    vi.advanceTimersByTime(ESPERA_MS);
    marcarRotaPintada('/search');
    vi.advanceTimersByTime(ESPERA_MS);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a pessoa foi para outro lugar no meio: não é com o vigia', () => {
    tocar('buscar');
    marcarRotaPintada('/library');
    vi.advanceTimersByTime(ESPERA_MS * 3);
    expect(anotar).not.toHaveBeenCalled();
  });

  it('link do conteúdo (fora da moldura) não é vigiado', () => {
    tocar('card');
    vi.advanceTimersByTime(ESPERA_MS * 3);
    expect(anotar).not.toHaveBeenCalled();
  });

  it('não recarrega duas vezes em seguida (sem laço)', () => {
    tocar('buscar');
    vi.advanceTimersByTime(ESPERA_MS * 2);
    tocar('buscar');
    vi.advanceTimersByTime(ESPERA_MS * 2);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('body preso em pointer-events:none sem diálogo é solto', () => {
    document.body.style.pointerEvents = 'none';
    document.querySelector('main')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.style.pointerEvents).toBe('');
    expect(anotar).toHaveBeenCalledWith(
      'erro',
      'menu-coberto',
      expect.stringContaining('pointer-events'),
    );
  });
});

describe('destinoDoLink', () => {
  const a = (href: string, attrs: Record<string, string> = {}): HTMLAnchorElement => {
    const el = document.createElement('a');
    el.setAttribute('href', href);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  it('interno vira caminho + busca', () => {
    expect(destinoDoLink(a('/search?q=x'), 'http://localhost')).toBe('/search?q=x');
  });
  it('externo, nova aba e download ficam de fora', () => {
    expect(destinoDoLink(a('https://outro.site/x'), 'http://localhost')).toBeNull();
    expect(destinoDoLink(a('/x', { target: '_blank' }), 'http://localhost')).toBeNull();
    expect(destinoDoLink(a('/x', { download: '' }), 'http://localhost')).toBeNull();
  });
});
