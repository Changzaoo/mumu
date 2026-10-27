import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AvisoDoMundo as Aviso } from '@/lib/mundo/mundo';

vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({
  faixaEtariaAtual: () => 'adulto',
  podeOuvir: () => true,
  assinar: () => () => undefined,
  versaoDoFiltro: () => 'v',
}));
vi.mock('@/lib/local/localLibrary', () => ({ artistTracks: () => [] }));

const seguidos = vi.hoisted(() => ({
  lista: [] as Array<{ nome: string; capaUrl: null; seguidoEm: string }>,
}));
vi.mock('@/lib/local/artistasSeguidos', () => ({
  subscribe: () => () => undefined,
  list: () => seguidos.lista,
}));

const pedidos = vi.hoisted(() => ({ query: null as unknown, avisos: [] as Aviso[] }));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async (_p: string, o: { query?: unknown }) => {
      pedidos.query = o.query;
      return { data: pedidos.avisos };
    }),
  },
}));

const { AvisoDoMundo } = await import('@/components/media/AvisoDoMundo');

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AvisoDoMundo />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AvisoDoMundo', () => {
  it('sem seguidos não pergunta nada nem aparece', async () => {
    seguidos.lista = [];
    montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(pedidos.query).toBeNull();
    expect(screen.queryByText(/Novidades/)).toBeNull();
  });

  it('pergunta pelos seguidos e mostra show com ingresso e prêmio com link para a ficha', async () => {
    seguidos.lista = [
      { nome: 'Snoop Dogg', capaUrl: null, seguidoEm: '2026-10-01' },
      { nome: 'Earth, Wind & Fire', capaUrl: null, seguidoEm: '2026-10-02' },
    ];
    pedidos.avisos = [
      {
        id: 'ticketmaster:1',
        chave: 'snoopdogg',
        artista: 'Snoop Dogg',
        tipo: 'SHOW',
        titulo: 'Show',
        descricao: null,
        quando: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        local: 'Espaço Unimed · São Paulo',
        cidade: 'São Paulo',
        pais: 'BR',
        preco: 'R$120',
        linkIngresso: 'https://ingressos.test/1',
        link: null,
        youtubeId: null,
        embed: false,
        fonte: 'ticketmaster',
      },
      {
        id: 'wikidata:2',
        chave: 'earthwindfire',
        artista: 'Earth, Wind & Fire',
        tipo: 'PREMIO',
        titulo: 'Grammy Lifetime Achievement Award',
        descricao: 'Vencedor',
        quando: new Date().toISOString(),
        local: null,
        cidade: null,
        pais: null,
        preco: null,
        linkIngresso: null,
        link: null,
        youtubeId: null,
        embed: false,
        fonte: 'wikidata',
      },
    ];
    montar();
    expect(
      await screen.findByRole('heading', { name: 'Novidades de quem você segue' }),
    ).toBeInTheDocument();
    // Vírgula faz parte do nome do grupo: os nomes viajam separados por "|".
    expect(pedidos.query).toEqual({ artistas: 'Snoop Dogg|Earth, Wind & Fire' });
    expect(screen.getByRole('link', { name: 'aviso ingresso: Snoop Dogg' })).toHaveAttribute(
      'href',
      'https://ingressos.test/1',
    );
    expect(screen.getByText(/toca em Espaço Unimed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'aviso: Earth, Wind & Fire' })).toHaveAttribute(
      'href',
      '/artista/Earth%2C%20Wind%20%26%20Fire',
    );
    expect(screen.getByText(/ganhou o Grammy Lifetime Achievement Award/)).toBeInTheDocument();
  });
});
