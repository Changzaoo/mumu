/**
 * A BUSCA NÃO CAI POR CAUSA DE UMA ENTRADA QUEBRADA.
 *
 * O acervo chega do servidor sem validação e vai para o registro local. Uma
 * entrada sem título (ou com artista sem nome) fazia `norm(t.title)` lançar
 * dentro do `useMemo` da página — e a busca inteira virava "Algo deu errado":
 * "alguma coisa rolou e não pesquisou nada". Agora a entrada quebrada é
 * ignorada e as outras continuam acháveis.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeTrack } from '@/test/factories';

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    on: vi.fn(() => () => undefined),
    analyser: null,
    setLocalSourceResolver: vi.fn(),
  },
  AudioEngine: class {},
}));
// Rede (importador, conta) fica de fora: aqui se testa a busca no acervo.
vi.mock('@/features/search/MaisMusicas', () => ({ MaisMusicas: () => null }));
vi.mock('@/features/library/api', () => ({
  useTrackLikes: () => ({ isLiked: () => false, toggle: vi.fn() }),
}));
vi.mock('@/lib/search/lyricsSearch', () => ({
  searchByLyrics: vi.fn(async () => []),
  indexLyricsInBackground: vi.fn(async () => undefined),
}));

async function renderSearch(q: string): Promise<void> {
  const { default: SearchPage } = await import('@/pages/SearchPage');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(q)}`]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<SearchPage />, { wrapper });
}

const entrada = (track: unknown) => ({
  track,
  addedAt: new Date().toISOString(),
  sizeBytes: 1,
  mimeType: 'audio/mpeg',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window.localStorage.clear();
});

describe('SearchPage', () => {
  it(
    'acha a música mesmo com uma entrada sem título e outra com artista sem nome no registro',
    { timeout: 60_000 },
    async () => {
      const boa = makeTrack('c:1', {
        title: 'Como Tudo Deve Ser',
        artists: [{ id: 'a1', name: 'Charlie Brown Jr.', slug: '', imageUrl: null }],
      });
      const semTitulo = { ...makeTrack('c:2'), title: undefined };
      const artistaSemNome = {
        ...makeTrack('c:3', { title: 'Como Vai Você' }),
        artists: [{ id: 'a2', name: null, slug: '', imageUrl: null }],
      };
      window.localStorage.setItem(
        'aurial:library',
        JSON.stringify([entrada(semTitulo), entrada(boa), entrada(artistaSemNome)]),
      );
      const erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await renderSearch('como');

      expect(screen.queryByText('Algo deu errado')).not.toBeInTheDocument();
      expect(screen.getAllByText('Como Tudo Deve Ser').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Como Vai Você').length).toBeGreaterThan(0);
      expect(erros.mock.calls.some((c) => String(c[0]).includes('page crashed'))).toBe(false);
      erros.mockRestore();
    },
  );

  it('sem resultado no acervo, não mostra "Algo deu errado"', { timeout: 60_000 }, async () => {
    window.localStorage.setItem(
      'aurial:library',
      JSON.stringify([entrada(makeTrack('c:1', { title: 'Garota de Ipanema' }))]),
    );
    await renderSearch('xyzzy');
    expect(screen.queryByText('Algo deu errado')).not.toBeInTheDocument();
    expect(screen.queryByText('Garota de Ipanema')).not.toBeInTheDocument();
  });
});
