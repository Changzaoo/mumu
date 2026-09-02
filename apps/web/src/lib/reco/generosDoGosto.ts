/**
 * PRATELEIRAS DE GÊNERO QUE REAGEM AO GOSTO — não um despejo cru.
 *
 * A Home tinha um laço que renderizava um carrossel POR GÊNERO com
 * `tracks.slice(0, 12)`: todos os gêneros, na ordem de tamanho, cada um com as
 * mesmas faixas de sempre. Do ponto de vista de quem usa, "do nada só aparecem
 * os gêneros e nada de diferente" — porque literalmente não havia nada de
 * diferente: sem gosto, sem variedade, sem rotação.
 *
 * Aqui o mesmo material vira prateleira de verdade:
 *  - ORDEM PELO GOSTO: o gênero que a pessoa mais ouve (plays com decaimento
 *    temporal + curtidas) vem primeiro; o tamanho da biblioteca é só desempate
 *    e base para quem ainda não tem histórico (cold start não fica vazio).
 *  - MENOS É MAIS: no máximo `maxGeneros` prateleiras — a Home deixa de ser uma
 *    parede infinita de gêneros.
 *  - VARIEDADE: dentro de cada gênero, embaralho DIÁRIO determinístico (muda a
 *    cada dia, igual entre recarregamentos do mesmo dia) e teto por artista, pra
 *    não ser o mesmo artista repetido nem a mesma vitrine de ontem.
 *
 * ── A CONTA DE AFINIDADE NÃO MORA MAIS AQUI ──
 *
 * Ela tinha uma cópia própria (meia-vida de 30 dias, curtida ×2) enquanto
 * `recommend.ts` usava outra (14 dias, ×3) e `faixasFavoritas.ts` uma terceira.
 * A Home ordenava as prateleiras por uma dessas e escrevia "porque você ouve"
 * por outra — duas respostas para a mesma pergunta na mesma tela. Agora todas
 * bebem de `lib/reco/perfilDeGosto`, e o que sobrou aqui é só o que é DAQUI: a
 * seleção das faixas de cada prateleira e a variedade delas.
 *
 * Puro e testável: recebe os dados, não lê store nem relógio por fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { daySeed, seededShuffle } from './recommend';
import { perfilDeGosto } from './perfilDeGosto';

export interface GrupoDeGenero {
  genre: string;
  tracks: TrackDto[];
}

export interface PrateleiraDeGenero {
  genre: string;
  tracks: TrackDto[];
  /** Legenda curta quando o gênero é claramente do gosto da pessoa. */
  motivo?: string;
}

/** FNV-1a: hash estável de string → semente por gênero (varia o embaralho). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function artistaChave(t: TrackDto): string {
  return (t.artists?.[0]?.name ?? '').toLowerCase().trim();
}

export function generosDoGosto(
  genres: readonly GrupoDeGenero[],
  history: readonly { track: TrackDto; playedAt?: string }[],
  liked: readonly TrackDto[],
  opts: {
    maxGeneros?: number;
    porGenero?: number;
    maxPorArtista?: number;
    now?: Date;
    /** Gêneros que a pessoa escolheu no onboarding (lib/local/gostoInicial). */
    sementes?: readonly string[];
  } = {},
): PrateleiraDeGenero[] {
  const maxGeneros = opts.maxGeneros ?? 8;
  const porGenero = opts.porGenero ?? 14;
  const maxPorArtista = opts.maxPorArtista ?? 3;

  // Fallback de gênero: faixa do histórico/curtida sem `genre` próprio herda o
  // do agrupamento da biblioteca (a mesma faixa, do mesmo id).
  const generoDaFaixa = new Map<string, string>();
  for (const g of genres) for (const t of g.tracks) generoDaFaixa.set(t.id, g.genre);

  const perfil = perfilDeGosto({
    historico: history,
    curtidas: liked,
    generoDaFaixa,
    sementesDeGenero: opts.sementes,
    now: opts.now,
  });

  const pontuados = genres.map((g) => {
    // Medida = comportamento; a diferença para a afinidade cheia é exatamente o
    // que a semente do onboarding está emprestando a este gênero hoje.
    const af = perfil.afinidadeMedida(g.genre);
    const sem = perfil.afinidadeDoGenero(g.genre) - af;
    // Base logarítmica pelo tamanho: garante ordem sensata no cold start sem
    // deixar um gênero gigante atropelar o gosto de quem já ouve.
    const base = Math.log2(g.tracks.length + 1) * 0.15;
    return { g, score: af + sem + base, af, sem };
  });
  pontuados.sort((a, b) => b.score - a.score);

  const dia = daySeed(opts.now ?? new Date());
  const out: PrateleiraDeGenero[] = [];
  for (const { g, af, sem } of pontuados.slice(0, maxGeneros)) {
    if (g.tracks.length === 0) continue;

    const alvo = Math.min(porGenero, g.tracks.length);
    const embaralhado = seededShuffle(g.tracks, (dia ^ hashStr(g.genre)) >>> 0);

    // Primeira passada: teto por artista, pra vitrine ter caras diferentes.
    const usados = new Map<string, number>();
    const escolha: TrackDto[] = [];
    const vistos = new Set<string>();
    for (const t of embaralhado) {
      const k = artistaChave(t);
      const c = usados.get(k) ?? 0;
      if (k && c >= maxPorArtista) continue;
      usados.set(k, c + 1);
      escolha.push(t);
      vistos.add(t.id);
      if (escolha.length >= alvo) break;
    }
    // Segunda passada: se o teto deixou a prateleira curta (gênero de poucos
    // artistas), completa com o resto sem duplicar.
    if (escolha.length < alvo) {
      for (const t of embaralhado) {
        if (vistos.has(t.id)) continue;
        escolha.push(t);
        vistos.add(t.id);
        if (escolha.length >= alvo) break;
      }
    }

    // O que a pessoa FAZ explica melhor que o que ela DISSE — por isso o motivo
    // de comportamento vem primeiro, e o da escolha só aparece enquanto a
    // semente ainda pesa mais que a afinidade medida daquele gênero.
    const forte = perfil.fatiaMedida(g.genre) >= 0.15;
    const motivo = forte
      ? 'Porque você ouve bastante'
      : sem > af
        ? 'Você escolheu ao entrar'
        : undefined;
    out.push({ genre: g.genre, tracks: escolha, motivo });
  }
  return out;
}
