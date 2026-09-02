/**
 * AS RAMIFICAÇÕES DO GÊNERO CAMPEÃO.
 *
 * O pedido: quem ouve muito Gospel abre o app em Gospel, e logo abaixo vêm as
 * ramificações de Gospel — não o próximo assunto. Estes testes travam as duas
 * metades disso: que os ramos SAEM quando há material, e que eles NÃO saem
 * quando não há (prateleira curta é pior que prateleira ausente).
 *
 * O teste do gospel sem vizinho é o mais importante do arquivo: a família
 * `devocional` tem um membro só, e emendar louvor em qualquer outra coisa é
 * exatamente o erro que `podemConviver` existe para impedir no rádio. A
 * ramificação não pode reintroduzi-lo por uma porta diferente.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import { makeTrack } from '@/test/factories';
import { perfilDeGosto, type PlayObservado } from '@/lib/reco/perfilDeGosto';
import { ramificacoesDoGenero } from '@/lib/reco/ramificacoes';

const AGORA = new Date('2026-09-02T12:00:00.000Z');

function faixa(id: string, genero: string, artista: string): TrackDto {
  return makeTrack(id, {
    genre: genero,
    artists: [{ id: `a:${artista}`, name: artista, slug: '', imageUrl: null }],
  });
}

function play(track: TrackDto, diasAtras: number): PlayObservado {
  return { track, playedAt: new Date(AGORA.getTime() - diasAtras * 86_400_000).toISOString() };
}

/** Uma biblioteca de gospel com dois cantores, mais um punhado de rock. */
function bibliotecaGospel(): TrackDto[] {
  const fernandinho = Array.from({ length: 8 }, (_, i) => faixa(`f${i}`, 'Gospel', 'Fernandinho'));
  const gabriela = Array.from({ length: 8 }, (_, i) => faixa(`g${i}`, 'Gospel', 'Gabriela Rocha'));
  const rock = Array.from({ length: 6 }, (_, i) => faixa(`r${i}`, 'Rock', 'Banda Qualquer'));
  return [...fernandinho, ...gabriela, ...rock];
}

function ramosDe(
  biblioteca: TrackDto[],
  historico: PlayObservado[],
  genero = 'Gospel',
): ReturnType<typeof ramificacoesDoGenero> {
  const perfil = perfilDeGosto({ historico, curtidas: [], now: AGORA });
  return ramificacoesDoGenero({ genero, biblioteca, historico, perfil, now: AGORA });
}

