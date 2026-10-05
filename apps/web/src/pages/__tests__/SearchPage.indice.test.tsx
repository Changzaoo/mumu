/**
 * O ÍNDICE DE ARTISTAS E ÁLBUNS É CONSTRUÍDO UMA VEZ, NÃO A CADA TECLA.
 *
 * Antes, cada tecla normalizava (NFD + regex) todos os artistas e álbuns do
 * acervo: ~190 ms de `norm` em 14 teclas num celular de entrada. As faixas já
 * eram indexadas uma vez; artistas e álbuns agora também. A prova: contamos as
 * chamadas de `String.prototype.normalize` (a parte cara do `norm`) — digitar
 * mais teclas NÃO pode custar uma normalização por artista/álbum.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
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
vi.mock('@/features/search/MaisMusicas', () => ({ MaisMusicas: () => null }));
vi.mock('@/features/library/api', () => ({
  useTrackLikes: () => ({ isLiked: () => false, toggle: vi.fn() }),
}));
vi.mock('@/lib/search/lyricsSearch', () => ({
  searchByLyrics: vi.fn(async () => []),
  indexLyricsInBackground: vi.fn(async () => undefined),
}));

const TOTAL = 2000;

/** Faz o papel do campo da TopBar: troca o `?q=` da URL a cada "tecla". */
function Campo() {
  const [, setParams] = useSearchParams();
  return (
    <input
      aria-label="campo"
      onChange={(e) => setParams({ q: e.target.value }, { replace: true })}
    />
  );
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

describe('SearchPage: índice de artistas e álbuns', () => {
  it(
    'normaliza o acervo uma vez; cada tecla nova só normaliza a consulta',
    { timeout: 120_000 },
    async () => {
      window.localStorage.setItem(
        'aurial:library',
        JSON.stringify(
          Array.from({ length: TOTAL }, (_, i) =>
            entrada(
              makeTrack(`c:${i}`, {
                title: `Canção ${i}`,
                artists: [{ id: `a${i}`, name: `Cantor ${i}`, slug: '', imageUrl: null }],
                album: { id: `al${i}`, title: `Disco ${i}`, slug: '', coverUrl: null },
              }),
            ),
          ),
        ),
      );
      const { default: SearchPage } = await import('@/pages/SearchPage');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/search']}>
            <Campo />
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      );
      render(<SearchPage />, { wrapper });

      const normalizar = vi.spyOn(String.prototype, 'normalize');
      const campo = screen.getByLabelText('campo');
      const digitar = async (texto: string): Promise<void> => {
        await act(async () => {
          fireEvent.change(campo, { target: { value: texto } });
        });
      };

      // 1ª tecla: aqui nasce o índice (faixas + artistas + álbuns).
      await digitar('c');
      const naPrimeira = normalizar.mock.calls.length;
      // Faixas (título + artista) + artistas + álbuns (título + artista).
      expect(naPrimeira).toBeGreaterThanOrEqual(TOTAL * 3);

      // Mais 6 teclas: o acervo NÃO é normalizado de novo.
      normalizar.mockClear();
      for (const texto of ['ca', 'can', 'canç', 'canço', 'cantor', 'cantor 1']) {
        await digitar(texto);
      }
      const nasSeguintes = normalizar.mock.calls.length;
      // Só a consulta e os poucos resultados do "melhor resultado": dezenas,
      // nunca milhares (o código antigo gastava >= 2 × TOTAL por tecla).
      expect(nasSeguintes).toBeLessThan(6 * 100);
      normalizar.mockRestore();

      // E a busca segue achando: artista e álbum aparecem nos resultados.
      expect(screen.getAllByText(/Cantor 1/).length).toBeGreaterThan(0);
    },
  );
});
