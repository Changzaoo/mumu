import { createContext, useContext } from 'react';

/**
 * The main page scroll container (AppShell's <main>). Consumers: TopBar
 * (sticky glass on scroll) and VirtualList (window-less virtualization).
 */
export const ScrollContainerContext = createContext<HTMLElement | null>(null);

export function useScrollContainer(): HTMLElement | null {
  return useContext(ScrollContainerContext);
}
