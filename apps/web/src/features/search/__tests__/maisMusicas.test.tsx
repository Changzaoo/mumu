/**
 * "Mais músicas" na busca: o achado por baixo aparece como faixa comum (nada
 * de YouTube na tela), toca na hora com a fila inteira e vai para o acervo
 * pela fila de import. Deslogado não pergunta nada ao importador.
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
    sel({ playQueue: estado.playQueue, currentTrack: null, isPlaying: false }),
}));
vi.mock('@/lib/local/importQueue', () => ({
  subscribe: () => () => undefined,
  list: () => estado.itens,
  enqueue: estado.enqueue,
}));
vi.mock('@/lib/local/localLibrary', () => ({ findBySource: () => null }));
vi.mock('@/components/media/TrackRow', () => ({
  TrackList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TrackRow: (props: {
    track: { title: string; artists: { name: string }[] };
    onPlay?: () => void;
  }) => (
    <button type="button" onClick={props.onPlay}>
      {props.track.title} — {props.track.artists.map((a) => a.name).join(', ')}
    </button>
  ),
}));
vi.mock('@/lib/local/importerHelper', async (original) => {
  const real = await original<typeof ImporterHelper>();
  return {
    ...real,
    buscarNoYoutube: estado.buscar,
    aquecerFontes: () => Promise.resolve(),
    buildStreamUrl: (url: string) => Promise.resolve(`https://imp/stream?url=${url}`),
  };
});
vi.mock('@/lib/firebase', () => ({ getIdToken: () => Promise.resolve('tok') }));

import { MaisMusicas } from '@/features/search/MaisMusicas';

const RESULTADOS = [
  {
    url: 'https://www.youtube.com/watch?v=fgysUhl98As',
    titulo: 'Matuê - Mantém (Clipe Oficial)',
    canal: 'MatueVEVO',
    duracaoSeg: 200,
    capa: null,
  },
  {
    // A mesma música em outro vídeo: não aparece duas vezes.
    url: 'https://www.youtube.com/watch?v=CsglWlcZTio',
    titulo: 'Matuê - Mantém (Official Audio)',
    canal: 'Matuê - Topic',
    duracaoSeg: 199,
    capa: null,
  },
  {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    titulo: 'Matuê - Kenny G',
    canal: 'MatueVEVO',
    duracaoSeg: 180,
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

describe('MaisMusicas', () => {
  it('mostra faixas limpas, sem repetir e sem nada de YouTube', async () => {
    const { container } = montar(<MaisMusicas termo="mantem" jaNaTela={[]} semNadaNoAcervo />);
    expect(await screen.findByText('Mantém — Matuê', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('Kenny G — Matuê')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/youtube|clipe|vevo|topic/i);
  });

  it('tocar: fila inteira a partir da clicada, e baixa por baixo só ela', async () => {
    montar(<MaisMusicas termo="mantem" jaNaTela={[]} semNadaNoAcervo={false} />);
    fireEvent.click(await screen.findByText('Kenny G — Matuê', {}, { timeout: 3000 }));
    await waitFor(() => expect(estado.playQueue).toHaveBeenCalled());
    const [faixas, inicio] = estado.playQueue.mock.calls[0] as [Array<{ id: string }>, number];
    expect(faixas.map((f) => f.id)).toEqual(['youtube:fgysUhl98As', 'youtube:dQw4w9WgXcQ']);
    expect(inicio).toBe(1);
    expect(estado.enqueue).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('o que o acervo já mostrou não se repete', async () => {
    const doAcervo = { id: 'local:1', title: 'Mantém', artists: [{ name: 'Matuê' }] };
    montar(<MaisMusicas termo="mantem" jaNaTela={[doAcervo as never]} semNadaNoAcervo={false} />);
    expect(await screen.findByText('Kenny G — Matuê', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('Mantém — Matuê')).toBeNull();
  });

  it('deslogado: não chama o importador e, sem nada no acervo, convida a entrar', async () => {
    estado.user = null;
    montar(<MaisMusicas termo="mantem" jaNaTela={[]} semNadaNoAcervo />);
    expect(screen.getByText('Entrar')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 900));
    expect(estado.buscar).not.toHaveBeenCalled();
  });
});
