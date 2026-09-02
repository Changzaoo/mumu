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
    // A faixa pode aparecer em mais de uma prateleira — o que importa é existir
    // pelo menos uma.
    expect(screen.getAllByText('Como Tudo Deve Ser').length).toBeGreaterThan(0);
    expect(screen.getByText('Seus artistas')).toBeInTheDocument();
    expect(screen.getAllByText('Charlie Brown Jr.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sua biblioteca está vazia')).not.toBeInTheDocument();
  });

  /**
   * A HOME ABRE NO QUE A PESSOA OUVE — não no que chegou por último.
   *
   * Este é o pedido, em teste: quem ouve gospel abre o app em gospel, mesmo com
   * uma biblioteca em que o rock é MAIOR. Sem isto, a ordem volta a ser a do
   * acervo (tamanho) ou a do relógio (data de importação), que é de onde veio a
   * reclamação.
   */
  it(
    'abre no gênero que a pessoa mais ouve, e não no maior da biblioteca',
    { timeout: 60_000 },
    async () => {
      const faixa = (id: string, genero: string, titulo: string) => ({
        track: {
          ...makeTrack(id, { title: titulo }),
          genre: genero,
          artists: [{ id: `a:${genero}`, name: `Cantor de ${genero}`, slug: '', imageUrl: null }],
        },
        addedAt: new Date().toISOString(),
        sizeBytes: 1,
        mimeType: 'audio/mpeg',
      });

      // Rock é o gênero MAIOR do acervo; gospel é o que ela ouve. Metade do
      // gospel fica sem play, para o ramo "para descobrir" ter material.
      const biblioteca = [
        ...Array.from({ length: 16 }, (_, i) => faixa(`r${i}`, 'Rock', `Rock ${i}`)),
        ...Array.from({ length: 12 }, (_, i) => faixa(`g${i}`, 'Gospel', `Gospel ${i}`)),
      ];
      window.localStorage.setItem('aurial:library', JSON.stringify(biblioteca));
      window.localStorage.setItem(
        'aurial:local-history',
        JSON.stringify(
          Array.from({ length: 6 }, (_, i) => ({
            id: `h${i}`,
            playedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
            playedMs: 200_000,
            source: 'queue',
            track: biblioteca[16 + i]!.track,
          })),
        ),
      );

      await renderHome();

      const gospel = await screen.findByText('Gospel');
      const rock = screen.getByText('Rock');
      // `compareDocumentPosition` responde a única pergunta que importa aqui:
      // quem vem ANTES na página. Contar prateleiras não responderia.
      expect(gospel.compareDocumentPosition(rock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // E as ramificações do gospel ficam entre um e outro.
      const ramo = screen.getByText('Gospel para descobrir');
      expect(gospel.compareDocumentPosition(ramo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ramo.compareDocumentPosition(rock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it('não mostra mais "Adicionadas recentemente"', { timeout: 60_000 }, async () => {
    const entry = {
      track: makeTrack('local:1', { title: 'Recém-chegada' }),
      addedAt: new Date().toISOString(),
      sizeBytes: 1,
      mimeType: 'audio/mpeg',
    };
    window.localStorage.setItem('aurial:library', JSON.stringify([entry]));

    await renderHome();

    expect(screen.queryByText('Adicionadas recentemente')).not.toBeInTheDocument();
  });
});
