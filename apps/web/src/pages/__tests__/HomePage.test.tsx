import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TrackDto } from '@aurial/shared';

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

// The catalog home reads from these hooks (Audius); mock them per test.
vi.mock('@/features/catalog/api', () => ({
  useTrending: vi.fn(),
  useTrendingPlaylists: vi.fn(),
}));

import { useTrending, useTrendingPlaylists } from '@/features/catalog/api';
import HomePage from '@/pages/HomePage';
import { makeTrack } from '@/test/factories';

const mockedTrending = vi.mocked(useTrending);
const mockedPlaylists = vi.mocked(useTrendingPlaylists);

function result<T>(over: Partial<UseQueryResult<T>>): UseQueryResult<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<T>;
}

function renderHome(): void {
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
  mockedPlaylists.mockReturnValue(result({ data: [] }));
});

describe('HomePage (catalog)', () => {
  it('shows a skeleton while trending is loading', () => {
    mockedTrending.mockReturnValue(result<TrackDto[]>({ isLoading: true }));
    renderHome();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('renders trending tracks and the on-device shortcut once loaded', () => {
    const tracks = [makeTrack('audius:1', { title: 'Faixa em alta' })];
    mockedTrending.mockReturnValue(result<TrackDto[]>({ data: tracks }));
    renderHome();

    expect(screen.getByText('Em alta')).toBeInTheDocument();
    expect(screen.getByText('Faixa em alta')).toBeInTheDocument();
    expect(screen.getByText('No seu dispositivo')).toBeInTheDocument();
  });
});
