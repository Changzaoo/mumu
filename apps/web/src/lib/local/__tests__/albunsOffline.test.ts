import { beforeEach, describe, expect, it, vi } from 'vitest';

async function carregar() {
  vi.resetModules();
  return import('../albunsOffline');
}

describe('albunsOffline', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('marca e desmarca um álbum', async () => {
    const a = await carregar();
    expect(a.estaFixado('samba|djavan')).toBe(false);
    a.fixar('samba|djavan');
    expect(a.estaFixado('samba|djavan')).toBe(true);
    a.desfixar('samba|djavan');
    expect(a.estaFixado('samba|djavan')).toBe(false);
  });

  it('alternar devolve o estado NOVO, que é o que o botão mostra', async () => {
    const a = await carregar();
    expect(a.alternar('x|y')).toBe(true);
    expect(a.alternar('x|y')).toBe(false);
  });

  it('sobrevive à recarga — a marca é uma decisão, não um estado de sessão', async () => {
    const a1 = await carregar();
    a1.fixar('x|y');
    const a2 = await carregar();
    expect(a2.estaFixado('x|y')).toBe(true);
  });

  it('marcar duas vezes não duplica', async () => {
    const a = await carregar();
    a.fixar('x|y');
    a.fixar('x|y');
    expect(a.lista().size).toBe(1);
  });

  it('avisa quem está ouvindo quando a marca muda', async () => {
    const a = await carregar();
    const ouvinte = vi.fn();
    const parar = a.subscribe(ouvinte);
    a.fixar('x|y');
    expect(ouvinte).toHaveBeenCalled();
    parar();
  });

  it('localStorage corrompido não derruba a tela', async () => {
    window.localStorage.setItem('aurial:albuns-offline', 'nao e json');
    const a = await carregar();
    expect(a.lista().size).toBe(0);
    a.fixar('x|y');
    expect(a.estaFixado('x|y')).toBe(true);
  });

  it('descarta entradas que não são texto em vez de confiar nelas', async () => {
    window.localStorage.setItem('aurial:albuns-offline', JSON.stringify(['bom', 42, null]));
    const a = await carregar();
    expect([...a.lista()]).toEqual(['bom']);
  });

  it('lista devolve a mesma referência entre leituras', async () => {
    // `useSyncExternalStore` entra em laço infinito se o snapshot mudar de
    // identidade a cada chamada — a página do álbum lê isto a cada render.
    const a = await carregar();
    expect(a.lista()).toBe(a.lista());
  });
});
