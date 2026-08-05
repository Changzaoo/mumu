/**
 * O ACERVO DO APP na biblioteca de quem só escuta.
 *
 * Duas regras sustentam isto, e quebrar qualquer uma causa estrago silencioso:
 *
 * 1. O que é do usuário NUNCA é tocado pelo acervo. Se o admin publica uma
 *    faixa que o usuário já tinha importado sozinho, a dele continua sendo
 *    dela — e não pode sumir quando o admin tirar a faixa do ar.
 * 2. O acervo manda no acervo: faixa emprestada que saiu do catálogo sai daqui
 *    também, senão tirar do ar não teria efeito nenhum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as LocalLibraryModule from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

type LocalLibrary = typeof LocalLibraryModule;

// A nuvem e o importador ficam de fora: aqui se testa a regra de fusão.
vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/cloudCollection', () => ({
  cloudCollection: () => ({ push: vi.fn(), remove: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

function entrada(id: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: makeTrack(id),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
    ...extra,
  };
}

describe('acervo do app na biblioteca local', () => {
  let lib: LocalLibrary;

  // A persistência do registro é debounced em 300ms. Sem congelar o relógio, o
  // flush pendente de UM teste caía no meio do seguinte e sobrescrevia a semente
  // dele — o arquivo passava sozinho e falhava em sequência.
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Semeia o registro e sobe um módulo limpo em cima dele.
   *  Escreve direto porque o caminho normal de import pede blob e rede. */
  async function montar(entradas: LibraryEntry[]): Promise<LocalLibrary> {
    window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
    vi.resetModules();
    lib = await import('@/lib/local/localLibrary');
    return lib;
  }

  it('faixa do acervo entra na biblioteca de quem não tem nada', async () => {
    const lib = await montar([]);

    lib.aplicarCatalogo([entrada('local:a'), entrada('local:b')]);

    const ids = lib.list().map((e) => e.track.id);
    expect(ids).toContain('local:a');
    expect(ids).toContain('local:b');
    expect(lib.list().every((e) => e.origem === 'catalogo')).toBe(true);
  });

  it('faixa que o usuário já tinha NÃO vira emprestada', async () => {
    const lib = await montar([entrada('local:minha')]);

    lib.aplicarCatalogo([entrada('local:minha'), entrada('local:nova')]);

    const minha = lib.list().find((e) => e.track.id === 'local:minha');
    expect(minha?.origem).toBeUndefined();
  });

  it('faixa tirada do acervo some — mas só a emprestada', async () => {
    const lib = await montar([
      entrada('local:minha'),
      entrada('local:emprestada', { origem: 'catalogo' }),
    ]);

    // O admin tirou `local:emprestada` do ar; o acervo segue com outras.
    lib.aplicarCatalogo([entrada('local:outra')]);

    const ids = lib.list().map((e) => e.track.id);
    expect(ids).toContain('local:minha');
    expect(ids).toContain('local:outra');
    expect(ids).not.toContain('local:emprestada');
  });

  it('correção de metadata do admin chega em quem já tinha a faixa emprestada', async () => {
    const lib = await montar([entrada('local:a', { origem: 'catalogo' })]);

    const corrigida = entrada('local:a');
    corrigida.track = { ...corrigida.track, title: 'Título Certo' };
    lib.aplicarCatalogo([corrigida]);

    const atual = lib.list().find((e) => e.track.id === 'local:a');
    expect(atual?.track.title).toBe('Título Certo');
    expect(atual?.origem).toBe('catalogo');
  });

  it('snapshot repetido não reescreve a biblioteca', async () => {
    const lib = await montar([entrada('local:a', { origem: 'catalogo' })]);

    const antes = lib.list();
    lib.aplicarCatalogo([entrada('local:a')]);
    // Mesma referência de array = nada foi reescrito nem re-renderizado.
    expect(lib.list()).toBe(antes);
  });

  it('alimenta "Adicionadas recentemente" de quem nunca importou nada', async () => {
    const lib = await montar([]); // usuário comum: biblioteca zerada

    lib.aplicarCatalogo([
      entrada('local:velha', { addedAt: '2026-01-01T00:00:00.000Z' }),
      entrada('local:nova', { addedAt: '2026-08-01T00:00:00.000Z' }),
    ]);

    // É EXATAMENTE o cálculo da Home: ordena por addedAt, mais novas primeiro.
    const recentes = [...lib.list()]
      .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
      .map((e) => e.track.id);
    expect(recentes).toEqual(['local:nova', 'local:velha']);
  });

  // ── as duas formas de o acervo QUEBRAR a biblioteca ──────────────────────
  // As duas saíram para produção e derrubaram o app: a faixa recém-adicionada
  // sumia na recarga, inclusive para o admin.

  it('o acervo não é gravado no localStorage — ele volta do servidor sozinho', async () => {
    const lib = await montar([entrada('local:minha')]);

    lib.aplicarCatalogo([entrada('local:doAcervo')]);
    vi.advanceTimersByTime(500); // vence o debounce da persistência

    const gravado = JSON.parse(
      window.localStorage.getItem('aurial:library') ?? '[]',
    ) as LibraryEntry[];
    // Só a faixa DO USUÁRIO foi para o disco. Gravar o acervo junto dobrava o
    // registro dentro de uma cota de ~5 MB e derrubava a gravação INTEIRA —
    // levando junto a biblioteca do próprio usuário.
    expect(gravado.map((e) => e.track.id)).toEqual(['local:minha']);
    // Mas na tela as duas continuam lá.
    expect(lib.list()).toHaveLength(2);
  });

  it('faixa nova do usuário sobrevive à recarga com o acervo carregado', async () => {
    const lib = await montar([entrada('local:minha')]);
    lib.aplicarCatalogo([entrada('local:doAcervo')]);
    vi.advanceTimersByTime(500);

    // Recarrega o app: só o que foi gravado volta.
    vi.resetModules();
    const depois = await import('@/lib/local/localLibrary');
    expect(depois.list().map((e) => e.track.id)).toEqual(['local:minha']);
  });

  it('acervo vazio NÃO apaga a biblioteca — erro de regra chega igual a "vazio"', async () => {
    const lib = await montar([
      entrada('local:minha'),
      entrada('local:emprestada', { origem: 'catalogo' }),
    ]);

    lib.aplicarCatalogo([]); // snapshot ruim: regra negada, cache frio, rede caída

    expect(lib.list().map((e) => e.track.id)).toEqual(['local:minha', 'local:emprestada']);
  });

  it('apagar faixa emprestada não mexe na cópia que serve todo mundo', async () => {
    const lib = await montar([
      entrada('local:emprestada', { origem: 'catalogo', remoteUrl: 'https://cofre/a.mp3' }),
    ]);
    const importador = await import('@/lib/local/importerHelper');
    const apagarNoCofre = vi.spyOn(importador, 'deleteTrackBlob');

    await lib.remove('local:emprestada');

    expect(lib.list()).toHaveLength(0);
    expect(apagarNoCofre).not.toHaveBeenCalled();
  });
});
