/**
 * TELEMETRIA ACUMULA — trocar em vez de somar mente no painel.
 *
 * O cliente mede um PEDAÇO (os segundos desde o último envio, os cliques da
 * janela) e não conhece o total; quem conhece é quem guarda. No Firestore isso
 * era `increment(n)`. Numa fusão de JSON crua o pedaço SUBSTITUIRIA o
 * acumulado, e quem passou três horas no app apareceria com "30 segundos".
 *
 * Estes testes travam a soma, inclusive dentro dos mapas aninhados (cliques por
 * botão, segundos por página) — é lá que o erro passaria despercebido, porque
 * o número continua parecendo plausível.
 */
import { describe, expect, it } from 'vitest';
import { fundirParaTeste as fundir } from './telemetry.repository.js';

describe('fusão da telemetria', () => {
  it('SOMA o que vem marcado como incremento', () => {
    const saida = fundir({ totalSeconds: 3600 }, { totalSeconds: { __inc: 30 } });
    expect(saida.totalSeconds).toBe(3630);
  });

  it('parte do zero quando o campo ainda não existe', () => {
    expect(fundir({}, { totalSeconds: { __inc: 30 } }).totalSeconds).toBe(30);
  });

  it('SUBSTITUI o que não é incremento (estado atual, não acumulado)', () => {
    const saida = fundir({ platform: 'Windows', libraryCount: 10 }, { libraryCount: 4416 });
    expect(saida.libraryCount).toBe(4416);
    expect(saida.platform).toBe('Windows');
  });

  it('soma DENTRO dos mapas aninhados, sem trocar o mapa inteiro', () => {
    // O erro que este teste existe para impedir: a janela atual só teve clique
    // em "tocar", e o mapa inteiro seria substituído — "curtir" zeraria.
    const saida = fundir(
      { clickCounts: { tocar: 100, curtir: 42 } },
      { clickCounts: { tocar: { __inc: 3 } } },
    );
    expect(saida.clickCounts).toEqual({ tocar: 103, curtir: 42 });
  });

  it('mapa novo entra inteiro', () => {
    const saida = fundir({}, { pageSeconds: { inicio: { __inc: 12 } } });
    expect(saida.pageSeconds).toEqual({ inicio: 12 });
  });

  it('não confunde um número solto com incremento', () => {
    // `{ __inc }` é a marca; um número cru é estado e deve substituir.
    expect(fundir({ sessions: 9 }, { sessions: 1 }).sessions).toBe(1);
  });

  it('ignora incremento com valor inválido em vez de gravar NaN', () => {
    const saida = fundir({ totalSeconds: 100 }, { totalSeconds: { __inc: Number.NaN } });
    // NaN atravessaria o JSON como null e apagaria o acumulado.
    expect(saida.totalSeconds).toEqual({ __inc: Number.NaN });
  });

  it('preserva as chaves antigas que o pedaço não menciona', () => {
    const saida = fundir(
      { platform: 'Android', totalSeconds: 10, topArtists: [{ name: 'Matuê', plays: 3 }] },
      { totalSeconds: { __inc: 5 } },
    );
    expect(saida.platform).toBe('Android');
    expect(saida.topArtists).toEqual([{ name: 'Matuê', plays: 3 }]);
  });
});
