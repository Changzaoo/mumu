import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

const push = vi.fn();
vi.mock('@/lib/sync/serverCollection', () => ({
  serverCollection: () => ({ push, remove: vi.fn(), setUser: vi.fn() }),
}));

function faixa(id: string, titulo = 'T', artista = 'A'): TrackDto {
  return { id, title: titulo, artists: [{ id: 'a', name: artista }] } as unknown as TrackDto;
}

const COM_ORIGEM = {
  tinhaAudioLocal: false,
  tinhaCopiaRemota: false,
  sourceUrl: 'https://youtu.be/abc',
};
const SEM_ORIGEM = { tinhaAudioLocal: false, tinhaCopiaRemota: false };

async function carregar() {
  vi.resetModules();
  push.mockClear();
  return import('../faixasQueFalharam');
}

describe('faixasQueFalharam', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('registra a faixa que não tocou e a manda para o servidor', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1', 'Sem Som', 'Djavan'), 'fonte-morta', COM_ORIGEM);
    const [caso] = f.lista();
    expect(caso).toMatchObject({
      trackId: 'local:1',
      titulo: 'Sem Som',
      artista: 'Djavan',
      motivo: 'fonte-morta',
      vezes: 1,
    });
    expect(push).toHaveBeenCalledWith('local:1', expect.objectContaining({ trackId: 'local:1' }));
  });

  it('uma faixa que falha quarenta vezes é UM caso, não quarenta', async () => {
    // Sem isto, uma noite de fila ruim afogaria os casos distintos — que são
    // justamente o que interessa reparar.
    const f = await carregar();
    for (let i = 0; i < 40; i++) f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    expect(f.lista()).toHaveLength(1);
    expect(f.lista()[0]!.vezes).toBe(40);
  });

  it('separa o que tem conserto do que está perdido', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    f.registrar(faixa('local:2'), 'sem-fonte', SEM_ORIGEM);
    expect(f.reparaveis().map((c) => c.trackId)).toEqual(['local:1']);
    expect(f.semConserto().map((c) => c.trackId)).toEqual(['local:2']);
  });

  it('a faixa reparada sai da fila de reparo', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    f.marcarReparada('local:1');
    expect(f.reparaveis()).toEqual([]);
    expect(f.emAberto()).toEqual([]);
    expect(f.resumo().reparadas).toBe(1);
  });

  it('faixa que falha DE NOVO depois de reparada volta a ser um caso', async () => {
    // Um reparo que não pegou não pode deixar a faixa invisível para sempre.
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    f.marcarReparada('local:1');
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    expect(f.emAberto().map((c) => c.trackId)).toEqual(['local:1']);
    expect(f.reparaveis()).toHaveLength(1);
  });

  it('desiste depois do teto de tentativas — vídeo removido nunca volta', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    for (let i = 0; i < 3; i++) f.anotarTentativaDeReparo('local:1');
    expect(f.reparaveis(3)).toEqual([]);
    expect(f.emAberto()).toHaveLength(1); // continua no mapa, só não se insiste
  });

  it('guarda a primeira e a última vez', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    const primeira = f.lista()[0]!.primeiraEm;
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    const caso = f.lista()[0]!;
    expect(caso.primeiraEm).toBe(primeira);
    expect(caso.ultimaEm >= primeira).toBe(true);
  });

  it('sobrevive à recarga da página', async () => {
    const f1 = await carregar();
    f1.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    const f2 = await carregar();
    expect(f2.lista()).toHaveLength(1);
  });

  it('localStorage corrompido não derruba nada', async () => {
    window.localStorage.setItem('aurial:faixas-que-falharam', 'nao e json');
    const f = await carregar();
    expect(f.lista()).toEqual([]);
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    expect(f.lista()).toHaveLength(1);
  });

  it('poda pelo teto sacrificando os reparados primeiro', async () => {
    const f = await carregar();
    // Um caso reparado já cumpriu o seu papel; um caso aberto ainda tem
    // trabalho pela frente e não pode ser o primeiro a sair.
    f.registrar(faixa('reparada'), 'fonte-morta', COM_ORIGEM);
    f.marcarReparada('reparada');
    for (let i = 0; i < 400; i++) f.registrar(faixa(`aberta:${i}`), 'fonte-morta', COM_ORIGEM);
    const ids = f.lista().map((c) => c.trackId);
    expect(ids).not.toContain('reparada');
    expect(f.lista().length).toBeLessThanOrEqual(400);
  });

  it('resumo conta cada categoria', async () => {
    const f = await carregar();
    f.registrar(faixa('local:1'), 'fonte-morta', COM_ORIGEM);
    f.registrar(faixa('local:2'), 'sem-fonte', SEM_ORIGEM);
    f.registrar(faixa('local:3'), 'fonte-morta', COM_ORIGEM);
    f.marcarReparada('local:3');
    expect(f.resumo()).toMatchObject({
      total: 3,
      abertas: 2,
      reparaveis: 1,
      semConserto: 1,
      reparadas: 1,
    });
  });
});
