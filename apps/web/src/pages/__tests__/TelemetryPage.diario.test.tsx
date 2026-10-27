/**
 * O DIÁRIO DE BORDO NO PAINEL — a linha que o médico curou fica VERDE, com o
 * selo "curada", e sai da conta de sintomas em aberto; a que segue em aberto
 * continua vermelha.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/firebase', () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  auth: { currentUser: null },
}));
vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));

import { DiarioDeBordo } from '@/pages/TelemetryPage';
import type { Linha } from '@/lib/telemetry/diario';

const linhas: Linha[] = [
  {
    em: '11:32:02',
    ms: 1_000,
    c: 'rede',
    e: 'falhou',
    d: 'GET importer.radinho.online/letra/outras-fontes Failed to fetch',
    n: 8,
    ok: true,
  },
  { em: '11:32:05', ms: 4_000, c: 'rede', e: 'http', d: '429 GET lrclib.net/api/search', ok: true },
  { em: '11:32:40', ms: 39_000, c: 'medico', e: 'curou', d: 'importador voltou depois de 38s' },
  { em: '11:33:10', ms: 69_000, c: 'audio', e: 'silencio', d: 'No Mercy em 12s' },
];

describe('o diário de bordo do painel', () => {
  it('mostra curadas em verde com selo, e o que segue aberto em vermelho', () => {
    render(
      <DiarioDeBordo
        diario={{
          linhas,
          resumo: { sintomas: 1, curados: 9, porSintoma: { silencio: 1 }, abertaHaS: 70 },
        }}
      />,
    );
    expect(screen.getByText(/1 sintoma\(s\) em aberto/)).toBeInTheDocument();
    expect(screen.getByText(/9 curado\(s\) pelo médico/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ver sequência/ }));

    const selos = screen.getAllByText('✓ curada');
    expect(selos).toHaveLength(2);
    const curada = screen.getByTitle(/outras-fontes/).closest('li');
    expect(curada?.className).toContain('bg-success/8');
    expect(curada?.className).not.toContain('bg-danger');

    const alta = screen.getByTitle(/importador voltou/).closest('li');
    expect(alta?.className).toContain('bg-success/8');

    const aberta = screen.getByTitle(/No Mercy/).closest('li');
    expect(aberta?.className).toContain('bg-danger/8');
  });

  it('sem sintoma em aberto e com curados, o resumo fica verde', () => {
    render(
      <DiarioDeBordo
        diario={{
          linhas: linhas.slice(0, 3),
          resumo: { sintomas: 0, curados: 9, porSintoma: {}, abertaHaS: 70 },
        }}
      />,
    );
    const resumo = screen.getByText(/Nenhum sintoma em aberto · 9 curado\(s\) pelo médico/);
    expect(resumo.parentElement?.className).toContain('bg-success/10');
  });
});
