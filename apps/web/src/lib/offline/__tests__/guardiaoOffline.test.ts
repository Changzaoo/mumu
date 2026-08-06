/**
 * "SE VOCÊ VIU A MÚSICA, ELA TOCA. SEM MAIS E SEM MENOS."
 *
 * O defeito: os bytes moram no servidor de casa, e ele pode estar fora do ar,
 * com a internet caindo ou o túnel derrubado. A faixa aparecia na lista,
 * clicável, e mentia.
 *
 * A resposta honesta é ter os bytes ANTES de precisar deles. Mas uma biblioteca
 * grande não cabe inteira no aparelho, então a ORDEM decide se o offline
 * funciona de verdade ou só para faixas que ninguém ia ouvir. É a ordem que
 * estes testes travam.
 */
import { describe, expect, it } from 'vitest';
import { ordemDeDownload, type ContextoDeEscuta } from '@/lib/offline/guardiaoOffline';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { makeTrack } from '@/test/factories';

function entrada(id: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    track: makeTrack(id),
    addedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 1,
    mimeType: 'audio/mpeg',
    remoteUrl: `https://cofre/${id}.mp3`,
    ...extra,
  };
}

const semContexto: ContextoDeEscuta = { aSeguir: [], recentes: [] };
const nenhumTem = (): boolean => false;
const ids = (lista: LibraryEntry[]): string[] => lista.map((e) => e.track.id);

describe('quem baixa primeiro', () => {
  it('a fila vem antes de tudo — errar aqui é errar na cara da pessoa', () => {
    const biblioteca = [entrada('a'), entrada('b'), entrada('c')];
    const ordem = ordemDeDownload(biblioteca, { aSeguir: ['c'], recentes: [] }, nenhumTem);
    expect(ids(ordem)[0]).toBe('c');
  });

  it('depois o que ela ouve sempre — é o que vai procurar sem sinal', () => {
    const biblioteca = [entrada('a'), entrada('b'), entrada('c')];
    const ordem = ordemDeDownload(biblioteca, { aSeguir: ['c'], recentes: ['b'] }, nenhumTem);
    expect(ids(ordem)).toEqual(['c', 'b', 'a']);
  });

  it('sem contexto nenhum, segue a ordem da biblioteca', () => {
    expect(ids(ordemDeDownload([entrada('a'), entrada('b')], semContexto, nenhumTem))).toEqual([
      'a',
      'b',
    ]);
  });

  it('ninguém entra duas vezes, mesmo aparecendo na fila E no histórico', () => {
    const ordem = ordemDeDownload(
      [entrada('a'), entrada('b')],
      { aSeguir: ['a'], recentes: ['a'] },
      nenhumTem,
    );
    expect(ids(ordem)).toEqual(['a', 'b']);
  });

  // ── quem fica de fora, e por quê ─────────────────────────────────────────

  it('quem já tem áudio aqui não é baixado de novo', () => {
    const ordem = ordemDeDownload(
      [entrada('a'), entrada('b')],
      semContexto,
      (id) => id === 'a', // "a" já está no aparelho
    );
    expect(ids(ordem)).toEqual(['b']);
  });

  it('faixa SEM ROTA fica de fora — senão a varredura trava nas impossíveis', () => {
    // Sem cópia no importador e sem link de origem não há de onde baixar.
    // Insistir nelas faria a fila nunca chegar nas que dão certo.
    const semRota = entrada('x', { remoteUrl: undefined, sourceUrl: undefined });
    const ordem = ordemDeDownload([semRota, entrada('b')], semContexto, nenhumTem);
    expect(ids(ordem)).toEqual(['b']);
  });

  it('faixa só com link de origem entra — o importador ainda resolve', () => {
    const soLink = entrada('y', { remoteUrl: undefined, sourceUrl: 'https://youtu.be/x' });
    expect(ids(ordemDeDownload([soLink], semContexto, nenhumTem))).toEqual(['y']);
  });

  it('prévia de 30s não ocupa espaço — ela nunca foi a música inteira', () => {
    const previa = entrada('p');
    previa.track = { ...previa.track, previewOnly: true };
    expect(ordemDeDownload([previa], semContexto, nenhumTem)).toEqual([]);
  });

  it('id na fila que não está na biblioteca é ignorado sem quebrar', () => {
    const ordem = ordemDeDownload(
      [entrada('a')],
      { aSeguir: ['fantasma'], recentes: [] },
      nenhumTem,
    );
    expect(ids(ordem)).toEqual(['a']);
  });
});
