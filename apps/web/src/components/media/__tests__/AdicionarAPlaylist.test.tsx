/**
 * "ADICIONAR À PLAYLIST" DE QUALQUER LUGAR.
 *
 * O item existia no menu das faixas, mas nenhuma tela o ligava — montar uma
 * lista exigia abrir a lista e procurar música por música. Estes testes travam
 * o seletor global: escolher uma lista, ver quais já têm a música, criar uma
 * lista nova já com ela dentro, e recusar com aviso a faixa de fora.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/local/importerHelper', () => ({ uploadTrackBlob: vi.fn(async () => null) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import {
  AdicionarAPlaylistHost,
  abrirAdicionarAPlaylist,
} from '@/components/media/AdicionarAPlaylist';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { makeTrack } from '@/test/factories';

function montar(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdicionarAPlaylistHost />
    </QueryClientProvider>,
  );
}

describe('seletor "Adicionar à playlist"', () => {
  beforeEach(() => {
    for (const p of localPlaylists.list()) localPlaylists.remove(p.id);
    vi.clearAllMocks();
  });

  it('adiciona a música à lista escolhida', async () => {
    const lista = localPlaylists.create('Treino');
    montar();
    act(() => abrirAdicionarAPlaylist(makeTrack('local:a')));

    await userEvent.click(await screen.findByRole('button', { name: /Treino/ }));

    expect(localPlaylists.get(lista.id)?.trackIds).toEqual(['local:a']);
    expect(toast.success).toHaveBeenCalledWith('Adicionada a "Treino"');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marca a lista que já tem a música e não duplica', async () => {
    const lista = localPlaylists.create('Favoritas', [makeTrack('local:a')]);
    montar();
    act(() => abrirAdicionarAPlaylist(makeTrack('local:a')));

    expect(await screen.findByLabelText('Já está nesta')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Favoritas/ }));

    expect(localPlaylists.get(lista.id)?.trackIds).toEqual(['local:a']);
    expect(toast).toHaveBeenCalledWith('Já estava em "Favoritas"');
  });

  it('cria uma lista nova já com a música dentro', async () => {
    montar();
    act(() => abrirAdicionarAPlaylist(makeTrack('local:b')));

    await userEvent.click(await screen.findByRole('button', { name: /Nova playlist/ }));
    await userEvent.type(screen.getByLabelText('Nome da nova playlist'), 'Viagem');
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const nova = localPlaylists.list().find((p) => p.title === 'Viagem');
    expect(nova?.trackIds).toEqual(['local:b']);
  });

  it('faixa de fora da biblioteca: avisa em vez de fingir que salvou', async () => {
    localPlaylists.create('Treino');
    montar();
    act(() => abrirAdicionarAPlaylist(makeTrack('audius:123')));

    expect(await screen.findByText(/de fora da sua biblioteca/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Treino/ })).toBeNull();
  });
});
