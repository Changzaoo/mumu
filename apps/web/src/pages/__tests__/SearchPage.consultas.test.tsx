/**
 * Consultas hostis na busca do acervo: acento, caixa, pontuação, espaços extras,
 * emoji e caracteres de regex. Nada pode lançar ("Algo deu errado") e a música
 * certa precisa continuar achável.
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

const ACERVO = [
  makeTrack('c:1', {
    title: 'Olá, Mundo!',
    artists: [{ id: 'a1', name: 'Zé Ramalho', slug: '', imageUrl: null }],
  }),
  makeTrack('c:2', {
    title: 'Faixa (ao vivo) [2020]',
    artists: [{ id: 'a2', name: 'Banda X', slug: '', imageUrl: null }],
  }),
];

async function buscar(q: string): Promise<void> {
  window.localStorage.setItem('aurial:library', JSON.stringify(ACERVO.map(entrada)));
  await renderSearch(q);
}

describe('SearchPage: consultas hostis', () => {
  it.each(['(', '[', '*', '\\', '+?', '.*', '\u{1F3B5}', '   ', 'a'.repeat(5000)])(
    'consulta %j não derruba a página',
    { timeout: 60_000 },
    async (q) => {
      await buscar(q);
      expect(screen.queryByText('Algo deu errado')).not.toBeInTheDocument();
    },
  );

  it('caixa e acento são ignorados', { timeout: 60_000 }, async () => {
    await buscar('OLA');
    expect(screen.getAllByText('Olá, Mundo!').length).toBeGreaterThan(0);
  });

  it('artista com acento acha por consulta sem acento', { timeout: 60_000 }, async () => {
    await buscar('ze ramalho');
    expect(screen.getAllByText('Olá, Mundo!').length).toBeGreaterThan(0);
  });

  it('pontuação do título não impede o achado ("ola mundo")', { timeout: 60_000 }, async () => {
    await buscar('ola mundo');
    expect(screen.getAllByText('Olá, Mundo!').length).toBeGreaterThan(0);
  });

  it('espaço duplo no meio da consulta não impede o achado', { timeout: 60_000 }, async () => {
    await buscar('ola   mundo');
    expect(screen.getAllByText('Olá, Mundo!').length).toBeGreaterThan(0);
  });

  it(
    'parênteses e colchetes do título são achados sem digitá-los',
    { timeout: 60_000 },
    async () => {
      await buscar('faixa ao vivo 2020');
      expect(screen.getAllByText('Faixa (ao vivo) [2020]').length).toBeGreaterThan(0);
    },
  );
});
