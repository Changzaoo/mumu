import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Network-backed rows (Firestore / importer) — render nothing in tests.
vi.mock('@/components/media/CommunityTracksRow', () => ({
  CommunityTracksRow: () => null,
}));
vi.mock('@/components/media/DeviceTracksRow', () => ({
  DeviceTracksRow: () => null,
}));
vi.mock('@/lib/artistImage', () => ({
  useArtistImage: () => null,
}));

import { makeTrack } from '@/test/factories';

// localLibrary caches its registry in module scope — re-import per test so each
// test's seeded localStorage is actually read.
async function renderHome(): Promise<void> {
  const { default: HomePage } = await import('@/pages/HomePage');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<HomePage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window.localStorage.clear();
});

describe('HomePage (personal library)', () => {
  // vi.resetModules() força re-transform do grafo inteiro da Home a cada teste
  // (necessário por causa do cache em módulo do localLibrary) — o primeiro
  // import frio passa dos 5s padrão em máquinas ocupadas. 60s cobre até a suíte inteira disputando CPU.
  it(
    'renders the greeting, quick access and the empty state when the library is empty',
    { timeout: 60_000 },
    async () => {
      await renderHome();
      expect(screen.getByText(/^(Bom dia|Boa tarde|Boa noite)$/)).toBeInTheDocument();
      expect(screen.getByText('Músicas Curtidas')).toBeInTheDocument();
      expect(screen.getByText('Tocadas recentemente')).toBeInTheDocument();
      expect(screen.getByText('Sua biblioteca está vazia')).toBeInTheDocument();
    },
  );

  it('renders artist and genre shelves from the local library', { timeout: 60_000 }, async () => {
    const track = makeTrack('local:1', { title: 'Como Tudo Deve Ser' });
    const entry = {
      track: {
        ...track,
        genre: 'Rock',
        artists: [{ id: 'a1', name: 'Charlie Brown Jr.', slug: '', imageUrl: null }],
      },
      addedAt: new Date().toISOString(),
      sizeBytes: 1,
      mimeType: 'audio/mpeg',
    };
    window.localStorage.setItem('aurial:library', JSON.stringify([entry]));

    await renderHome();

    expect(screen.getByText('Rock')).toBeInTheDocument();
    expect(screen.getByText('Como Tudo Deve Ser')).toBeInTheDocument();
    expect(screen.getByText('Seus artistas')).toBeInTheDocument();
    expect(screen.getAllByText('Charlie Brown Jr.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sua biblioteca está vazia')).not.toBeInTheDocument();
  });
});
