import { afterEach, describe, expect, it, vi } from 'vitest';
import { garantirHomePorBaixo } from '@/lib/historico/raiz';

function comoApp(sim: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: sim && q.includes('standalone'), media: q }) as MediaQueryList,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('garantirHomePorBaixo', () => {
  it('no app, aberto numa página de dentro: a Home fica por baixo e o voltar leva a ela', async () => {
    comoApp(true);
    window.history.replaceState(null, '', '/artista/Fulano');
    garantirHomePorBaixo();
    expect(window.location.pathname).toBe('/artista/Fulano');
    expect((window.history.state as { idx: number }).idx).toBe(1);

    window.history.back();
    await new Promise((r) => setTimeout(r, 40));
    expect(window.location.pathname).toBe('/');
  });

  it('na Home não faz nada', () => {
    comoApp(true);
    window.history.replaceState(null, '', '/');
    garantirHomePorBaixo();
    expect(window.history.state).toBeNull();
  });

  it('numa aba comum do navegador não mexe no histórico (o voltar devolve a quem mandou o link)', () => {
    comoApp(false);
    window.history.replaceState(null, '', '/s/abc');
    garantirHomePorBaixo();
    expect(window.history.state).toBeNull();
  });

  it('entrada já conhecida (recarga no meio da sessão) não empilha Home de novo', () => {
    comoApp(true);
    window.history.replaceState({ usr: null, key: 'k', idx: 4 }, '', '/library');
    garantirHomePorBaixo();
    expect((window.history.state as { idx: number }).idx).toBe(4);
  });

  it('telas de um propósito só (login) ficam como estão', () => {
    comoApp(true);
    window.history.replaceState(null, '', '/login');
    garantirHomePorBaixo();
    expect(window.history.state).toBeNull();
  });
});
