/**
 * Seção "Do YouTube" da busca: logado vê os resultados, toca na hora pela fila
 * de faixas `youtube:` e guarda pela fila de import; deslogado é convidado a
 * entrar, sem nenhum pedido ao importador.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ImporterHelper from '@/lib/local/importerHelper';

const estado = vi.hoisted(() => ({
  user: { uid: 'u1', isAnonymous: false } as { uid: string; isAnonymous: boolean } | null,
  playQueue: vi.fn(),
  enqueue: vi.fn(),
  buscar: vi.fn(),
  itens: [] as unknown[],
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: estado.user, profile: null, loading: false }),
}));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (sel: (s: unknown) => unknown) =>
    sel({ playQueue: estado.playQueue, currentTrack: null, isPlaying: false, toggle: vi.fn() }),
}));
vi.mock('@/lib/local/importQueue', () => ({
  subscribe: () => () => undefined,
  list: () => estado.itens, // mesma referência sempre, como a fila real
  enqueue: estado.enqueue,
  retry: vi.fn(),
}));
vi.mock('@/lib/local/localLibrary', () => ({ findBySource: () => null }));
vi.mock('@/components/media/PlayButton', () => ({
  PlayButton: (props: { onClick?: () => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label']} onClick={props.onClick} />
  ),
}));
vi.mock('@/lib/local/importerHelper', async (original) => {
  const real = await original<typeof ImporterHelper>();
  return {
    ...real,
    buscarNoYoutube: estado.buscar,
    aquecerFontes: () => Promise.resolve(),
    faixaDoYoutube: (r: { url: string; titulo: string }) =>
      Promise.resolve({
        id: `youtube:${real.videoIdDoYoutube(r.url)}`,
        title: r.titulo,
        streamUrl: `https://imp/stream?url=${encodeURIComponent(r.url)}`,
      }),
  };
});

import { DoYoutube } from '@/features/search/DoYoutube';

const RESULTADOS = [
  {
    url: 'https://www.youtube.com/watch?v=fgysUhl98As',
    titulo: 'Eu sou 157',
    canal: 'Racionais TV',
    duracaoSeg: 532,
    capa: 'https://i.ytimg.com/vi/fgysUhl98As/hqdefault.jpg',
  },
  {
    url: 'https://www.youtube.com/watch?v=CsglWlcZTio',
    titulo: 'Eu sou 157 (ao vivo)',
    canal: 'Outro canal',
    duracaoSeg: 425,
    capa: null,
  },
];

function montar(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  estado.user = { uid: 'u1', isAnonymous: false };
  estado.playQueue.mockReset();
  estado.enqueue.mockReset();
  estado.buscar.mockReset();
  estado.buscar.mockResolvedValue({ ok: true, resultados: RESULTADOS });
});

describe('DoYoutube', () => {
  it('logado: lista, toca a fila inteira a partir do clicado e guarda na biblioteca', async () => {
    montar(<DoYoutube termo="eu sou 157" automatico />);
    expect(await screen.findByText('Eu sou 157 (ao vivo)', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('8:52')).toBeTruthy();
    expect(estado.buscar).toHaveBeenCalledWith('eu sou 157', expect.anything());

    fireEvent.click(screen.getByLabelText('Tocar Eu sou 157 (ao vivo)'));
    await waitFor(() => expect(estado.playQueue).toHaveBeenCalled());
    const [faixas, inicio] = estado.playQueue.mock.calls[0] as [Array<{ id: string }>, number];
    expect(faixas.map((f) => f.id)).toEqual(['youtube:fgysUhl98As', 'youtube:CsglWlcZTio']);
    expect(inicio).toBe(1);

    fireEvent.click(screen.getAllByText('Adicionar à biblioteca')[0]!);
    expect(estado.enqueue).toHaveBeenCalledWith('https://www.youtube.com/watch?v=fgysUhl98As');
  });

  it('deslogado: pede para entrar e não chama o importador', async () => {
    estado.user = null;
    montar(<DoYoutube termo="eu sou 157" automatico />);
    expect(screen.getByText('Entrar')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 900));
    expect(estado.buscar).not.toHaveBeenCalled();
  });

  it('com resultados locais suficientes, só busca quando a pessoa pede', async () => {
    montar(<DoYoutube termo="eu sou 157" automatico={false} />);
    await new Promise((r) => setTimeout(r, 900));
    expect(estado.buscar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Buscar “eu sou 157” no YouTube/));
    expect(await screen.findByText('Eu sou 157 (ao vivo)')).toBeTruthy();
  });

  it('limite do servidor vira aviso de esperar', async () => {
    estado.buscar.mockResolvedValue({ ok: false, motivo: 'limite' });
    montar(<DoYoutube termo="eu sou 157" automatico />);
    expect(await screen.findByText(/Muitas buscas seguidas/, {}, { timeout: 3000 })).toBeTruthy();
  });
});
