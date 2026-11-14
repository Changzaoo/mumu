import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecentSearches } from '@/features/search/api';

/**
 * Visto no moto g34 (14/11): quem digita devagar deixava "Pedro", "Pedro pedr",
 * "Pedro pedro" nas buscas recentes — a página guarda o termo 2,5 s depois de
 * cada pausa na digitação.
 */
describe('useRecentSearches', () => {
  it('o termo novo engole os pedaços digitados antes dele', () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.clearRecent());
    act(() => result.current.addRecent('Stray'));
    act(() => result.current.addRecent('Pedro'));
    act(() => result.current.addRecent('Pedro pedr'));
    act(() => result.current.addRecent('pedro pedro'));
    expect(result.current.recent).toEqual(['pedro pedro', 'Stray']);
  });

  it('busca mais curta feita depois não apaga a mais longa', () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.clearRecent());
    act(() => result.current.addRecent('Stray kids'));
    act(() => result.current.addRecent('Stray'));
    expect(result.current.recent).toEqual(['Stray', 'Stray kids']);
  });
});
