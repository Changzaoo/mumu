/**
 * O botão "Reportar problema": uma opção, um toque, e o relato sai com a faixa
 * e a posição — e vai para a telemetria na hora.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registrarRelato, enviarRelatosAgora, estado } = vi.hoisted(() => ({
  registrarRelato: vi.fn(),
  enviarRelatosAgora: vi.fn(),
  estado: {
    currentTrack: {
      id: 'local:1',
      title: 'Mantém',
      artists: [{ id: 'a', name: 'Matuê', slug: '', imageUrl: null }],
    },
    progress: 83.4,
  },
}));
vi.mock('@/lib/telemetry/relatos', async (orig) => ({
  ...(await orig<typeof import('@/lib/telemetry/relatos')>()),
  registrarRelato,
}));
vi.mock('@/lib/telemetry/telemetry', () => ({ enviarRelatosAgora }));
vi.mock('@/stores/playerStore', () => {
  const usePlayerStore = (sel: (s: typeof estado) => unknown) => sel(estado);
  usePlayerStore.getState = () => estado;
  return { usePlayerStore };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { ReportarProblema } from '../ReportarProblema';

describe('ReportarProblema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('abre, escolhe "letra fora de sincronia" e envia com a faixa e a posição', () => {
    render(<ReportarProblema />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    expect(screen.getByText('O que aconteceu?')).toBeTruthy();
    const enviar = screen.getByRole('button', { name: 'Enviar relato' });
    expect((enviar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'A letra estava fora de sincronia' }));
    fireEvent.change(screen.getByLabelText('Detalhe (opcional)'), {
      target: { value: 'uns 2 segundos atrasada' },
    });
    fireEvent.click(enviar);
    expect(registrarRelato).toHaveBeenCalledWith({
      tipo: 'letra-fora-de-sincronia',
      trackId: 'local:1',
      titulo: 'Mantém',
      artista: 'Matuê',
      posicaoSeg: 83.4,
      detalhe: 'uns 2 segundos atrasada',
    });
    expect(enviarRelatosAgora).toHaveBeenCalledTimes(1);
  });
});
