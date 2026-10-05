import { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Link, useLocation } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  __reiniciarCamadas,
  definirPaginaAtual,
  registrarReabridor,
  useCamadaNoHistorico,
} from '@/lib/historico/camadas';

/**
 * O voltar do sistema, simulado no jsdom: `history.back()` dispara `popstate`
 * de verdade (assíncrono), e um ouvinte em fase de BOLHA — registrado depois do
 * gerente, como o do react-router — conta o que "chegaria ao router".
 */
const chegouAoRouter = vi.fn();
beforeEach(() => {
  __reiniciarCamadas();
  chegouAoRouter.mockClear();
  window.addEventListener('popstate', chegouAoRouter);
});
afterEach(async () => {
  cleanup();
  await assentar();
  window.removeEventListener('popstate', chegouAoRouter);
});

const assentar = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
const profundidade = (): number =>
  (window.history.state as { __camada?: { d: number } } | null)?.__camada?.d ?? 0;

async function voltar(): Promise<void> {
  await act(async () => {
    window.history.back();
    await assentar();
  });
}

interface Controle {
  abrir: () => void;
  fechar: () => void;
}
function Camada({ tipo, controle }: { tipo: string; controle: { current: Controle | null } }) {
  const [aberta, setAberta] = useState(false);
  useCamadaNoHistorico(aberta, () => setAberta(false), tipo);
  controle.current = { abrir: () => setAberta(true), fechar: () => setAberta(false) };
  return <div data-testid={tipo}>{aberta ? 'aberta' : 'fechada'}</div>;
}

