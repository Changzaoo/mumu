import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const remove = vi.fn();
let remoto: {
  onRemoteUpsert: (id: string, data: unknown) => void;
  onRemoteDelete: (id: string) => void;
} | null = null;
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: (cfg: typeof remoto) => {
    remoto = cfg;
    return { push, remove, setUser: vi.fn() };
  },
}));

async function carregar() {
  vi.resetModules();
  push.mockClear();
  remove.mockClear();
  return import('../artistasSeguidos');
}

describe('artistasSeguidos', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('seguir guarda, avisa quem ouve e sobe para os outros aparelhos', async () => {
    const s = await carregar();
    const ouvinte = vi.fn();
    s.subscribe(ouvinte);
    s.seguir('Djavan', 'https://capa/djavan.jpg');
    expect(s.segue('Djavan')).toBe(true);
    expect(s.list().map((a) => a.nome)).toEqual(['Djavan']);
    expect(ouvinte).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      s.chaveDoArtista('Djavan'),
      expect.objectContaining({ nome: 'Djavan', capaUrl: 'https://capa/djavan.jpg' }),
    );
  });

  it('a identidade vale, não a grafia: "DJ Kennedi" segue "Kennedi"', async () => {
    const s = await carregar();
    s.seguir('DJ Kennedi');
    expect(s.segue('Kennedi')).toBe(true);
    s.seguir('Kennedi'); // já segue: não duplica
    expect(s.list()).toHaveLength(1);
  });

  it('deixar de seguir tira da lista e apaga na nuvem', async () => {
    const s = await carregar();
    s.seguir('Marisa Monte');
    expect(s.alternar('Marisa Monte')).toBe(false);
    expect(s.segue('Marisa Monte')).toBe(false);
    expect(remove).toHaveBeenCalledWith(s.chaveDoArtista('Marisa Monte'));
  });

  it('o mais recente fica em cima', async () => {
    vi.useFakeTimers();
    try {
      const s = await carregar();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      s.seguir('Antigo');
      vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
      s.seguir('Novo');
      expect(s.list().map((a) => a.nome)).toEqual(['Novo', 'Antigo']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('capa blob: não é gravada (morre com a aba)', async () => {
    const s = await carregar();
    s.seguir('Fulano', 'blob:http://x/123');
    expect(s.list()[0]?.capaUrl).toBeNull();
  });

  it('sobrevive à recarga da página', async () => {
    const s1 = await carregar();
    s1.seguir('Gal Costa');
    const s2 = await carregar();
    expect(s2.segue('Gal Costa')).toBe(true);
  });

  it('o que chega de outro aparelho entra sem ser reenviado', async () => {
    const s = await carregar();
    remoto?.onRemoteUpsert('caetano', {
      nome: 'Caetano',
      capaUrl: null,
      seguidoEm: '2026-03-01T00:00:00Z',
    });
    expect(s.segue('Caetano')).toBe(true);
    expect(push).not.toHaveBeenCalled();
    remoto?.onRemoteUpsert('lixo', { sem: 'nome' });
    expect(s.list()).toHaveLength(1);
    remoto?.onRemoteDelete(s.chaveDoArtista('Caetano'));
    expect(s.segue('Caetano')).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
