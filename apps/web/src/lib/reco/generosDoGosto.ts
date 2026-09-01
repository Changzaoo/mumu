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
 * Puro e testável: recebe os dados, não lê store nem relógio por fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { daySeed, seededShuffle } from './recommend';

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

/** Meia-vida do play: um play de 30 dias atrás vale metade de um de hoje. */
const MEIA_VIDA_MS = 30 * 24 * 60 * 60 * 1000;
/** Curtir é sinal forte de gosto — vale vários plays. */
const BONUS_CURTIDA = 2;

/**
 * O QUE VALE A ESCOLHA DO ONBOARDING, E COMO ELA É ESQUECIDA.
 *
 * `PESO_SEMENTE` é o peso do gênero escolhido quando não existe comportamento
 * nenhum. 6 fica acima de três curtidas (BONUS_CURTIDA = 2) e muito acima da
 * base logarítmica de tamanho — o suficiente para o que a pessoa escolheu
 * passar na frente do maior gênero do acervo, que é exatamente o problema do
 * primeiro dia.
 *
 * `MEIA_FORCA_SEMENTE` é a massa de comportamento real que corta esse peso pela
 * metade: ~10 equivale a uma dezena de plays recentes ou cinco curtidas. O
 * decaimento é suave e nunca chega a zero de vez, então a escolha continua
 * desempatando gêneros parecidos muito depois de ter deixado de mandar.
 *
 * Isto é o que separa um PALPITE de uma CONFIGURAÇÃO: quem escolheu "rock" ao
 * entrar e passa um mês ouvindo samba vê samba, sem precisar achar uma tela de
 * ajuste para se corrigir.
 */
const PESO_SEMENTE = 6;
const MEIA_FORCA_SEMENTE = 10;

/** Gêneros vêm da mesma biblioteca, mas comparar sem caixa evita que uma
 *  diferença de maiúscula faça a escolha da pessoa não casar com nada. */
function chaveGenero(g: string): string {
  return g.toLowerCase().trim();
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
  const now = (opts.now ?? new Date()).getTime();

  // Fallback de gênero: faixa do histórico/curtida sem `genre` próprio herda o
  // do agrupamento da biblioteca (a mesma faixa, do mesmo id).
  const generoDaFaixa = new Map<string, string>();
  for (const g of genres) for (const t of g.tracks) generoDaFaixa.set(t.id, g.genre);

  const afinidade = new Map<string, number>();
  for (const h of history) {
    const g = h.track.genre ?? generoDaFaixa.get(h.track.id);
    if (!g) continue;
    const idade = h.playedAt ? now - new Date(h.playedAt).getTime() : MEIA_VIDA_MS;
    const peso = Math.pow(0.5, Math.max(0, idade) / MEIA_VIDA_MS);
    afinidade.set(g, (afinidade.get(g) ?? 0) + peso);
  }
  for (const t of liked) {
    const g = t.genre ?? generoDaFaixa.get(t.id);
    if (!g) continue;
    afinidade.set(g, (afinidade.get(g) ?? 0) + BONUS_CURTIDA);
  }

  const totalAfin = [...afinidade.values()].reduce((a, b) => a + b, 0);

  // A semente entra DEPOIS da soma do comportamento real, e o seu peso é função
  // dessa soma — é assim que ela manda no dia zero e some sozinha depois.
  const escolhidos = new Set((opts.sementes ?? []).map(chaveGenero));
  const forcaDaSemente =
    escolhidos.size === 0 ? 0 : PESO_SEMENTE / (1 + totalAfin / MEIA_FORCA_SEMENTE);

  const pontuados = genres.map((g) => {
    const af = afinidade.get(g.genre) ?? 0;
    const sem = escolhidos.has(chaveGenero(g.genre)) ? forcaDaSemente : 0;
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
    const forte = totalAfin > 0 && af / totalAfin >= 0.15;
    const motivo = forte
      ? 'Porque você ouve bastante'
      : sem > af
        ? 'Você escolheu ao entrar'
        : undefined;
    out.push({ genre: g.genre, tracks: escolha, motivo });
  }
  return out;
}
