import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  none: [] as unknown[],
  tracks: [
    {
      id: 'local:1',
      title: 'Hit Um',
      artists: [{ id: 'a', name: 'Fulano', slug: '', imageUrl: null }],
      album: null,
      coverUrl: null,
      durationMs: 1000,
      label: 'Sony Music',
      previewOnly: false,
      playsCount: 0,
      explicit: false,
    },
    {
      id: 'local:2',
      title: 'Hit Dois',
      artists: [{ id: 'a', name: 'Fulano', slug: '', imageUrl: null }],
      album: null,
      coverUrl: null,
      durationMs: 1000,
      label: 'Sony Music',
      previewOnly: false,
      playsCount: 0,
      explicit: false,
    },
  ] as unknown[],
}));

vi.mock('@/lib/local/importerHelper', () => ({ fetchArtistTop: vi.fn(async () => null) }));
vi.mock('@/lib/artistImage', () => ({ useArtistImage: () => null }));
// SEM este mock o teste chama a Wikipedia DE VERDADE: fica lento, falha sem
// rede e quebra de forma intermitente quando a suíte inteira roda junta —
// o pior tipo de teste, porque ensina a ignorar falha vermelha.
vi.mock('@/lib/artistBio', () => ({ useArtistBio: () => null }));
vi.mock('@/lib/local/localLibrary', () => ({
  subscribe: () => () => {},
  list: () => fixtures.none,
  artistTracks: () => fixtures.tracks,
  artistAlbums: () => fixtures.none,
}));

describe('ArtistLocalPage smoke', () => {
  it('renders Populares before the full track list, with the label', async () => {
    const { default: Page } = await import('@/pages/ArtistLocalPage');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/artista/Fulano']}>
          <Routes>
            <Route path="/artista/:name" element={<Page />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Timeout explícito: a página é pesada para renderizar (~4s mesmo isolada)
    // e o padrão de 1s virava falha intermitente quando a suíte roda inteira e
    // os workers disputam CPU. O tempo em si é suspeito e está anotado para
    // investigação — mas um teste que pisca não pode ficar de pé enquanto isso.
    expect(await screen.findByText('Populares', undefined, { timeout: 15_000 })).toBeTruthy();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Populares')).toBeLessThan(headings.indexOf('Todas as músicas'));
    expect(screen.getAllByText('Hit Um').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sony Music/).length).toBeGreaterThan(0);
  });
});
