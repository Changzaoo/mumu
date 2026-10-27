import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgendaDoArtista as Agenda } from '@/lib/mundo/mundo';

const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));

const faixa = vi.hoisted(() => ({ atual: 'adulto' as 'adulto' | 'adolescente' | 'crianca' }));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({
  faixaEtariaAtual: () => faixa.atual,
  podeOuvir: () => true,
  assinar: () => () => undefined,
  versaoDoFiltro: () => 'v',
}));
vi.mock('@/lib/local/localLibrary', () => ({ artistTracks: () => [] }));

const agenda = vi.hoisted<{ dados: Agenda | null }>(() => ({ dados: null }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({ data: agenda.dados })) },
}));

const { AgendaDoArtista } = await import('@/components/media/AgendaDoArtista');

const daquiA = (dias: number): string => new Date(Date.now() + dias * 86_400_000).toISOString();

function montar(ligado = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgendaDoArtista artista="Snoop Dogg" ligado={ligado} />
    </QueryClientProvider>,
  );
}

const base: Agenda = {
  artista: 'Snoop Dogg',
  atualizadoEm: new Date().toISOString(),
  links: {},
  eventos: [
    {
      id: 'ticketmaster:1',
      tipo: 'SHOW',
      titulo: 'Snoop Dogg em São Paulo',
      descricao: null,
      quando: daquiA(10),
      local: 'Espaço Unimed · São Paulo',
      cidade: 'São Paulo',
      pais: 'BR',
      preco: 'R$120 – R$480',
      linkIngresso: 'https://ingressos.test/1',
      link: 'https://ingressos.test/1',
      youtubeId: null,
      embed: false,
      fonte: 'ticketmaster',
    },
    {
      id: 'youtube:abc',
      tipo: 'TRANSMISSAO',
      titulo: 'Show completo ao vivo',
      descricao: 'Gravação publicada no canal oficial',
      quando: daquiA(-3),
      local: null,
      cidade: null,
      pais: null,
      preco: null,
      linkIngresso: null,
      link: 'https://www.youtube.com/watch?v=abcdefghijk',
      youtubeId: 'abcdefghijk',
      embed: true,
      fonte: 'youtube',
    },
    {
      id: 'wikidata:1',
      tipo: 'PREMIO',
      titulo: 'Grammy Award',
      descricao: 'Vencedor · por "Doggystyle"',
      quando: '2024-02-04T12:00:00.000Z',
      local: null,
      cidade: null,
      pais: null,
      preco: null,
      linkIngresso: null,
      link: 'https://www.wikidata.org/wiki/Q6096',
      youtubeId: null,
      embed: false,
      fonte: 'wikidata',
    },
    {
      id: 'musicbrainz:rg:1',
      tipo: 'LANCAMENTO',
      titulo: 'Missionary',
      descricao: 'Álbum',
      quando: '2024-12-13T12:00:00.000Z',
      local: null,
      cidade: null,
      pais: null,
      preco: null,
      linkIngresso: null,
      link: null,
      youtubeId: null,
      embed: false,
      fonte: 'musicbrainz',
    },
  ],
};

describe('AgendaDoArtista', () => {
  it('mostra show com local, data, preço e ingresso; prêmio e lançamento; conta o clique', async () => {
    faixa.atual = 'adulto';
    agenda.dados = base;
    montar();
    expect(await screen.findByRole('heading', { name: 'Agenda e notícias' })).toBeInTheDocument();
    expect(screen.getByText('Snoop Dogg em São Paulo')).toBeInTheDocument();
    expect(screen.getByText(/Espaço Unimed · São Paulo/)).toBeInTheDocument();
    expect(screen.getByText(/Ingressos R\$120 – R\$480/)).toBeInTheDocument();
    expect(screen.getByText('Grammy Award')).toBeInTheDocument();
    expect(screen.getByText('Missionary')).toBeInTheDocument();

    const ingresso = screen.getByRole('link', { name: 'ingresso: Snoop Dogg' });
    expect(ingresso).toHaveAttribute('href', 'https://ingressos.test/1');
    await userEvent.click(ingresso);
    expect(anotar).toHaveBeenCalledWith(
      'mundo',
      'ingresso',
      expect.objectContaining({ artista: 'Snoop Dogg' }),
    );
  });

  it('adulto: a transmissão abre o embed oficial do YouTube só depois do clique', async () => {
    faixa.atual = 'adulto';
    agenda.dados = base;
    const { container } = montar();
    const botao = await screen.findByRole('button', { name: 'transmissão: Snoop Dogg' });
    expect(container.querySelector('iframe')).toBeNull();
    await userEvent.click(botao);
    const iframe = container.querySelector('iframe');
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringContaining('https://www.youtube.com/embed/abcdefghijk'),
    );
  });

  it('menor de idade: nada de iframe — só o link para o YouTube', async () => {
    faixa.atual = 'adolescente';
    agenda.dados = base;
    const { container } = montar();
    const link = await screen.findByRole('link', { name: 'transmissão: Snoop Dogg' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
    expect(screen.queryByRole('button', { name: 'transmissão: Snoop Dogg' })).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('sem eventos (ou desligada) a seção não aparece', async () => {
    agenda.dados = { ...base, eventos: [] };
    montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: 'Agenda e notícias' })).toBeNull();
  });
});
