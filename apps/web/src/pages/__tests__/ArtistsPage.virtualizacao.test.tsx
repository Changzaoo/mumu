/**
 * /artistas É UMA GRADE VIRTUALIZADA (por linha).
 *
 * Com milhares de artistas eram 19,2 mil nós e 2.777 pedidos de foto — cada
 * cartão busca a foto do seu artista ao montar. Agora só as linhas visíveis
 * existem, então só elas pedem foto. A ordem (mais faixas primeiro) e as
 * colunas por largura (3 no celular) são preservadas.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { telaDoMotoG34 } from '@/test/telaVirtual';

const TOTAL = 5000;

const fixtures = vi.hoisted(() => ({
  artistas: [] as unknown[],
  vazio: [] as unknown[],
  fotos: [] as string[],
}));

vi.mock('@/lib/local/localLibrary', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  subscribe: () => () => {},
  list: () => fixtures.vazio,
  artists: () => fixtures.artistas,
}));
// Conta quantos cartões chegaram a PEDIR foto (o que dispara a requisição).
vi.mock('@/lib/artistImage', () => ({
  useArtistImage: (nome: string) => {
    fixtures.fotos.push(nome);
    return null;
  },
}));

// jsdom não tem layout: sem isto a área rolável mede 0 e nenhuma linha monta.
beforeAll(() => telaDoMotoG34());

describe('ArtistsPage virtualizada', () => {
  it('com 5.000 artistas monta só as linhas da tela e só elas pedem foto', async () => {
    fixtures.artistas = Array.from({ length: TOTAL }, (_, i) => ({
      name: `Artista ${i}`,
      coverUrl: null,
      trackCount: TOTAL - i,
    }));

    const { default: Page } = await import('@/pages/ArtistsPage');
    const { container } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    const linhas = container.querySelectorAll('[data-index]');
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.length).toBeLessThanOrEqual(24);

    // Cartões montados = linhas × 3 colunas (largura de celular): poucas dezenas.
    const cartoes = container.querySelectorAll('[data-giro="item"]');
    expect(cartoes.length).toBe(linhas.length * 3);
    expect(cartoes.length).toBeLessThan(80);
    expect(container.querySelectorAll('*').length).toBeLessThan(3000);
    expect(new Set(fixtures.fotos).size).toBeLessThan(80);

    // Ordem preservada: primeira linha = os 3 primeiros; o último não existe.
    expect(screen.getByText('Artista 0')).toBeInTheDocument();
    expect(screen.getByText('Artista 2')).toBeInTheDocument();
    expect(screen.queryByText('Artista 4999')).not.toBeInTheDocument();
  });
});
