/**
 * Search feature — API hooks + recent-searches persistence.
 *
 * `useSearch` keeps previous results while typing (no flicker) and
 * `useSuggest` powers lightweight autocomplete. The query string should be
 * debounced by the caller (SearchPage debounces 300ms).
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { SearchResultsDto, SearchType, SuggestionDto } from '@aurial/shared';
import { api } from '@/lib/api';

export function useSearch(q: string, type: SearchType = 'all'): UseQueryResult<SearchResultsDto> {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', query, type],
    enabled: query.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      (
        await api.get<SearchResultsDto>('/search', {
          query: { q: query, type, limit: 20 },
          signal,
        })
      ).data,
  });
}

export function useSuggest(q: string): UseQueryResult<SuggestionDto[]> {
  const query = q.trim();
  return useQuery({
    queryKey: ['search-suggest', query],
    enabled: query.length > 1,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      (await api.get<SuggestionDto[]>('/search/suggest', { query: { q: query }, signal })).data,
  });
}

// ── Recent searches (localStorage) ──────────────────────────────

const RECENT_KEY = 'aurial:recent-searches';
const RECENT_MAX = 10;

let recentCache: string[] | null = null;
const recentListeners = new Set<() => void>();

function readRecent(): string[] {
  if (recentCache) return recentCache;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    recentCache = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    recentCache = [];
  }
  return recentCache;
}

function writeRecent(items: string[]): void {
  recentCache = items;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    // Private mode — keep in memory only.
  }
  for (const notify of recentListeners) notify();
}

function subscribeRecent(listener: () => void): () => void {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
}

export interface RecentSearches {
  recent: string[];
  addRecent: (term: string) => void;
  removeRecent: (term: string) => void;
  clearRecent: () => void;
}

export function useRecentSearches(): RecentSearches {
  const recent = useSyncExternalStore(subscribeRecent, readRecent, () => []);

  const addRecent = useCallback((term: string) => {
    const value = term.trim();
    if (!value) return;
    const next = [value, ...readRecent().filter((t) => t.toLowerCase() !== value.toLowerCase())];
    writeRecent(next.slice(0, RECENT_MAX));
  }, []);

  const removeRecent = useCallback((term: string) => {
    writeRecent(readRecent().filter((t) => t !== term));
  }, []);

  const clearRecent = useCallback(() => writeRecent([]), []);

  return { recent, addRecent, removeRecent, clearRecent };
}
