/**
 * O relatório de sincronia precisa APONTAR a causa, não só listar números.
 *
 * Cada teste aqui é uma das formas de um aparelho ficar para trás — e todas
 * elas produziam exatamente o mesmo sintoma na tela ("faltam músicas") antes
 * deste módulo existir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SyncStatus from '@/lib/sync/syncStatus';

describe('relatório de sincronia', () => {
  let status: typeof SyncStatus;

  beforeEach(async () => {
    vi.resetModules(); // o estado vive no módulo: cada teste começa limpo
    status = await import('@/lib/sync/syncStatus');
  });

  it('sem login, separa a biblioteca pessoal do acervo do app', () => {
    const texto = status.relatorioSyncTexto(12);
    expect(texto).toContain('Ninguém logado');
    // O acervo é o que o visitante TEM para ouvir — não pode ser confundido
    // com a biblioteca pessoal, que essa sim depende de conta.
    expect(texto).toContain('independe de login');
  });

  it('acervo vazio aponta o suspeito nº 1: regras não publicadas', () => {
    status.registrarSnapshot('catalogo', 0, 'servidor');

    const texto = status.relatorioSyncTexto(0);
    expect(texto).toContain('Acervo do app: 0 faixas');
    expect(texto).toContain('regras do Firestore');
  });

  it('acervo que nem chegou aparece com o erro que foi engolido', () => {
    status.registrarErro('catalogo', new Error('Missing or insufficient permissions.'));

    const texto = status.relatorioSyncTexto(0);
    expect(texto).toContain('Acervo do app: não chegou');
    expect(texto).toContain('insufficient permissions');
  });

  it('snapshot que nunca chegou aparece com o erro que foi engolido', () => {
    status.registrarUsuario('library', 'uid-julio');
    status.registrarErro('library', new Error('Missing or insufficient permissions.'));

    const texto = status.relatorioSyncTexto(0);
    expect(texto).toContain('nenhum snapshot chegou');
    expect(texto).toContain('insufficient permissions');
  });

  it('nuvem na frente do aparelho é apontada explicitamente', () => {
    status.registrarUsuario('library', 'uid-julio');
    status.registrarSnapshot('library', 300, 'servidor');

    const texto = status.relatorioSyncTexto(40);
    expect(texto).toContain('A nuvem tem 300 faixas e este aparelho mostra 40');
  });

  it('aparelho em dia não inventa alarme', () => {
    status.registrarUsuario('library', 'uid-julio');
    status.registrarSnapshot('library', 300, 'servidor');
    status.registrarSnapshot('catalogo', 120, 'servidor');

    const texto = status.relatorioSyncTexto(300);
    expect(texto).toContain('✓ Acervo do app: 120 faixas');
    expect(texto).toContain('✓ library: 300 na nuvem');
    expect(texto).not.toContain('⚠');
    expect(texto).not.toContain('✗');
  });

  it('cota do navegador estourada avisa que a biblioteca não sobrevive à recarga', () => {
    status.registrarUsuario('library', 'uid-julio');
    status.registrarSnapshot('library', 300, 'servidor');
    status.registrarFalhaDePersistencia(new Error('QuotaExceededError'));

    const texto = status.relatorioSyncTexto(300);
    expect(texto).toContain('perde a biblioteca a cada recarga');
    expect(texto).toContain('QuotaExceededError');
  });

  it('distingue snapshot vindo do cache do vindo do servidor', () => {
    status.registrarUsuario('library', 'uid-julio');
    status.registrarSnapshot('library', 300, 'cache');

    expect(status.relatorioSyncTexto(300)).toContain('cache do aparelho');
  });
});
