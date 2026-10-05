/**
 * /mix/:key É VIRTUALIZADA.
 *
 * Um mix por gênero tem milhares de faixas; uma linha por faixa eram ~30 mil
 * nós de DOM no celular (LCP de 5,9 s, quadro de 1,5 s na rolagem). A página
 * agora usa o `VirtualList`, como GenreLocalPage/ArtistLocalPage. O que este
 * teste prova: poucas linhas montadas com 5.000 faixas — e a fila, ao tocar,
 * continua recebendo TODAS elas (não só as visíveis).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { telaDoMotoG34 } from '@/test/telaVirtual';
import { makeTrack } from '@/test/factories';

const fixtures = vi.hoisted(() => ({
  tracks: [] as unknown[],
  vazio: [] as unknown[],
  playQueue: vi.fn(),
}));

vi.mock('@/lib/local/localLibrary', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  subscribe: () => () => {},
  list: () => fixtures.vazio,
  genreTracks: () => fixtures.tracks,
  artistTracks: () => [],
  hasLocalCover: () => false,
  ensureLocalCoverUrl: async () => null,
  versaoDaBiblioteca: () => 0,
}));
// A lógica do mix (lib/reco) não é o assunto aqui: sem card, cai no `mixFor`.
vi.mock('@/lib/reco/recommend', () => ({
  buildRecommendations: () => [],
  mixDaChave: () => null,
}));
vi.mock('@/features/library/api', () => ({
  useTrackLikes: () => ({ isLiked: () => false, toggle: vi.fn() }),
}));
vi.mock('@/components/media/ShareDialog', () => ({ openShare: vi.fn() }));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (selector: (s: unknown) => unknown) =>
    selector({ playQueue: fixtures.playQueue, currentTrack: null, isPlaying: false }),
}));

const TOTAL = 5000;

// jsdom não tem layout: sem isto a área rolável mede 0 e nenhuma linha monta.
beforeAll(() => telaDoMotoG34());

describe('MixPage virtualizada', () => {
  it('com 5.000 faixas monta só uma janela de linhas e a fila recebe todas', async () => {
    fixtures.tracks = Array.from({ length: TOTAL }, (_, i) => makeTrack(`m:${i}`));
    const { default: Page } = await import('@/pages/MixPage');
    const { container } = render(
      <MemoryRouter initialEntries={['/mix/genre:Pop']}>
        <Routes>
          <Route path="/mix/:key" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    );

    // Cabeçalho e contagem seguem corretos (total real, não o da janela).
    expect(screen.getByRole('heading', { name: 'Mix Pop' })).toBeInTheDocument();
    expect(screen.getByText(/5000 músicas/)).toBeInTheDocument();

    const linhas = container.querySelectorAll('[data-index]');
    // Limitado e pequeno: a janela + folga de rolagem, nunca as 5.000.
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.length).toBeLessThanOrEqual(40);
    expect(container.querySelectorAll('*').length).toBeLessThan(2000);
    // Ordem preservada: a primeira linha é a primeira faixa.
    expect(linhas[0]).toHaveAttribute('data-index', '0');
    expect(screen.getByText('Track m:0')).toBeInTheDocument();
    expect(screen.queryByText('Track m:4999')).not.toBeInTheDocument();

    // "Em ordem" toca o mix inteiro como fila.
    fireEvent.click(screen.getByRole('button', { name: /Em ordem/ }));
    expect(fixtures.playQueue).toHaveBeenCalledTimes(1);
    const [fila, indice] = fixtures.playQueue.mock.calls[0]!;
    expect(fila).toHaveLength(TOTAL);
    expect(indice).toBe(0);

    // "Tocar mix" (embaralhado) também leva todas.
    fireEvent.click(screen.getByRole('button', { name: /Tocar mix/ }));
    expect(fixtures.playQueue.mock.calls[1]![0]).toHaveLength(TOTAL);
  });
});
