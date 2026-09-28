/**
 * O "+" da barra é a porta de entrada principal (qualquer usuário logado, em
 * qualquer aparelho) — por isso ela precisa ENFILEIRAR e devolver a tela na
 * hora, nunca esperar o download/conversão inteiros. Estes testes cobrem essa
 * garantia e a validação síncrona (link mal formado / plataforma sem suporte)
 * que ainda faz sentido travar antes de gastar uma vaga da fila.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const enqueue = vi.fn();
vi.mock('@/lib/local/importQueue', () => ({ enqueue: (...a: unknown[]) => enqueue(...a) }));

const validateImportUrl =
  vi.fn<(url: string) => { ok: true } | { ok: false; message: string }>();
const importFiles = vi.fn();
vi.mock('@/lib/local/localLibrary', () => ({
  validateImportUrl: (url: string) => validateImportUrl(url),
  importFiles: (...a: unknown[]) => importFiles(...a),
}));

vi.mock('@/lib/auth/roles', () => ({ useIsAuthorized: () => false }));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    loading: vi.fn(() => 'id'),
  },
}));

import { AddMusicDialog } from '@/components/media/AddMusicDialog';

function abrir() {
  const onOpenChange = vi.fn();
  render(<AddMusicDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

describe('AddMusicDialog', () => {
  beforeEach(() => {
    enqueue.mockClear();
    validateImportUrl.mockReset().mockReturnValue({ ok: true });
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it('enfileira e fecha na hora — não espera o download terminar', () => {
    const { onOpenChange } = abrir();
    fireEvent.change(screen.getByPlaceholderText('Cole o link aqui'), {
      target: { value: 'https://youtu.be/abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(enqueue).toHaveBeenCalledWith('https://youtu.be/abc', { forcePlaylist: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('link inválido barra ANTES de enfileirar — a fila não é o lugar de aprender isso', () => {
    validateImportUrl.mockReturnValue({
      ok: false,
      message: 'Não dá para importar desse serviço por aqui. Cole o link direto de um arquivo de áudio ou importe o arquivo.',
    });
    abrir();
    fireEvent.change(screen.getByPlaceholderText('Cole o link aqui'), {
      target: { value: 'https://open.spotify.com/track/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(enqueue).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('link ambíguo (watch?v=…&list=…): o botão extra força a playlist inteira', () => {
    abrir();
    fireEvent.change(screen.getByPlaceholderText('Cole o link aqui'), {
      target: { value: 'https://www.youtube.com/watch?v=x&list=PLabc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar a playlist inteira' }));

    expect(enqueue).toHaveBeenCalledWith('https://www.youtube.com/watch?v=x&list=PLabc', {
      forcePlaylist: true,
    });
  });
});
