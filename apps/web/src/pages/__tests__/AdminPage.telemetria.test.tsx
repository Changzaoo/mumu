/**
 * A TELEMETRIA MORA NA ADMINISTRAÇÃO (pedido do dono, 29/10/2026): /admin/telemetria
 * abre a aba com a telemetria embutida (sem o cabeçalho próprio), e o acesso
 * segue o mesmo critério das outras telas restritas (useIsAuthorized).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

let autorizado = true;
vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ loading: false, user: null, profile: null }),
}));
vi.mock('@/lib/auth/roles', () => ({ useIsAuthorized: () => autorizado }));
vi.mock('../TelemetryPage', () => ({
  default: ({ embutida }: { embutida?: boolean }) => (
    <p>telemetria {embutida ? 'embutida' : 'solta'}</p>
  ),
}));

import AdminPage from '../AdminPage';

function abrir(rota: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[rota]}>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Administração com a telemetria', () => {
  it('/admin/telemetria abre a aba com a telemetria embutida', async () => {
    autorizado = true;
    abrir('/admin/telemetria');
    expect(await screen.findByText('telemetria embutida')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Telemetria' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('sem acesso: área restrita', () => {
    autorizado = false;
    abrir('/admin/telemetria');
    expect(screen.getByText('Área restrita')).toBeInTheDocument();
  });
});
