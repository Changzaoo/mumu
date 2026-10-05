/**
 * Busca por trecho de letra (lib/search/lyricsSearch). Compara o texto COMO É
 * EXIBIDO (grafia padrão) nos dois lados, sem alterar o que está no cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/ai/ai', () => ({ aiCleanSongTitle: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/local/importerHelper', () => ({ fetchOutraFonteDeLetra: vi.fn() }));
vi.mock('@/lib/conteudo/faixaEtaria', () => ({ registrarLetra: vi.fn() }));

import type { Lyrics } from '@/lib/lyrics/lyrics';

const letra = (textos: string[]): Lyrics => ({
  synced: true,
  source: null,
  lines: textos.map((text, i) => ({ timeMs: i * 1000, text })),
});

async function mundo(letras: Record<string, Lyrics>) {
  vi.resetModules();
  window.localStorage.clear();
  const lyrics = await import('@/lib/lyrics/lyrics');
  for (const [id, l] of Object.entries(letras)) lyrics.writeLyrics(id, l);
  const { searchByLyrics } = await import('@/lib/search/lyricsSearch');
  return { searchByLyrics, ...lyrics };
}

/** Português inequívoco, para a grafia rodar. */
const PT = ['não tem pobrema pra você', 'isso é tudo meu'];

beforeEach(() => vi.resetModules());

describe('busca por trecho: grafia padrão nos dois lados', () => {
  it('buscar "nós" acha a letra salva como "nois"', async () => {
    const { searchByLyrics } = await mundo({
      a: letra([...PT, 'nois vai pro baile hoje']),
    });
    const r = await searchByLyrics('nós vai pro baile');
    expect(r.map((m) => m.trackId)).toEqual(['a']);
    expect(r[0]?.score).toBe(100);
  });

  it('o excerpt mostrado é a linha como a tela a exibe', async () => {
    const { searchByLyrics } = await mundo({ a: letra([...PT, 'nois vai pro baile hoje']) });
    const r = await searchByLyrics('nós vai pro baile');
    expect(r[0]?.excerpt).toBe('nós vai pro baile hoje');
  });

  it('digitar a forma errada ("nois") também acha', async () => {
    const { searchByLyrics } = await mundo({ a: letra([...PT, 'nós vai pro baile hoje']) });
    expect((await searchByLyrics('nois vai pro baile')).map((m) => m.trackId)).toEqual(['a']);
  });

  it('a forma que está no cache ("nois") continua achando', async () => {
    const { searchByLyrics } = await mundo({ a: letra([...PT, 'nois vai pro baile hoje']) });
    expect((await searchByLyrics('nois vai pro baile')).map((m) => m.trackId)).toEqual(['a']);
  });

  it('sem acento na consulta: "voce nao tem pobrema" acha "você não tem problema"', async () => {
    const { searchByLyrics } = await mundo({ a: letra(['você não tem problema', ...PT]) });
    expect((await searchByLyrics('voce nao tem pobrema')).map((m) => m.trackId)).toEqual(['a']);
  });

  it('fuzzy (voz imperfeita) também usa a grafia padrão', async () => {
    const { searchByLyrics } = await mundo({
      a: letra([...PT, 'nois vai fazê o corre', 'pro baile hoje']),
    });
    const r = await searchByLyrics('nós vai fazer o corre errado agora');
    expect(r[0]?.trackId).toBe('a');
    expect(r[0]?.score).toBeLessThan(100);
  });

  it('o cache não é alterado pela busca', async () => {
    const { searchByLyrics, cachedLyrics } = await mundo({
      a: letra([...PT, 'nois vai pro baile hoje']),
    });
    await searchByLyrics('nós vai pro baile');
    expect(cachedLyrics('a')?.lines[2]?.text).toBe('nois vai pro baile hoje');
  });

  it('letra em INGLÊS não é "corrigida": "memo" continua sendo "memo"', async () => {
    const { searchByLyrics } = await mundo({
      ing: letra(['read the memo today', 'we are the champions']),
      pt: letra([...PT, 'o mermo de sempre aqui']),
    });
    expect((await searchByLyrics('read the memo today')).map((m) => m.trackId)).toEqual(['ing']);
    // e a letra portuguesa casa pela forma padrão
    expect((await searchByLyrics('o mesmo de sempre aqui')).map((m) => m.trackId)).toEqual(['pt']);
  });

  it('letra em inglês não ganha "falso positivo" por causa do dicionário', async () => {
    const { searchByLyrics } = await mundo({ ing: letra(['we ta ta ta tonight', 'the fia fia']) });
    expect(await searchByLyrics('nós vai pro baile')).toEqual([]);
  });
});

describe('busca por trecho: entradas adversárias', () => {
  it('consulta curta, vazia ou só pontuação: nada', async () => {
    const { searchByLyrics } = await mundo({ a: letra(PT) });
    expect(await searchByLyrics('')).toEqual([]);
    expect(await searchByLyrics('amor')).toEqual([]);
    expect(await searchByLyrics('!!! ??? ...')).toEqual([]);
    expect(await searchByLyrics('a b c d')).toEqual([]);
  });

  it('letra regravada com o MESMO número de linhas é buscada pelo texto novo', async () => {
    const { searchByLyrics, writeLyrics } = await mundo({
      a: letra(['sapo cururu na beira do rio', 'não lava o pé porque não quer']),
    });
    expect((await searchByLyrics('sapo cururu na beira do rio')).map((m) => m.trackId)).toEqual([
      'a',
    ]);

    writeLyrics(
      'a',
      letra(['lua cheia no mar azul profundo', 'estrela guia do navegador perdido']),
    );

    expect((await searchByLyrics('lua cheia no mar azul profundo')).map((m) => m.trackId)).toEqual([
      'a',
    ]);
    expect(await searchByLyrics('sapo cururu na beira do rio')).toEqual([]);
  });

  it('letra de 1 linha, só linhas vazias e instrumental não derrubam a busca', async () => {
    const { searchByLyrics } = await mundo({
      uma: letra(['só uma linha cantada aqui']),
      vazia: letra(['', '', '']),
      instr: letra(['♪', '[Instrumental]']),
    });
    expect((await searchByLyrics('uma linha cantada aqui')).map((m) => m.trackId)).toEqual(['uma']);
  });

  it('acentos, caixa, pontuação e emoji da consulta não atrapalham', async () => {
    const { searchByLyrics } = await mundo({ a: letra(['Eu vou ali, e volto já!']) });
    expect((await searchByLyrics('EU VOU ALI 🔥 e volto JA')).map((m) => m.trackId)).toEqual(['a']);
  });

  it('muitas letras: varre tudo, ordena por score e respeita o limite', async () => {
    const todas: Record<string, Lyrics> = {};
    for (let i = 0; i < 120; i++)
      todas[`t${i}`] = letra([`faixa ${i} refrão do pardal`, 'x y z w']);
    todas.exata = letra(['aqui está o refrão do pardal azul']);
    const { searchByLyrics } = await mundo(todas);
    const r = await searchByLyrics('refrão do pardal', 5);
    expect(r).toHaveLength(5);
    expect(r.every((m) => m.score === 100)).toBe(true);
  });

  it('busca cancelada devolve vazio', async () => {
    const { searchByLyrics } = await mundo({ a: letra(PT) });
    const c = new AbortController();
    c.abort();
    expect(await searchByLyrics('não tem pobrema pra você', 8, c.signal)).toEqual([]);
  });
});
