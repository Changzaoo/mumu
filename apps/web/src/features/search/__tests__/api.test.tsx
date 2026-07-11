import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResultsDto } from '@aurial/shared';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));

import { api } from '@/lib/api';
import { useSearch } from '@/features/search/api';
import { makeTrack } from '@/test/factories';

const mockedGet = vi.mocked(api.get);

function makeResults(query: string): SearchResultsDto {
  return {
    query,
    correctedQuery: null,
    tracks: [makeTrack('t1')],
    albums: [],
    artists: [],
    playlists: [],
    podcasts: [],
    radios: [],
    users: [],
    topResult: { type: 'track', id: 't1' },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSearch', () => {
  it('fetches grouped results for a query', async () => {
    mockedGet.mockResolvedValueOnce({ data: makeResults('aurora') });
    const wrapper = createWrapper();

    const { result } = renderHook(() => useSearch('aurora', 'all'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tracks).toHaveLength(1);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ query: expect.objectContaining({ q: 'aurora', type: 'all' }) }),
    );
  });

  it('stays disabled for an empty query', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useSearch('', 'all'), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('caches by query+type: same key does not refetch, new key does', async () => {
    mockedGet.mockImplementation((path: string, options?: { query?: Record<string, unknown> }) =>
      Promise.resolve({ data: makeResults(String(options?.query?.q ?? path)) }),
    );
    const wrapper = createWrapper();

    // First fetch populates the ['search', 'aurora', 'all'] cache.
    const first = renderHook(() => useSearch('aurora', 'all'), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    // Same key within staleTime → served from cache, no new request.
    const second = renderHook(() => useSearch('aurora', 'all'), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    // Different type → new key → refetch.
    const third = renderHook(() => useSearch('aurora', 'track'), { wrapper });
    await waitFor(() => expect(third.result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('keeps previous results while a new query loads (no flicker)', async () => {
    let resolveSecond: ((value: { data: SearchResultsDto }) => void) | undefined;
    mockedGet.mockResolvedValueOnce({ data: makeResults('aur') }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const wrapper = createWrapper();

    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q, 'all'), {
      wrapper,
      initialProps: { q: 'aur' },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ q: 'aurora' });
    // While the new request is in flight, previous data is still shown.
    expect(result.current.data?.query).toBe('aur');
    expect(result.current.isPlaceholderData).toBe(true);

    resolveSecond?.({ data: makeResults('aurora') });
    await waitFor(() => expect(result.current.data?.query).toBe('aurora'));
  });
});
