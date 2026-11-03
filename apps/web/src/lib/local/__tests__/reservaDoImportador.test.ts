/**
 * A RESERVA NA NUVEM só vale enquanto o principal está fora: o disjuntor
 * fechado (principal vivo) sempre devolve o principal, mesmo que alguém tenha
 * deixado uma reserva ativada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abrirCircuito,
  ativarReserva,
  desativarReserva,
  fecharCircuito,
  reservaAtiva,
  zerarSaudeDoImportador,
} from '@/lib/local/saudeDoImportador';

vi.mock('@/lib/firebase', () => ({ getIdToken: () => Promise.resolve(null) }));

describe('reserva do importador', () => {
  beforeEach(() => zerarSaudeDoImportador());

  it('sem circuito aberto não há reserva, mesmo ativada', () => {
    ativarReserva('https://radinho-importador.onrender.com/');
    expect(reservaAtiva()).toBeNull();
  });

  it('com o circuito aberto a reserva vale (sem barra no fim) e helperUrl a devolve', async () => {
    abrirCircuito();
    ativarReserva('https://radinho-importador.onrender.com/');
    expect(reservaAtiva()).toBe('https://radinho-importador.onrender.com');
    const { helperUrl, urlPrimariaDoImportador } = await import('@/lib/local/importerHelper');
    expect(helperUrl()).toBe('https://radinho-importador.onrender.com');
    expect(urlPrimariaDoImportador()).toBe('https://importer.radinho.online');
  });

  it('fechar o circuito (alta do principal) desfaz a reserva; desativar também', async () => {
    abrirCircuito();
    ativarReserva('https://x.onrender.com');
    fecharCircuito();
    expect(reservaAtiva()).toBeNull();
    abrirCircuito();
    expect(reservaAtiva()).toBeNull();
    ativarReserva('https://x.onrender.com');
    desativarReserva();
    expect(reservaAtiva()).toBeNull();
    const { helperUrl } = await import('@/lib/local/importerHelper');
    expect(helperUrl()).toBe('https://importer.radinho.online');
  });
});
