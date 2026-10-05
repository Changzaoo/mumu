/**
 * /compartilhar É VIRTUALIZADA.
 *
 * Com a biblioteca do par e a sua, cada uma com milhares de faixas, a página
 * montava 51,6 mil nós de DOM (TBT de 5 a 6 s num Moto G34 emulado). Agora as
 * duas listas usam o `VirtualList`: só as linhas da tela existem. A ação da
 * linha ("Receber") continua funcionando e a ordem é a original.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';
import { telaDoMotoG34 } from '@/test/telaVirtual';

const TOTAL = 5000;

const fixtures = vi.hoisted(() => ({
  requestTrack: vi.fn(),
  entradas: [] as unknown[],
  estado: {} as Record<string, unknown>,
}));

vi.mock('@/lib/local/localLibrary', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  subscribe: () => () => {},
  list: () => fixtures.entradas,
}));
vi.mock('@/stores/p2pStore', () => ({
  useP2PStore: (selector: (s: unknown) => unknown) => selector(fixtures.estado),
}));

// jsdom não tem layout: sem isto a área rolável mede 0 e nenhuma linha monta.
beforeAll(() => telaDoMotoG34());

describe('SharePage virtualizada', () => {
  it('com 5.000 faixas do par e 5.000 suas, monta só uma janela de cada lista', async () => {
    fixtures.entradas = Array.from({ length: TOTAL }, (_, i) => ({
      track: makeTrack(`l:${i}`, { title: `Minha ${i}` }),
      addedAt: '2026-01-01T00:00:00.000Z',
      sizeBytes: 1_000_000,
      mimeType: 'audio/mpeg',
    }));
    fixtures.estado = {
      status: 'connected',
      room: 'ABC123',
      peers: [{ id: 'p1', name: 'Ana' }],
      manifests: {
        p1: Array.from({ length: TOTAL }, (_, i) => ({
          id: `r:${i}`,
          title: `Dela ${i}`,
          artist: 'Ana',
          sizeBytes: 2_000_000,
        })),
      },
      transfers: {},
      connect: vi.fn(),
      disconnect: vi.fn(),
      requestTrack: fixtures.requestTrack,
    };

    const { default: Page } = await import('@/pages/SharePage');
    const { container } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    // O total real aparece no cabeçalho, não o da janela.
    expect(screen.getByText(/5000 faixas/)).toBeInTheDocument();

    const linhas = container.querySelectorAll('[data-index]');
    expect(linhas.length).toBeGreaterThan(0);
    // Duas listas, cada uma com janela + folga: nunca as 10.000 linhas.
    expect(linhas.length).toBeLessThanOrEqual(60);
    expect(container.querySelectorAll('*').length).toBeLessThan(3000);

    // Ordem preservada e fim da lista ausente.
    expect(screen.getByText('Dela 0')).toBeInTheDocument();
    expect(screen.queryByText('Dela 4999')).not.toBeInTheDocument();

    // A ação da linha segue ligada ao par e à faixa certos.
    fireEvent.click(screen.getAllByRole('button', { name: /Receber/ })[0]!);
    expect(fixtures.requestTrack).toHaveBeenCalledWith('p1', 'r:0');
  });
});
