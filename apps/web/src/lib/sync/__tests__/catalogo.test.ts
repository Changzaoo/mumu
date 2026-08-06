/**
 * Publicar no acervo do app — e as duas lições que custaram caro.
 *
 * 1. ESCREVER SÓ O QUE MUDOU. Publicar a cada remendo da curadoria e reescrever
 *    a biblioteca inteira a cada abertura esgotou a COTA DIÁRIA do projeto, e
 *    com ela pararam a biblioteca pessoal, o "em alta" e os compartilhamentos.
 * 2. NUNCA CONFIAR NA MEMÓRIA DO CLIENTE. A marca local de "já publiquei" fez
 *    o aparelho acreditar que tinha subido faixas que nunca saíram — e nunca
 *    mais tentar. O acervo ficou vazio e continuou vazio. Quem manda é o
 *    snapshot: o que falta lá, sobe, quantas vezes for preciso.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import type * as CatalogoModule from '@/lib/sync/catalogo';
import { makeTrack } from '@/test/factories';

const setDoc = vi.fn(() => Promise.resolve());

// A conta do teste está na allow-list de admin (lib/auth/roles.ts).
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { email: 'perdibitcoin@gmail.com' } },
  db: {},
  authDisabled: false,
  firebaseReady: () => Promise.resolve(),
  subscribeAuth: () => () => undefined,
  getIdToken: () => Promise.resolve(null),
}));
vi.mock('@/lib/sync/firestoreLazy', () => ({
  firestore: () =>
    Promise.resolve({
      doc: (_db: unknown, _c: string, id: string) => id,
      setDoc,
      deleteDoc: vi.fn(),
    }),
}));

function entrada(extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: makeTrack('local:a'),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1000,
    mimeType: 'audio/mpeg',
    ...extra,
  };
}

/** O publicar é fire-and-forget: deixa as promises internas resolverem. */
const assentar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('publicar no acervo do app', () => {
  let catalogo: typeof CatalogoModule;

  beforeEach(async () => {
    setDoc.mockClear();
    window.localStorage.clear(); // as impressões digitais vivem aqui
    vi.resetModules();
    catalogo = await import('@/lib/sync/catalogo');
  });

  // ── a cota que derrubou o app ────────────────────────────────────────────
  // Escrever a cada remendo e reescrever a biblioteca inteira a cada abertura
  // esgotou a cota DIÁRIA do projeto — e com ela pararam também a biblioteca
  // pessoal, o "em alta" e os compartilhamentos.

  it('republicar a mesma faixa não gasta escrita', async () => {
    const faixa = entrada({ remoteUrl: 'https://cofre/a.mp3' });

    catalogo.publicarNoCatalogo(faixa);
    await assentar();
    catalogo.publicarNoCatalogo(faixa); // a curadoria remenda a mesma faixa
    catalogo.publicarNoCatalogo(faixa); // muitas vezes por sessão
    await assentar();

    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('mudança de verdade volta a gastar escrita', async () => {
    catalogo.publicarNoCatalogo(entrada({ remoteUrl: 'https://cofre/a.mp3' }));
    await assentar();

    const comCapa = entrada({ remoteUrl: 'https://cofre/a.mp3' });
    comCapa.track = { ...comCapa.track, coverUrl: 'https://capa/nova.jpg' };
    catalogo.publicarNoCatalogo(comCapa);
    await assentar();

    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  // ── o acervo vazio que não se enchia sozinho ─────────────────────────────
  // A reconciliação compara com a REALIDADE (o snapshot), nunca com a memória
  // do cliente. Foi confiar na memória que deixou o acervo vazio para sempre.

  it('sobe para o acervo o que falta lá, comparando com o snapshot real', async () => {
    const minhas = [
      entrada({ remoteUrl: 'https://cofre/a.mp3' }),
      { ...entrada({ remoteUrl: 'https://cofre/b.mp3' }), track: makeTrack('local:b') },
    ];

    // O acervo já tem a primeira; falta a segunda.
    expect(await catalogo.reconciliarAcervo(minhas, new Set(['local:a']))).toBe(1);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('acervo já completo não gasta escrita nenhuma', async () => {
    const minhas = [entrada({ remoteUrl: 'https://cofre/a.mp3' })];

    expect(await catalogo.reconciliarAcervo(minhas, new Set(['local:a']))).toBe(0);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('memória local mentindo NÃO impede a republicação do que falta', async () => {
    const faixa = entrada({ remoteUrl: 'https://cofre/a.mp3' });
    // Simula o estrago da versão anterior: o aparelho "lembra" que publicou.
    catalogo.publicarNoCatalogo(faixa);
    await assentar();
    setDoc.mockClear();

    // Mas o acervo está VAZIO de verdade. A reconciliação tem que corrigir.
    expect(await catalogo.reconciliarAcervo([faixa], new Set())).toBe(1);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('faixa sem rota para o áudio TAMBÉM entra — não aparecer é pior', async () => {
    // A tranca antiga (só publicar com remoteUrl/sourceUrl) esvaziava o acervo
    // inteiro quando o cofre do importador estava fora do ar.
    catalogo.publicarNoCatalogo(entrada());
    await assentar();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('faixa com cópia no cofre entra', async () => {
    catalogo.publicarNoCatalogo(entrada({ remoteUrl: 'https://cofre/a.mp3' }));
    await assentar();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('faixa só com link de origem entra — o importador transmite ao vivo', async () => {
    catalogo.publicarNoCatalogo(entrada({ sourceUrl: 'https://youtube.com/watch?v=x' }));
    await assentar();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});
