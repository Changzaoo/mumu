/**
 * A IDADE VEM DA CONTA GOOGLE: com conta Google o diálogo NÃO pergunta mês e
 * ano — só oferece a leitura da conta. O seletor é a saída de emergência,
 * para quando a conta não informa a data (decisão do dono, 20/10/2026).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerguntaDeIdade } from '../PerguntaDeIdade';

const { estado, tokenGoogleComAniversario, lerNascimentoDoGoogle, aplicarNascimento, settings } =
  vi.hoisted(() => ({
    estado: { user: null as null | { providerData: { providerId: string }[] }, loading: false },
    tokenGoogleComAniversario: vi.fn<() => Promise<string | null>>(),
    lerNascimentoDoGoogle: vi.fn<(t: string) => Promise<string | null>>(),
    aplicarNascimento: vi.fn(() => true),
    settings: { dataNascimento: null as string | null, setDataNascimento: vi.fn() },
  }));
vi.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => estado }));
vi.mock('@/lib/firebase', () => ({ tokenGoogleComAniversario }));
vi.mock('@/lib/auth/nascimentoGoogle', () => ({ lerNascimentoDoGoogle, aplicarNascimento }));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({
  julgarLetrasGuardadas: vi.fn(),
  podeTrocarPara: () => true,
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: typeof settings) => unknown) => sel(settings),
}));

describe('PerguntaDeIdade — a idade vem da conta Google', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.dataNascimento = null;
  });

  it('conta Google: um botão só, sem seletor de mês e ano', () => {
    estado.user = { providerData: [{ providerId: 'google.com' }] };
    render(<PerguntaDeIdade />);
    expect(screen.getByText('Confirme sua idade')).toBeTruthy();
    expect(screen.getByRole('button', { name: /conta Google/ })).toBeTruthy();
    expect(screen.queryByLabelText('Mês de nascimento')).toBeNull();
    expect(screen.queryByLabelText('Ano de nascimento')).toBeNull();
    expect(screen.queryByText('Quando você nasceu?')).toBeNull();
  });

  it('a conta Google sem a data: só então aparece o seletor', async () => {
    estado.user = { providerData: [{ providerId: 'google.com' }] };
    tokenGoogleComAniversario.mockResolvedValue('tok');
    lerNascimentoDoGoogle.mockResolvedValue(null);
    render(<PerguntaDeIdade />);
    fireEvent.click(screen.getByRole('button', { name: /conta Google/ }));
    await waitFor(() => expect(screen.getByLabelText('Mês de nascimento')).toBeTruthy());
    expect(screen.getByText(/não informa o ano de nascimento/)).toBeTruthy();
  });

  it('a conta Google com a data: grava e fecha, sem pedir nada', async () => {
    estado.user = { providerData: [{ providerId: 'google.com' }] };
    tokenGoogleComAniversario.mockResolvedValue('tok');
    lerNascimentoDoGoogle.mockResolvedValue('1999-05');
    render(<PerguntaDeIdade />);
    fireEvent.click(screen.getByRole('button', { name: /conta Google/ }));
    await waitFor(() => expect(aplicarNascimento).toHaveBeenCalledWith('1999-05'));
    await waitFor(() => expect(screen.queryByText('Confirme sua idade')).toBeNull());
  });

  it('sem conta Google (e-mail): a pergunta manual continua', () => {
    estado.user = { providerData: [{ providerId: 'password' }] };
    render(<PerguntaDeIdade />);
    expect(screen.getByText('Quando você nasceu?')).toBeTruthy();
    expect(screen.getByLabelText('Mês de nascimento')).toBeTruthy();
  });
});
