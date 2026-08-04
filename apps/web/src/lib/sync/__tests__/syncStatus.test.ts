/**
 * O relatório de sincronia precisa APONTAR a causa, não só listar números.
 *
 * Cada teste aqui é uma das formas de um aparelho ficar para trás — e todas
 * elas produziam exatamente o mesmo sintoma na tela ("faltam músicas") antes
 * deste módulo existir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('relatório de sincronia', () => {
  let status: typeof import('@/lib/sync/syncStatus');

  beforeEach(async () => {
    vi.resetModules(); // o estado vive no módulo: cada teste começa limpo
    status = await import('@/lib/sync/syncStatus');
  });

  it('sem login, diz que nada sincroniza e o que fazer', () => {
    const texto = status.relatorioSyncTexto(12);
    expect(texto).toContain('Ninguém logado');
    expect(texto).toContain('MESMA conta');
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

    const texto = status.relatorioSyncTexto(300);
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