describe('ramificações do gênero', () => {
  it('ramifica o gênero campeão em "mais ouve", artista e "para descobrir"', () => {
    const biblioteca = bibliotecaGospel();
    // Ouviu bastante Fernandinho; Gabriela ficou na biblioteca sem play.
    const historico = Array.from({ length: 8 }, (_, i) =>
      play(
        biblioteca.find((t) => t.id === `f${i}`)!,
        i,
      ),
    );

    const ramos = ramosDe(biblioteca, historico);
    const titulos = ramos.map((r) => r.titulo);

    expect(titulos).toContain('Gospel que você mais ouve');
    expect(titulos).toContain('Mais de Fernandinho');
    expect(titulos).toContain('Gospel para descobrir');
  });

  it('todo ramo diz por que está na tela', () => {
    const biblioteca = bibliotecaGospel();
    const historico = Array.from({ length: 8 }, (_, i) =>
      play(
        biblioteca.find((t) => t.id === `f${i}`)!,
        i,
      ),
    );
    for (const ramo of ramosDe(biblioteca, historico)) {
      expect(ramo.explicacao.length).toBeGreaterThan(0);
    }
  });

  it('mistura terreno seguro com exploração', () => {
    const biblioteca = bibliotecaGospel();
    const historico = Array.from({ length: 8 }, (_, i) =>
      play(
        biblioteca.find((t) => t.id === `f${i}`)!,
        i,
      ),
    );
    const tipos = new Set(ramosDe(biblioteca, historico).map((r) => r.tipo));
    expect(tipos.has('aproveitamento')).toBe(true);
    expect(tipos.has('exploracao')).toBe(true);
  });

  it('gospel NÃO ganha ramo de vizinhos — a família devocional é só ele', () => {
    const biblioteca = bibliotecaGospel();
    const historico = Array.from({ length: 8 }, (_, i) =>
      play(
        biblioteca.find((t) => t.id === `f${i}`)!,
        i,
      ),
    );

    const ramos = ramosDe(biblioteca, historico);
    expect(ramos.some((r) => r.key.startsWith('ramo:familia:'))).toBe(false);
    // E nada de rock atravessando para dentro de um ramo de gospel.
    for (const ramo of ramos) {
      for (const t of ramo.tracks) expect(t.genre).toBe('Gospel');
    }
  });

  it('samba ganha ramo de vizinhos — pagode e axé convivem com ele', () => {
    const samba = Array.from({ length: 8 }, (_, i) => faixa(`s${i}`, 'Samba', 'Sambista'));
    const pagode = Array.from({ length: 6 }, (_, i) => faixa(`p${i}`, 'Pagode', 'Pagodeiro'));
    const historico = samba.slice(0, 6).map((t, i) => play(t, i));

    const ramos = ramosDe([...samba, ...pagode], historico, 'Samba');
    const vizinhos = ramos.find((r) => r.key.startsWith('ramo:familia:'));

    expect(vizinhos).toBeDefined();
    expect(vizinhos!.tracks.every((t) => t.genre === 'Pagode')).toBe(true);
  });

  it('"De volta" traz o que sumiu do rodízio, e só isso', () => {
    const biblioteca = bibliotecaGospel();
    const antigas = biblioteca.slice(0, 6).map((t) => play(t, 60));
    const recentes = biblioteca.slice(8, 14).map((t) => play(t, 1));

    const ramos = ramosDe(biblioteca, [...antigas, ...recentes]);
    const deVolta = ramos.find((r) => r.key.startsWith('ramo:de-volta:'));

    expect(deVolta).toBeDefined();
    const ids = new Set(deVolta!.tracks.map((t) => t.id));
    for (const antiga of antigas) expect(ids.has(antiga.track.id)).toBe(true);
    for (const recente of recentes) expect(ids.has(recente.track.id)).toBe(false);
  });

  it('ramo sem material suficiente não vira prateleira curta', () => {
    // Duas faixas de gospel: nada aqui alcança o mínimo de uma prateleira.
    const magra = [faixa('u1', 'Gospel', 'A'), faixa('u2', 'Gospel', 'B')];
    expect(ramosDe(magra, [play(magra[0]!, 1)])).toEqual([]);
  });

  it('gênero que não existe na biblioteca não produz ramo nenhum', () => {
    expect(ramosDe(bibliotecaGospel(), [], 'Reggaeton')).toEqual([]);
  });

  it('é estável dentro do mesmo dia — a vitrine não muda a cada recarga', () => {
    const biblioteca = bibliotecaGospel();
    const historico = Array.from({ length: 8 }, (_, i) =>
      play(
        biblioteca.find((t) => t.id === `f${i}`)!,
        i,
      ),
    );
    const primeira = ramosDe(biblioteca, historico);
    const segunda = ramosDe(biblioteca, historico);
    expect(segunda.map((r) => r.tracks.map((t) => t.id))).toEqual(
      primeira.map((r) => r.tracks.map((t) => t.id)),
    );
  });

  it('respeita o teto por artista quando há gente suficiente', () => {
    // Quatro cantores com cinco faixas cada: dá para variar sem repetir.
    const biblioteca = ['A', 'B', 'C', 'D'].flatMap((nome) =>
      Array.from({ length: 5 }, (_, i) => faixa(`${nome}${i}`, 'Gospel', `Cantor ${nome}`)),
    );
    const ramos = ramosDe(biblioteca, []);
    const descobrir = ramos.find((r) => r.key.startsWith('ramo:descobrir:'));

    expect(descobrir).toBeDefined();
    const porArtista = new Map<string, number>();
    for (const t of descobrir!.tracks.slice(0, 12)) {
      const nome = t.artists[0]!.name;
      porArtista.set(nome, (porArtista.get(nome) ?? 0) + 1);
    }
    for (const quantas of porArtista.values()) expect(quantas).toBeLessThanOrEqual(3);
  });
});
