import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const remove = vi.fn();
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push, remove, setUser: vi.fn() }),
}));

async function carregar() {
  vi.resetModules();
  push.mockClear();
  remove.mockClear();
  return import('../gostoInicial');
}

describe('gostoInicial', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('antes de responder, o app sabe que precisa perguntar', async () => {
    const g = await carregar();
    expect(g.ler()).toBeNull();
    expect(g.respondeu()).toBe(false);
    expect(g.precisaEscolher()).toBe(true);
  });

  it('guarda a escolha e a manda para os outros aparelhos', async () => {
    const g = await carregar();
    g.salvar(['Samba', 'MPB'], ['Djavan']);
    expect(g.ler()).toMatchObject({ generos: ['Samba', 'MPB'], artistas: ['Djavan'] });
    expect(g.precisaEscolher()).toBe(false);
    expect(push).toHaveBeenCalledWith(
      'inicial',
      expect.objectContaining({ generos: ['Samba', 'MPB'] }),
    );
  });

  it('sobrevive à recarga da página', async () => {
    const g1 = await carregar();
    g1.salvar(['Rock'], []);
    const g2 = await carregar();
    expect(g2.ler()?.generos).toEqual(['Rock']);
  });

  it('"agora não" também é uma resposta — a tela não volta a perguntar', async () => {
    // O ponto inteiro: sem gravar o "pulei", quem não quer escolher seria
    // perguntado em toda abertura, e a tela viraria um obstáculo.
    const g = await carregar();
    g.pular();
    expect(g.respondeu()).toBe(true);
    expect(g.precisaEscolher()).toBe(false);
    expect(g.ler()).toMatchObject({ generos: [], artistas: [] });
  });

  it('não guarda escolha repetida', async () => {
    const g = await carregar();
    g.salvar(['Samba', 'Samba', 'MPB'], ['Djavan', 'Djavan']);
    expect(g.ler()?.generos).toEqual(['Samba', 'MPB']);
    expect(g.ler()?.artistas).toEqual(['Djavan']);
  });

  it('avisa quem estiver ouvindo quando a escolha muda', async () => {
    const g = await carregar();
    const ouvinte = vi.fn();
    const parar = g.subscribe(ouvinte);
    g.salvar(['Jazz'], []);
    expect(ouvinte).toHaveBeenCalled();
    parar();
  });

  it('localStorage corrompido não derruba a tela — só volta a perguntar', async () => {
    window.localStorage.setItem('aurial:gosto-inicial', '{isto nao e json');
    const g = await carregar();
    expect(g.ler()).toBeNull();
    expect(g.precisaEscolher()).toBe(true);
  });

  it('descarta escolha com formato inesperado em vez de confiar nela', async () => {
    window.localStorage.setItem('aurial:gosto-inicial', JSON.stringify({ generos: 'Samba' }));
    const g = await carregar();
    expect(g.ler()).toBeNull();
  });

  it('limpar apaga aqui e nos outros aparelhos', async () => {
    const g = await carregar();
    g.salvar(['Rock'], []);
    g.limpar();
    expect(g.ler()).toBeNull();
    expect(remove).toHaveBeenCalledWith('inicial');
  });

  it('snapshot devolve a mesma referência entre leituras', async () => {
    // `useSyncExternalStore` entra em laço infinito se o snapshot mudar de
    // identidade a cada chamada — a Home lê isto a cada render.
    const g = await carregar();
    expect(g.snapshot()).toBe(g.snapshot());
    g.salvar(['Rock'], []);
    expect(g.snapshot()).toBe(g.snapshot());
  });
});
