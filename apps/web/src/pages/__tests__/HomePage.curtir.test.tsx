import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
vi.mock('@/components/media/CommunityTracksRow', () => ({ CommunityTracksRow: () => null }));
vi.mock('@/components/media/DeviceTracksRow', () => ({ DeviceTracksRow: () => null }));
vi.mock('@/lib/artistImage', () => ({ useArtistImage: () => null }));

/**
 * O título da Home é filho DIRETO de `HomePage` e não tem estado próprio: cada
 * render dele é um render da página. É o contador de renders da Home.
 */
const renders = vi.hoisted(() => ({ home: 0 }));
vi.mock('framer-motion', async (importOriginal) => {
  const real = await importOriginal<typeof import('framer-motion')>();
  const Contador = ({ children, className }: { children?: ReactNode; className?: string }) => {
    renders.home += 1;
    return <h1 className={className}>{children}</h1>;
  };
  return {
    ...real,
    motion: new Proxy(real.motion, {
      get: (alvo, chave) => (chave === 'h1' ? Contador : Reflect.get(alvo, chave)),
    }),
  };
});

import { makeTrack } from '@/test/factories';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window.localStorage.clear();
  renders.home = 0;
});

describe('HomePage — curtir não redesenha a página', () => {
  it(
    'curtir atualiza o atalho "Músicas Curtidas" sem re-renderizar a Home nem remontar prateleiras',
    { timeout: 60_000 },
    async () => {
      const biblioteca = Array.from({ length: 6 }, (_, i) => ({
        track: {
          ...makeTrack(`local:${i}`, { title: `Faixa ${i}` }),
          genre: 'Rock',
          artists: [{ id: 'a1', name: 'Banda', slug: '', imageUrl: null }],
        },
        addedAt: new Date().toISOString(),
        sizeBytes: 1,
        mimeType: 'audio/mpeg',
      }));
      window.localStorage.setItem('aurial:library', JSON.stringify(biblioteca));

      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      const localLikes = await import('@/lib/local/localLikes');
      localLibrary.marcarAssentada();
      // `albumGroups` só é chamado por `montarHome`: contar chamadas é contar
      // quantas vezes a Home recalculou as prateleiras.
      const albumGroups = vi.spyOn(localLibrary, 'albumGroups');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(await screen.findByText('0 músicas')).toBeInTheDocument();
      // Deixa assentar o que a Home faz sozinha depois da primeira foto.
      // As prateleiras tardias entram em momento ocioso, que numa máquina
      // carregada demora: espera a contagem de renders parar de mexer.
      for (let parado = 0, visto = -1; parado < 3;) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 300));
        });
        parado = renders.home === visto ? parado + 1 : 0;
        visto = renders.home;
      }
      const rendersAntes = renders.home;
      const montagensAntes = albumGroups.mock.calls.length;
      expect(montagensAntes).toBeGreaterThan(0);

      act(() => localLikes.add(biblioteca[0]!.track));

      // O atalho reage...
      expect(await screen.findByText('1 música')).toBeInTheDocument();
      // ...e a Home inteira, não.
      expect(renders.home).toBe(rendersAntes);
      expect(albumGroups.mock.calls.length).toBe(montagensAntes);
    },
  );
});
