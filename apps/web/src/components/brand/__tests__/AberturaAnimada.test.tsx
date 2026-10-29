/**
 * A ABERTURA: UMA VEZ POR SESSÃO, NO HTML, E COM "PULAR".
 *
 * Pedidos do dono (27/10 e 29/10/2026): a abertura não repete numa recarga no
 * meio do uso, a pessoa pode pular, e ela não pode travar no celular fraco —
 * por isso a cena mora no index.html e começa antes do app (aberturaCena.ts).
 * O que se trava aqui:
 *
 *  - o script do <head> marca a sessão e cobre o app (data-abrindo);
 *  - sessão já marcada → a cena nem aparece;
 *  - o componente tira a cena quando ela acaba E o app está pronto, no fade;
 *  - "Pular" (botão ou Esc) acaba a cena na hora;
 *  - a cena só anima transform e opacity (o que anda fora da linha principal).
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ loading: false, user: null }) }));
const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));

import { AberturaAnimada, DURACAO_DA_CENA_MS, SAIDA_MS } from '../AberturaAnimada';
import { CHAVE_VISTA, CSS_DA_CENA, htmlDaCena, scriptDoHead } from '../aberturaCena';

const raiz = document.documentElement;

/** O que o navegador faz com o index.html: roda o script do head e lê a cena. */
function carregarPagina(): void {
  new Function(scriptDoHead())();
  document.body.insertAdjacentHTML('beforeend', htmlDaCena());
}

const cena = (): HTMLElement | null => document.getElementById('abertura');

describe('a abertura', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    anotar.mockClear();
    for (const a of [
      'data-abrindo',
      'data-sem-abertura',
      'data-abertura-pulada',
      'data-abertura-parada',
    ])
      raiz.removeAttribute(a);
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('primeira abertura da sessão: cobre o app e marca a sessão', () => {
    carregarPagina();
    render(<AberturaAnimada />);
    expect(cena()).toBeTruthy();
    expect(raiz.dataset.abrindo).toBe('1');
    expect(window.sessionStorage.getItem(CHAVE_VISTA)).toBe('1');
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'mostrada');
  });

  it('recarga no meio do uso (sessão já marcada) → não aparece', () => {
    window.sessionStorage.setItem(CHAVE_VISTA, '1');
    carregarPagina();
    expect(raiz.dataset.abrindo).toBeUndefined();
    expect(raiz.hasAttribute('data-sem-abertura')).toBe(true);
    render(<AberturaAnimada />);
    expect(cena()).toBeNull();
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'dispensada: já vista nesta sessão');
  });

  it('fica a cena inteira e sai no fade', () => {
    carregarPagina();
    render(<AberturaAnimada />);
    act(() => vi.advanceTimersByTime(DURACAO_DA_CENA_MS - 50));
    expect(cena()?.classList.contains('ab-saindo')).toBe(false);
    expect(raiz.dataset.abrindo).toBe('1');
    act(() => vi.advanceTimersByTime(60));
    expect(cena()?.classList.contains('ab-saindo')).toBe(true);
    expect(raiz.dataset.abrindo).toBeUndefined();
    act(() => vi.advanceTimersByTime(SAIDA_MS + 20));
    expect(cena()).toBeNull();
  });

  it('"Pular" acaba a cena na hora', () => {
    carregarPagina();
    render(<AberturaAnimada />);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(cena()!.querySelector('.ab-pular')!);
    expect(anotar).toHaveBeenCalledWith('app', 'abertura', 'pulada');
    act(() => vi.advanceTimersByTime(SAIDA_MS + 20));
    expect(cena()).toBeNull();
  });

  it('Esc também pula', () => {
    carregarPagina();
    render(<AberturaAnimada />);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(SAIDA_MS + 20));
    expect(cena()).toBeNull();
  });

  it('a cena só anima transform e opacity', () => {
    const quadros = CSS_DA_CENA.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})+\s*\}/g) ?? [];
    expect(quadros.length).toBeGreaterThan(5);
    for (const q of quadros) {
      const props = [...q.replace(/^@keyframes[^{]+\{/, '').matchAll(/([a-z-]+)\s*:/g)].map(
        (m) => m[1],
      );
      for (const p of props) expect(['transform', 'opacity'], q).toContain(p);
    }
  });
});
