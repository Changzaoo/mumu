import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackDto } from '@radinho/shared';
import type { CreditosDaFaixa as Ficha } from '@/lib/mundo/creditos';

vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));
const navegador = vi.hoisted(() => ({ chamado: 0 }));
vi.mock('@/lib/credits/credits', () => ({
  fetchCredits: vi.fn(async () => {
    navegador.chamado += 1;
    return {
      performers: [],
      composers: ['Do Navegador'],
      lyricists: [],
      producers: [],
      source: 'MusicBrainz',
    };
  }),
}));
// O acervo do aparelho tem "Wiu" como artista: o crédito dele vai para a ficha
// de artista, não para /pessoa.
vi.mock('@/lib/local/localLibrary', () => ({
  list: () => [{ track: { id: 't1', title: 'x', artists: [{ name: 'Wiu' }] } }],
}));

const servidor = vi.hoisted<{ ficha: Ficha | null }>(() => ({ ficha: null }));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async () => {
      if (!servidor.ficha) throw new Error('404');
      return { data: servidor.ficha };
    }),
  },
}));

const { CreditosDaFaixa } = await import('@/components/media/CreditosDaFaixa');

const track = {
  id: 'local:1',
  title: 'Mantém',
  artists: [{ name: 'Matuê' }],
  composer: null,
} as unknown as TrackDto;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreditosDaFaixa track={track} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreditosDaFaixa', () => {
  it('do servidor: agrupa por papel; produtor que é artista do acervo leva à ficha dele, selo à gravadora', async () => {
    servidor.ficha = {
      trackId: 'local:1',
      lidoEm: '2026-10-27T00:00:00Z',
      identificada: true,
      creditos: [
        { papel: 'PRODUTOR', nome: 'Wiu', chave: 'wiu', fonte: 'musicbrainz', dados: null },
        {
          papel: 'PRODUTOR',
          nome: 'Pedro Lotto',
          chave: 'pedrolotto',
          fonte: 'discogs',
          dados: null,
        },
        {
          papel: 'GRAVADORA',
          nome: '30PRAUM',
          chave: '30praum',
          fonte: 'musicbrainz',
          dados: null,
        },
      ],
    };
    montar();
    expect(await screen.findByText(/Produção:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'crédito: Wiu' })).toHaveAttribute(
      'href',
      '/artista/Wiu',
    );
    expect(screen.getByRole('link', { name: 'crédito: Pedro Lotto' })).toHaveAttribute(
      'href',
      '/pessoa/pedrolotto',
    );
    expect(screen.getByRole('link', { name: 'crédito: 30PRAUM' })).toHaveAttribute(
      'href',
      '/gravadora/30PRAUM',
    );
    expect(navegador.chamado).toBe(0);
  });

  it('sem ficha no servidor ainda, a busca do navegador quebra o galho', async () => {
    servidor.ficha = null;
    montar();
    expect(await screen.findByText(/Composição:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'crédito: Do Navegador' })).toBeInTheDocument();
    expect(navegador.chamado).toBe(1);
  });
});