describe('gerente de camadas', () => {
  it('abrir uma camada empurra UMA entrada; voltar fecha a camada e o router não é avisado', async () => {
    const c = { current: null as Controle | null };
    render(<Camada tipo="player" controle={c} />);
    const antes = window.history.length;

    await act(async () => c.current?.abrir());
    expect(profundidade()).toBe(1);
    expect(window.history.length).toBe(antes + 1);

    await voltar();
    expect(screen.getByTestId('player').textContent).toBe('fechada');
    expect(profundidade()).toBe(0);
    expect(chegouAoRouter).not.toHaveBeenCalled();
  });

  it('camadas aninhadas (letra dentro do player): dois voltares, um de cada vez', async () => {
    const player = { current: null as Controle | null };
    const letra = { current: null as Controle | null };
    render(
      <>
        <Camada tipo="player" controle={player} />
        <Camada tipo="letra" controle={letra} />
      </>,
    );
    await act(async () => player.current?.abrir());
    await act(async () => letra.current?.abrir());
    expect(profundidade()).toBe(2);

    await voltar();
    expect(screen.getByTestId('letra').textContent).toBe('fechada');
    expect(screen.getByTestId('player').textContent).toBe('aberta');

    await voltar();
    expect(screen.getByTestId('player').textContent).toBe('fechada');
    expect(profundidade()).toBe(0);
    expect(chegouAoRouter).not.toHaveBeenCalled();
  });

  it('fechar pela UI consome a entrada: não sobra fantasma e o voltar seguinte navega de verdade', async () => {
    const c = { current: null as Controle | null };
    render(<Camada tipo="player" controle={c} />);
    // Uma entrada "real" por baixo, para o voltar seguinte ter para onde ir.
    window.history.pushState({ idx: 1, key: 'real' }, '');
    definirPaginaAtual('real');

    await act(async () => c.current?.abrir());
    expect(profundidade()).toBe(1);
    await act(async () => c.current?.fechar()); // o X da tela
    await act(async () => assentar());
    expect(profundidade()).toBe(0);
    expect((window.history.state as { key?: string }).key).toBe('real');

    await voltar(); // agora sim: navegação de verdade
    expect(chegouAoRouter).toHaveBeenCalledTimes(1);
  });

  it('fechar pela UI e abrir outra no mesmo instante não embaralha o histórico (corrida menu → diálogo)', async () => {
    const a = { current: null as Controle | null };
    const b = { current: null as Controle | null };
    render(
      <>
        <Camada tipo="menu" controle={a} />
        <Camada tipo="dialogo" controle={b} />
      </>,
    );
    await act(async () => a.current?.abrir());
    await act(async () => {
      a.current?.fechar();
      b.current?.abrir();
    });
    await act(async () => assentar(80));
    expect(screen.getByTestId('dialogo').textContent).toBe('aberta');
    expect(profundidade()).toBe(1);

    await voltar();
    expect(screen.getByTestId('dialogo').textContent).toBe('fechada');
    expect(chegouAoRouter).not.toHaveBeenCalled();
  });

  it('sem camada aberta o gerente não intercepta nada: o voltar vai direto ao router', async () => {
    window.history.pushState({ idx: 1, key: 'a' }, '');
    definirPaginaAtual('a');
    window.history.pushState({ idx: 2, key: 'b' }, '');
    definirPaginaAtual('b');
    await voltar();
    expect(chegouAoRouter).toHaveBeenCalledTimes(1);
    expect((window.history.state as { key?: string }).key).toBe('a');
  });

  it('camada aberta e a rota troca por baixo (link dentro do player): a entrada-fantasma é pulada no voltar', async () => {
    const c = { current: null as Controle | null };
    render(<Camada tipo="player" controle={c} />);
    window.history.pushState({ idx: 1, key: 'p1' }, '');
    definirPaginaAtual('p1');
    await act(async () => c.current?.abrir()); // [.., p1, camada]
    // O router navega com a camada aberta e a UI a fecha, sem consumir a entrada.
    window.history.pushState({ idx: 2, key: 'p2' }, '');
    definirPaginaAtual('p2');
    await act(async () => c.current?.fechar());
    await act(async () => assentar(80));
    expect((window.history.state as { key?: string }).key).toBe('p2');

    await voltar(); // cai na camada-fantasma, que é pulada
    await act(async () => assentar(80));
    expect((window.history.state as { key?: string }).key).toBe('p1');
    expect(profundidade()).toBe(0);
    expect(chegouAoRouter).toHaveBeenCalledTimes(1); // o router só viu a chegada em p1
  });

  it('avançar reabre a camada que o voltar fechou (quando há reabridor)', async () => {
    const c = { current: null as Controle | null };
    render(<Camada tipo="player" controle={c} />);
    registrarReabridor('player', () => c.current?.abrir());
    await act(async () => c.current?.abrir());
    await voltar();
    expect(screen.getByTestId('player').textContent).toBe('fechada');

    await act(async () => {
      window.history.forward();
      await assentar(80);
    });
    expect(screen.getByTestId('player').textContent).toBe('aberta');
    expect(profundidade()).toBe(1);
    expect(chegouAoRouter).not.toHaveBeenCalled();
  });

  it('diálogo Radix FECHADO não ocupa camada nem entrada no histórico', () => {
    render(
      <Dialog>
        <DialogTrigger>abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>texto</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(profundidade()).toBe(0);
  });

  it('diálogo Radix: o voltar fecha o diálogo', async () => {
    const usuario = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>texto</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await usuario.click(screen.getByText('abrir'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(profundidade()).toBe(1);

    await voltar();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(profundidade()).toBe(0);
    expect(chegouAoRouter).not.toHaveBeenCalled();
  });

  it('diálogo Radix fechado pelo X não deixa entrada extra', async () => {
    const usuario = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>texto</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await usuario.click(screen.getByText('abrir'));
    await usuario.click(screen.getByLabelText('Fechar'));
    await act(async () => assentar(200));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(profundidade()).toBe(0);
  });
});

describe('com o react-router de verdade (BrowserRouter, mesmo ouvinte de popstate)', () => {
  it('abrir camada e voltar NÃO muda a rota; voltar de novo navega', async () => {
    const c = { current: null as Controle | null };
    function Casca() {
      const { pathname, key } = useLocation();
      useLayoutEffect(() => definirPaginaAtual(key), [key]);
      return (
        <div>
          <span data-testid="rota">{pathname}</span>
          <Link to="/artista">ir</Link>
          <Camada tipo="player" controle={c} />
        </div>
      );
    }
    window.history.replaceState(null, '', '/');
    render(
      <BrowserRouter>
        <Casca />
      </BrowserRouter>,
    );
    const usuario = userEvent.setup();

    await usuario.click(screen.getByText('ir'));
    expect(screen.getByTestId('rota').textContent).toBe('/artista');

    await act(async () => c.current?.abrir());
    await voltar();
    expect(screen.getByTestId('rota').textContent).toBe('/artista'); // só fechou a camada
    expect(screen.getByTestId('player').textContent).toBe('fechada');

    await voltar();
    expect(screen.getByTestId('rota').textContent).toBe('/'); // agora navegou
  });
});
