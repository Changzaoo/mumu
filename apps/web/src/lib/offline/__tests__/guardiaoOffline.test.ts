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
import {
  ordemDeDownload,
  ritmoDoAparelho,
  type ContextoDeEscuta,
} from '@/lib/offline/guardiaoOffline';
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

describe('ordemDeDownload — os álbuns que a pessoa mandou guardar', () => {
  /** Duas faixas do MESMO álbum: a chave é `titulo|artista` normalizado. */
  function doAlbum(id: string, titulo: string, artista: string): LibraryEntry {
    return entrada(id, {
      track: makeTrack(id, {
        album: { id: `a-${titulo}`, title: titulo, slug: titulo, coverUrl: null },
        artists: [{ id: `x-${artista}`, name: artista, slug: artista, imageUrl: null }],
      }),
    });
  }

  const guardado1 = doAlbum('g1', 'Guardado', 'Djavan');
  const guardado2 = doAlbum('g2', 'Guardado', 'Djavan');
  const outro = doAlbum('o1', 'Outro', 'Djavan');
  const CHAVE = new Set(['guardado|djavan']);

  it('o álbum marcado vem antes do resto da biblioteca', () => {
    const fila = ordemDeDownload([outro, guardado1, guardado2], semContexto, nenhumTem, CHAVE);
    expect(fila.slice(0, 2).map((e) => e.track.id)).toEqual(['g1', 'g2']);
  });

  it('mas NUNCA antes do que está tocando agora', () => {
    // Errar aqui é errar na cara da pessoa, com o aparelho na mão: ela mandou
    // tocar uma coisa e o app foi baixar outra.
    const fila = ordemDeDownload(
      [outro, guardado1, guardado2],
      { aSeguir: ['o1'], recentes: [] },
      nenhumTem,
      CHAVE,
    );
    expect(fila[0]!.track.id).toBe('o1');
  });

  it('o álbum vem INTEIRO — meio álbum no avião não é álbum offline', () => {
    const fila = ordemDeDownload([outro, guardado1, guardado2], semContexto, nenhumTem, CHAVE);
    const ids = fila.map((e) => e.track.id);
    expect(ids.indexOf('g2')).toBeLessThan(ids.indexOf('o1'));
  });

  it('sem marca nenhuma, a ordem é exatamente a de antes', () => {
    const entradas = [outro, guardado1, guardado2];
    const antes = ordemDeDownload(entradas, semContexto, nenhumTem);
    const depois = ordemDeDownload(entradas, semContexto, nenhumTem, new Set());
    expect(depois.map((e) => e.track.id)).toEqual(antes.map((e) => e.track.id));
  });

  it('marca de álbum que não existe na biblioteca não quebra nada', () => {
    const fila = ordemDeDownload([outro], semContexto, nenhumTem, new Set(['fantasma|ninguem']));
    expect(fila.map((e) => e.track.id)).toEqual(['o1']);
  });

  it('não duplica faixa que já estava na fila de reprodução', () => {
    const fila = ordemDeDownload(
      [guardado1, guardado2],
      { aSeguir: ['g1'], recentes: [] },
      nenhumTem,
      CHAVE,
    );
    expect(fila.map((e) => e.track.id)).toEqual(['g1', 'g2']);
  });
});

describe('ritmoDoAparelho — rápido sem esganar o aparelho', () => {
  it('celular novo em boa rede usa o teto', () => {
    // O motivo desta mudança: antes era UMA faixa por vez com 1,5 s de espera em
    // todo aparelho, ou ~13/min no melhor caso. Um celular novo em Wi-Fi passava
    // o tempo ocioso esperando um respiro calibrado para o pior caso.
    const r = ritmoDoAparelho({ tipoDeConexao: '4g', nucleos: 8, memoriaGb: 8 });
    expect(r.simultaneos).toBe(4);
    expect(r.respiroMs).toBeLessThanOrEqual(200);
  });

  it('APARELHO FRACO: cada download carrega o arquivo inteiro na memória', () => {
    // `garantirAudioLocal` faz `res.blob()` antes de gravar. Quatro em paralelo
    // são quatro faixas de ~8 MB vivas ao mesmo tempo — num aparelho de 2 GB
    // isso é dinheiro que não existe.
    const r = ritmoDoAparelho({ tipoDeConexao: '4g', nucleos: 2, memoriaGb: 2 });
    expect(r.simultaneos).toBe(2);
  });

  it('O PIOR SINAL MANDA: 2G num celular potente continua sendo 2G', () => {
    const r = ritmoDoAparelho({ tipoDeConexao: '2g', nucleos: 8, memoriaGb: 8 });
    expect(r.simultaneos).toBe(1);
    expect(r.respiroMs).toBeGreaterThanOrEqual(4_000);
  });

  it('economia de dados é pedido da pessoa e vence a capacidade', () => {
    const r = ritmoDoAparelho({
      economizarDados: true,
      tipoDeConexao: '4g',
      nucleos: 8,
      memoriaGb: 8,
    });
    expect(r.simultaneos).toBe(1);
    expect(r.respiroMs).toBeGreaterThanOrEqual(5_000);
  });

  it('mas economia de dados não PARA o download', () => {
    // A fila é o que a pessoa vai ouvir, não especulação: parar de todo deixaria
    // justamente quem tem pouca internet sem música offline.
    expect(ritmoDoAparelho({ economizarDados: true }).simultaneos).toBeGreaterThan(0);
  });

  it('SEM SINAL NENHUM (Safari) não é castigo', () => {
    // `deviceMemory` e `connection` não existem no Safari. Tratar ausência como
    // aparelho ruim deixaria todo iPhone no ritmo de 2G.
    const r = ritmoDoAparelho({});
    expect(r.simultaneos).toBeGreaterThanOrEqual(3);
  });

  it('nunca passa do teto, por mais forte que seja o aparelho', () => {
    // Os bytes saem de um único servidor doméstico atrás de um túnel: mais
    // paralelismo não acelera e atrapalha quem está ouvindo agora.
    const r = ritmoDoAparelho({ tipoDeConexao: '4g', nucleos: 64, memoriaGb: 64 });
    expect(r.simultaneos).toBe(4);
  });
});
