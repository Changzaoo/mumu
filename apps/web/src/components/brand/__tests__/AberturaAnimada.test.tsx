/**
 * A ABERTURA: UMA VEZ POR SESSÃO, MAIS RÁPIDA, E COM "PULAR".
 *
 * Pedidos do dono (27/10/2026): "a abertura está muito demorada", "o usuário
 * tem que poder pular", e "uma vez dentro do app, se ele precisar atualizar,
 * ela não deve aparecer de novo". As regras travadas aqui:
 *
 *  - primeira abertura da sessão → a cena aparece e a sessão fica marcada;
 *  - recarga no meio do uso (sessão já marcada) → nada aparece;
 *  - a cena dura o tempo de cena dividido pelo RITMO, e sai no fade;
 *  - "Pular" (botão ou Esc) acaba a cena na hora e a abertura sai no fade.
 *
 * Sem movimento aqui = falso: é a cena de verdade, com os timers reais (falsos
 * do vitest). A câmera não roda no jsdom (`animate` não existe) — e não é dela
 * que estes testes tratam.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ loading: false, user: null }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/hooks/useSemMovimento', () => ({ useSemMovimento: () => false }));
const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));

import { AberturaAnimada, DURACAO_DA_CENA_MS, RITMO } from '../AberturaAnimada';
import { aberturaJaVista, marcarAberturaVista } from '../aberturaVista';

const CENA_REAL_MS = DURACAO_DA_CENA_MS / RITMO;
const FADE_MS = 700;

describe('a abertura', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    anotar.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aparece na primeira abertura da sessão e marca a sessão', () => {
    render(<AberturaAnimada />);
    expect(screen.getByTestId('abertura')).toBeTruthy();
    expect(screen.getByTestId('abertura-pular')).toBeTruthy();
    expect(aberturaJaVista()).toBe(true);
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'mostrada');
  });

  it('recarga no meio do uso (sessão já marcada) → não aparece', () => {
    marcarAberturaVista();
    render(<AberturaAnimada />);
    expect(screen.queryByTestId('abertura')).toBeNull();
    expect(document.documentElement.dataset.abrindo).toBeUndefined();
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'dispensada: já vista nesta sessão');
  });

  it('a cena roda mais rápido que foi desenhada e sai no fade', () => {
    expect(RITMO).toBeGreaterThan(1);
    render(<AberturaAnimada />);
    // Pouco antes do fim da cena (em tempo real): ainda cobrindo a tela.
    act(() => vi.advanceTimersByTime(CENA_REAL_MS - 50));
    expect(screen.getByTestId('abertura')).toBeTruthy();
    expect(document.documentElement.dataset.abrindo).toBe('1');
    // Fim da cena (o fade só começa depois que o React assenta o estado)…
    act(() => vi.advanceTimersByTime(50));
    // …e o fade: foi embora, e o app volta a pintar.
    act(() => vi.advanceTimersByTime(FADE_MS + 20));
    expect(screen.queryByTestId('abertura')).toBeNull();
    expect(document.documentElement.dataset.abrindo).toBeUndefined();
  });

  it('"Pular" acaba a cena na hora', () => {
    render(<AberturaAnimada />);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByTestId('abertura-pular'));
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'pulada');
    act(() => vi.advanceTimersByTime(FADE_MS + 20));
    expect(screen.queryByTestId('abertura')).toBeNull();
  });

  it('Esc também pula', () => {
    render(<AberturaAnimada />);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(FADE_MS + 20));
    expect(screen.queryByTestId('abertura')).toBeNull();
  });
});
