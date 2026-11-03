import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as fila from '@/lib/sync/filaOffline';
import { limparEstadoDaConta } from '@/lib/sync/syncManager';

describe('limpeza ao sair da conta', () => {
  beforeEach(async () => {
    fila.definirUsuario(null);
    await fila.limparFila();
  });

  it('limparEstadoDaConta esvazia a fila offline e apaga o cache aurial-api', async () => {
    fila.definirUsuario('A');
    await fila.enfileirar('likes', 'f1', 'gravar', { x: 1 });
    expect(await fila.quantasPendentes()).toBe(1);
    const apagar = vi.fn(async () => true);
    vi.stubGlobal('caches', { delete: apagar });
    await limparEstadoDaConta();
    expect(apagar).toHaveBeenCalledWith('aurial-api');
    expect(await fila.quantasPendentes()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('logout() chama o limpador', async () => {
    vi.resetModules();
    const limpador = vi.fn(async () => undefined);
    vi.doMock('@/lib/sync/syncManager', () => ({ limparEstadoDaConta: limpador }));
    const { logout } = await import('@/lib/firebase');
    await logout();
    expect(limpador).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/lib/sync/syncManager');
  });

  it('descarta item de outro uid ao ler a fila', async () => {
    fila.definirUsuario('A');
    await fila.enfileirar('likes', 'f1', 'gravar', {});
    fila.definirUsuario('B');
    await fila.enfileirar('likes', 'f2', 'gravar', {});
    const itens = await fila.pendentes('likes');
    expect(itens.map((p) => p.id)).toEqual(['f2']);
    expect(await fila.quantasPendentes()).toBe(1);
  });
});
