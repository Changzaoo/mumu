/**
 * O RÁDIO CONTINUA A FILA DEPOIS QUE A PESSOA GUARDA O TELEFONE.
 *
 * Isso é o que torna este arquivo diferente de um teste de recomendação. Numa
 * prateleira, quem escolhe é a pessoa; aqui, ela pôs UMA música e o resto é
 * decisão nossa. Então o que entra na fila é responsabilidade inteira do app.
 *
 * O defeito real: o poço de candidatas era "mesmo artista, mesmo gênero, e
 * depois A BIBLIOTECA INTEIRA". Os dois primeiros acabam rápido — na prática
 * quem enchia a fila era o terceiro, que não olhava gênero nenhum.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

const biblioteca: TrackDto[] = [];
const vereditos = new Map<string, 'limpo' | 'explicito'>();

vi.mock('@/lib/local/localLibrary', () => ({
  artistTracks: (nome: string) =>
    biblioteca.filter((t) => t.artists?.[0]?.name?.toLowerCase() === nome.toLowerCase()),
  genreTracks: (g: string) => biblioteca.filter((t) => t.genre === g),
  // O veredito desce na ENTRADA, não na faixa: a listagem manda
  // `conteudoVeredicto` e remove `track.explicit`. Ver radio.ts.
  list: () =>
    biblioteca.map((track) => ({
      track,
      ...(vereditos.get(track.id) ? { conteudoVeredicto: vereditos.get(track.id) } : {}),
    })),
}));

// Sem vetores de embedding o caminho semântico devolve pouco e o heurístico
// assume — que é o caminho que roda na esmagadora maioria dos aparelhos.
vi.mock('../semanticMixes', () => ({ similarTo: () => [] }));

const { construirRadio } = await import('../radio');

function faixa(
  id: string,
  artista: string,
  genre: string | null,
  conteudo?: 'limpo' | 'explicito',
): TrackDto {
  if (conteudo) vereditos.set(id, conteudo);
  return {
    id,
    title: id,
    artists: [{ id: artista, name: artista }],
    genre,
  } as unknown as TrackDto;
}

describe('construirRadio — a fronteira que não pode vazar', () => {
  beforeEach(() => {
    biblioteca.length = 0;
    vereditos.clear();
  });

  it('UM LOUVOR NUNCA É SEGUIDO DE FUNK', () => {
    // O caso que motivou tudo isto. Antes, as faixas de funk entravam pelo
    // terceiro nível do poço e enchiam a fila inteira.
    const louvor = faixa('l1', 'Ministério', 'Gospel', 'limpo');
    biblioteca.push(
      louvor,
      faixa('l2', 'Ministério', 'Gospel', 'limpo'),
      faixa('f1', 'MC X', 'Funk', 'explicito'),
      faixa('f2', 'MC Y', 'Funk', 'limpo'),
      faixa('t1', 'Rapper', 'Trap', 'explicito'),
    );

    const fila = construirRadio(louvor, 40);

    expect(fila.map((t) => t.id)).toEqual(['l2']);
  });

  it('num rádio de louvor, faixa sem gênero fica de fora', () => {
    // Faixa sem categoria pode ser qualquer coisa. Aqui a dúvida resolve
    // CONTRA entrar — ao contrário do resto do app.
    const louvor = faixa('l1', 'Ministério', 'Gospel', 'limpo');
    biblioteca.push(louvor, faixa('x1', 'Alguém', null, 'limpo'));

    expect(construirRadio(louvor, 40)).toEqual([]);
  });

  it('num rádio de louvor, gospel de conteúdo DESCONHECIDO fica de fora', () => {
    // Mesmo gênero não basta: sem letra conferida não sabemos o que tem nela, e
    // "não sei" não é "está limpo".
    const louvor = faixa('l1', 'Ministério', 'Gospel', 'limpo');
    biblioteca.push(louvor, faixa('l9', 'Outro Ministério', 'Gospel'));

    expect(construirRadio(louvor, 40)).toEqual([]);
  });

  it('RÁDIO CURTO É ACEITÁVEL; RÁDIO OFENSIVO NÃO', () => {
    // A consequência assumida: sem candidata da mesma família, a fila acaba.
    // Preferimos isso a completá-la com o que estiver por perto.
    const louvor = faixa('l1', 'Ministério', 'Gospel', 'limpo');
    biblioteca.push(louvor, faixa('f1', 'MC X', 'Funk', 'limpo'));

    expect(construirRadio(louvor, 40)).toEqual([]);
  });

  it('fora das famílias sensíveis o rádio segue generoso', () => {
    // A regra não pode virar um app que nunca recomenda nada: rock puxa metal,
    // e faixa sem categoria (o caso comum de importação própria) entra.
    const rock = faixa('r1', 'Banda', 'Rock', 'limpo');
    biblioteca.push(
      rock,
      faixa('r2', 'Banda', 'Rock', 'limpo'),
      faixa('m1', 'Outra', 'Metal', 'limpo'),
      faixa('s1', 'Sertanejo Aí', 'Sertanejo', 'limpo'),
      faixa('sem', 'Importada', null),
    );

    const ids = construirRadio(rock, 40).map((t) => t.id);

    expect(ids).toContain('r2');
    expect(ids).toContain('m1');
    expect(ids).not.toContain('s1');
  });

  it('faixa sem gênero entra só se o ARTISTA dela é da mesma família', () => {
    // "Sem categoria" não quer dizer "combina": era por aí que o acervo inteiro
    // vazava para a rádio de quem ouvia outra coisa.
    const rock = faixa('r1', 'Banda', 'Rock', 'limpo');
    biblioteca.push(
      rock,
      faixa('semRock', 'Roqueiro', null),
      faixa('outraRock', 'Roqueiro', 'Rock', 'limpo'),
      faixa('semTrap', 'Trapper', null),
      faixa('outraTrap', 'Trapper', 'Trap', 'limpo'),
      faixa('semNada', 'Desconhecido', null),
    );

    const ids = construirRadio(rock, 40).map((t) => t.id);

    expect(ids).toContain('semRock');
    expect(ids).not.toContain('semTrap');
    expect(ids).not.toContain('semNada');
  });

  it('MÚSICA ANTIGA SEM GÊNERO NÃO VIRA TRAP: a âncora vem do artista', () => {
    // O caso relatado: a pessoa pôs uma música antiga (importada, sem gênero)
    // e a continuação tocou trap. Sem gênero na semente, valia tudo.
    const antiga = faixa('a1', 'Cantor Antigo', null, 'limpo');
    biblioteca.push(
      antiga,
      faixa('a2', 'Cantor Antigo', 'MPB', 'limpo'),
      faixa('mpb1', 'Outra Voz', 'MPB', 'limpo'),
      faixa('t1', 'Rapper', 'Trap', 'limpo'),
      faixa('t2', 'Rapper 2', 'Trap', 'limpo'),
    );

    const ids = construirRadio(antiga, 40, { generoDoGosto: () => 'Trap' }).map((t) => t.id);

    expect(ids).toEqual(expect.arrayContaining(['a2', 'mpb1']));
    expect(ids).not.toContain('t1');
    expect(ids).not.toContain('t2');
  });

  it('sem gênero nem artista conhecido, a âncora é o que tocou antes', () => {
    const solta = faixa('s0', 'Ninguém', null, 'limpo');
    const antes = [faixa('p1', 'X', 'MPB', 'limpo'), faixa('p2', 'Y', 'MPB', 'limpo')];
    biblioteca.push(
      solta,
      ...antes,
      faixa('mpb9', 'Z', 'MPB', 'limpo'),
      faixa('t1', 'R', 'Trap', 'limpo'),
    );

    const ids = construirRadio(solta, 40, { vizinhas: antes, generoDoGosto: () => 'Trap' }).map(
      (t) => t.id,
    );

    expect(ids).toContain('mpb9');
    expect(ids).not.toContain('t1');
  });

  it('por último vale o gosto DESTA conta — nunca o acervo inteiro', () => {
    const solta = faixa('s0', 'Ninguém', null, 'limpo');
    biblioteca.push(solta, faixa('sa1', 'A', 'Samba', 'limpo'), faixa('t1', 'R', 'Trap', 'limpo'));

    const ids = construirRadio(solta, 40, { generoDoGosto: () => 'Samba' }).map((t) => t.id);

    expect(ids).toEqual(['sa1']);
  });

  it('NUNCA MAIS QUE DUAS SEGUIDAS DO MESMO ARTISTA — um álbum não vira "álbum de novo"', () => {
    // O caso que motiva isto: um álbum inteiro de um artista está na
    // biblioteca. Sem intercalar, a "rádio" que emenda o fim do álbum seria
    // esse MESMO artista de novo, faixa após faixa — o oposto de "parecidas".
    const seed = faixa('seed', 'Dominante', 'Rock', 'limpo');
    biblioteca.push(seed);
    for (let i = 0; i < 6; i++) biblioteca.push(faixa(`m${i}`, 'Dominante', 'Rock', 'limpo'));
    for (let i = 0; i < 4; i++) biblioteca.push(faixa(`v${i}`, 'Variado', 'Rock', 'limpo'));

    const fila = construirRadio(seed, 40);

    for (let i = 0; i + 2 < fila.length; i++) {
      const trio = [fila[i]!, fila[i + 1]!, fila[i + 2]!].map((t) => t.artists?.[0]?.name);
      expect(new Set(trio).size).toBeGreaterThan(1);
    }
  });
});
