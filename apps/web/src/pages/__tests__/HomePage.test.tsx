import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HomeDto } from '@aurial/shared';

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
  },
  AudioEngine: class {},
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code = 'UNKNOWN', message = 'erro', status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));

import { api } from '@/lib/api';
import HomePage from '@/pages/HomePage';
import { makeTrack } from '@/test/factories';

const mockedGet = vi.mocked(api.get);

const home: HomeDto = {
  greeting: 'Boa noite, tester',
  continueListening: [
    {
      track: makeTrack('resume-1', { title: 'Faixa retomável' }),
      positionMs: 60_000,
      contextTitle: 'Álbum de teste',
      contextUrl: null,
    },
  ],
  sections: [
    {
      id: 'recommended',
      title: 'Recomendadas para você',
      subtitle: null,
      layout: 'carousel',
      items: [{ kind: 'track', item: makeTrack('rec-1', { title: 'Recomendada um' }) }],
    },
    {
      id: 'grid-section',
      title: 'Em alta',
      subtitle: null,
      layout: 'grid',
      items: [{ kind: 'track', item: makeTrack('hot-1', { title: 'Quente um' }) }],
    },
  ],
};

function renderHome(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<HomePage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HomePage', () => {
  it('shows the skeleton while loading, then the sections', async () => {
    let resolveHome: ((value: { data: HomeDto }) => void) | undefined;
    mockedGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHome = resolve;
        }),
    );

    renderHome();

    // Loading: layout-matching skeleton (aria-busy), no content yet.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('Boa noite, tester')).not.toBeInTheDocument();

    resolveHome?.({ data: home });

    // Loaded: greeting, continue-listening card and both sections.
    expect(await screen.findByText('Boa noite, tester')).toBeInTheDocument();
    expect(screen.getByText('Continuar ouvindo')).toBeInTheDocument();
    expect(screen.getByText('Faixa retomável')).toBeInTheDocument();
    expect(screen.getByText('Recomendadas para você')).toBeInTheDocument();
    expect(screen.getByText('Em alta')).toBeInTheDocument();
    expect(screen.getByText('Quente um')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/home');
  });
});
