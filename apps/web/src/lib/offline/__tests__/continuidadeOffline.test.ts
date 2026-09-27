/**
 * A CONTINUAÇÃO OFFLINE PRECISA FAZER SENTIDO — mesmo artista antes de
 * parecido, parecido antes de mesmo gênero, gênero antes de gênero vizinho;
 * curtida e play sobem; recém-tocada desce; nunca uma sequência longa do
 * mesmo artista; e nunca uma faixa que não está em `disponiveis`.
 *
 * `montarContinuidadeOffline` é pura: sem isto os testes exercitariam módulo
 * (localStorage, IndexedDB) em vez da regra em si.
 */
import { describe, expect, it } from 'vitest';
import {
  montarContinuidadeOffline,
  type EntradaHistoricoOffline,
} from '@/lib/offline/continuidadeOffline';
import { makeTrack } from '@/test/factories';

const AGORA = new Date('2026-06-01T12:00:00.000Z');

function faixa(
  id: string,
  artista: string,
  genero: string | null = null,
): ReturnType<typeof makeTrack> {
  return makeTrack(id, {
    artists: [{ id: `art-${artista}`, name: artista, slug: artista, imageUrl: null }],
    genre: genero,
  });
}

function playedAt(diasAtras: number): string {
  return new Date(AGORA.getTime() - diasAtras * 86_400_000).toISOString();
}

describe('montarContinuidadeOffline — critério de ranking', () => {
  it('mesmo artista da faixa atual vem primeiro', () => {
    const atual = faixa('seed', 'Djavan', 'MPB');
    const mesmoArtista = faixa('a', 'Djavan', 'MPB');
    const outroArtista = faixa('b', 'Marisa Monte', 'MPB');
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [outroArtista, mesmoArtista],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('a');
  });

  it('artista PARECIDO (sinal semântico) vem antes de mesmo gênero simples', () => {
    const atual = faixa('seed', 'Djavan', 'MPB');
    const parecido = faixa('p', 'Gilberto Gil', 'MPB');
    const mesmoGeneroSo = faixa('g', 'Alguém Qualquer', 'MPB');
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [mesmoGeneroSo, parecido],
      historico: [],
      curtidas: [],
      parecidos: new Set(['p']),
      now: AGORA,
    });
    expect(out[0]!.id).toBe('p');
    expect(out[1]!.id).toBe('g');
  });

  it('mesmo gênero vem antes de gênero vizinho (mesma família)', () => {
    const atual = faixa('seed', 'X', 'Samba');
    const mesmoGenero = faixa('a', 'Y', 'Samba');
    const vizinho = faixa('b', 'Z', 'Pagode'); // mesma família que Samba
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [vizinho, mesmoGenero],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('a');
    expect(out[1]!.id).toBe('b');
  });

  it('gênero vizinho ainda entra na frente de algo sem relação nenhuma', () => {
    const atual = faixa('seed', 'X', 'Samba');
    const vizinho = faixa('viz', 'Z', 'Axé'); // mesma família que Samba
    const semRelacao = faixa('sem', 'W', 'Rock');
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [semRelacao, vizinho],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('viz');
  });

  it('curtida sobe a faixa mesmo sem relação de artista/gênero com a atual', () => {
    const atual = faixa('seed', 'X', 'Rock');
    const curtida = faixa('c', 'Alguém', 'Jazz');
    const semNada = faixa('n', 'Outro', 'Jazz');
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [semNada, curtida],
      historico: [],
      curtidas: [curtida],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('c');
  });

  it('play recorrente no histórico sobe a afinidade do artista', () => {
    const atual = null;
    const favorita = faixa('f', 'Preferido', 'Pop');
    const desconhecida = faixa('d', 'Nunca Ouvi', 'Pop');
    const historico: EntradaHistoricoOffline[] = Array.from({ length: 5 }, (_, i) => ({
      track: faixa(`h${i}`, 'Preferido', 'Pop'),
      playedAt: playedAt(1 + i),
    }));
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [desconhecida, favorita],
      historico,
      curtidas: [],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('f');
  });

  it('faixa tocada há pouco desce, mas não desaparece se não houver mais nada', () => {
    const atual = faixa('seed', 'X', 'Rock');
    const recente = faixa('r', 'X', 'Rock'); // mesmo artista, mas tocou há 5 posições
    const historico: EntradaHistoricoOffline[] = [
      { track: faixa('outra1', 'Y', 'Rock'), playedAt: playedAt(0) },
      { track: faixa('outra2', 'Y', 'Rock'), playedAt: playedAt(0) },
      { track: faixa('outra3', 'Y', 'Rock'), playedAt: playedAt(0) },
      { track: recente, playedAt: playedAt(0) },
    ];
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [recente],
      historico,
      curtidas: [],
      now: AGORA,
    });
    expect(out.map((t) => t.id)).toEqual(['r']);
  });

  it('faixa que acabou de tocar (janela de exclusão) some da lista', () => {
    const atual = faixa('seed', 'X', 'Rock');
    const acabouDeTocar = faixa('recem', 'X', 'Rock');
    const historico: EntradaHistoricoOffline[] = [{ track: acabouDeTocar, playedAt: playedAt(0) }];
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [acabouDeTocar],
      historico,
      curtidas: [],
      now: AGORA,
    });
    expect(out).toEqual([]);
  });

  it('nunca mais que duas faixas seguidas do mesmo artista', () => {
    const atual = faixa('seed', 'Dominante', 'Rock');
    const doMesmo = Array.from({ length: 6 }, (_, i) => faixa(`m${i}`, 'Dominante', 'Rock'));
    const doOutro = Array.from({ length: 3 }, (_, i) => faixa(`o${i}`, 'Variado', 'Rock'));
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [...doMesmo, ...doOutro],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    for (let i = 0; i + 2 < out.length; i++) {
      const trio = [out[i]!, out[i + 1]!, out[i + 2]!].map((t) => t.artists[0]?.name);
      expect(new Set(trio).size).toBeGreaterThan(1);
    }
  });

  it('só entram faixas que estavam em `disponiveis` — nunca a atual, nunca de fora', () => {
    const atual = faixa('seed', 'X', 'Rock');
    const disponivel = faixa('d', 'X', 'Rock');
    const out = montarContinuidadeOffline({
      atual,
      disponiveis: [atual, disponivel],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    expect(out.map((t) => t.id)).toEqual(['d']);
  });

  it('nada disponível no aparelho: lista vazia, sem quebrar', () => {
    const out = montarContinuidadeOffline({
      atual: faixa('seed', 'X', 'Rock'),
      disponiveis: [],
      historico: [],
      curtidas: [],
      now: AGORA,
    });
    expect(out).toEqual([]);
  });

  it('sem faixa atual de referência, ainda ordena por favoritismo (curtida)', () => {
    const curtida = faixa('c', 'Alguém', 'Pop');
    const outra = faixa('o', 'Outro', 'Pop');
    const out = montarContinuidadeOffline({
      atual: null,
      disponiveis: [outra, curtida],
      historico: [],
      curtidas: [curtida],
      now: AGORA,
    });
    expect(out[0]!.id).toBe('c');
  });
});
