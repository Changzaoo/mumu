import { podeOuvir } from '@/lib/conteudo/faixaEtaria';
/**
 * RÁDIO DE UMA FAIXA — quando você põe UMA música pra tocar, a fila não morre
 * depois dela.
 *
 * Tocar uma faixa solta (sem álbum, sem playlist) deixava a barra em silêncio no
 * fim dos 3 minutos. Aqui a gente monta uma continuação de "parecidas" a partir
 * do que já existe na biblioteca do usuário:
 *
 *  1) SEMÂNTICO primeiro: se houver vetores (embeddings) da semente e do acervo,
 *     ranqueia por proximidade real de som (`similarTo`).
 *  2) HEURÍSTICO sempre disponível: mesmo artista + mesmo gênero, com ordem do
 *     dia e teto por artista pra não virar um álbum só. Funciona offline e sem IA.
 *
 * A lista alimenta também o download em segundo plano (o guardião offline baixa
 * o que vem a seguir), então "escutar música por música" já vai puxando as
 * próximas sem a pessoa pedir.
 */
import {
  familiaDoGenero,
  podemConviver,
  type VeredictoDeConteudo,
  type TrackDto,
} from '@radinho/shared';
import * as localHistory from '@/lib/local/localHistory';
import * as localLikes from '@/lib/local/localLikes';
import { perfilDeGosto } from './perfilDeGosto';
import * as localLibrary from '@/lib/local/localLibrary';
import { similarTo } from './semanticMixes';
import { daySeed, seededShuffle } from './recommend';
import { comVariedade } from './variedadeDeArtista';

function nomeArtista(t: TrackDto): string {
  return t.artists?.[0]?.name ?? '';
}
function chaveArtista(t: TrackDto): string {
  return nomeArtista(t).toLowerCase().trim();
}

/** Teto por artista na rádio: parecida não é a discografia de um só. */
const MAX_POR_ARTISTA = 4;

/**
 * O veredito de conteúdo vive na ENTRADA da biblioteca, não na faixa.
 *
 * A listagem do acervo não pode carregar a análise inteira (categorias, termos
 * achados, versão do léxico): são ~95 bytes × 5.057, quase meio MB — um terço
 * de tudo o que foi tirado do celular quando a listagem emagreceu. Ela manda só
 * o veredito, em `conteudoVeredicto`, e só quando ele é conhecido. Ausente =
 * desconhecido, e desconhecido NÃO é limpo — ver `conteudoExplicito`.
 *
 * `track.explicit` não serve para isto: ele está em `CAMPOS_MORTOS_DA_FAIXA` e
 * a listagem o remove, então chegaria sempre `false` — que é exatamente a
 * mentira que este sistema veio desfazer.
 */
function vereditosPorFaixa(): Map<string, VeredictoDeConteudo> {
  const mapa = new Map<string, VeredictoDeConteudo>();
  for (const e of localLibrary.list()) {
    const v = (e as { conteudoVeredicto?: VeredictoDeConteudo }).conteudoVeredicto;
    if (v) mapa.set(e.track.id, v);
  }
  return mapa;
}

/** Gênero mais frequente de um conjunto de faixas (ignorando as sem gênero). */
function generoDominante(faixas: readonly TrackDto[]): string | null {
  const conta = new Map<string, number>();
  for (const t of faixas) if (t.genre) conta.set(t.genre, (conta.get(t.genre) ?? 0) + 1);
  let melhor: string | null = null;
  let max = 0;
  for (const [g, n] of conta) if (n > max) [melhor, max] = [g, n];
  return melhor;
}

/** O gênero que ESTA conta mais ouve — nunca o de outra pessoa do aparelho. */
function generoDoGostoDaConta(): string | null {
  const perfil = perfilDeGosto({
    historico: localHistory.listForCurrentUser(),
    curtidas: localLikes.list(),
  });
  let melhor: string | null = null;
  let max = 0;
  for (const [chave, peso] of perfil.porGenero) {
    if (peso > max) [melhor, max] = [perfil.nomeDoGenero.get(chave) ?? chave, peso];
  }
  return melhor;
}

export interface OpcoesDaRadio {
  /** O que tocou logo antes (a fila): diz o clima da sessão quando a semente não diz. */
  vizinhas?: readonly TrackDto[];
  /** Só para testes: o gênero que a conta mais ouve. */
  generoDoGosto?: () => string | null;
}

/**
 * O GÊNERO-ÂNCORA da rádio.
 *
 * Semente sem gênero (música antiga importada quase nunca vem com categoria)
 * liberava QUALQUER gênero: `podemConviver` não tem fronteira a defender sem
 * família, e o acervo — dominado por trap — enchia a fila. Quem ouvia MPB dos
 * anos 70 recebia trap "do nada". Agora a âncora vem, nesta ordem, da própria
 * faixa, do que o ARTISTA dela costuma ser, do que a pessoa acabou de ouvir, e
 * por fim do gosto DA CONTA dela. O acervo inteiro nunca é a resposta.
 */
function generoAncora(seed: TrackDto, opcoes: OpcoesDaRadio): string | null {
  if (seed.genre) return seed.genre;
  const artista = nomeArtista(seed);
  return (
    (artista ? generoDominante(localLibrary.artistTracks(artista)) : null) ??
    generoDominante(opcoes.vizinhas ?? []) ??
    (opcoes.generoDoGosto ?? generoDoGostoDaConta)()
  );
}

export function construirRadio(
  seed: TrackDto,
  limite = 40,
  opcoes: OpcoesDaRadio = {},
): TrackDto[] {
  const seedArtista = nomeArtista(seed);
  const ancora = generoAncora(seed, opcoes);
  const familiaAncora = familiaDoGenero(ancora);

  const doArtista = seedArtista ? localLibrary.artistTracks(seedArtista) : [];
  const doGenero = ancora ? localLibrary.genreTracks(ancora) : [];
  const biblioteca = localLibrary.list().map((e) => e.track);

  // A família de cada ARTISTA (pelo gênero que as faixas dele têm): é o que
  // decide sobre uma faixa sem gênero — "sem categoria" não quer dizer "combina".
  const familiaDoArtista = new Map<string, ReturnType<typeof familiaDoGenero>>();
  {
    const porArtista = new Map<string, TrackDto[]>();
    for (const t of biblioteca) {
      const k = chaveArtista(t);
      if (!k || !t.genre) continue;
      const lista = porArtista.get(k);
      if (lista) lista.push(t);
      else porArtista.set(k, [t]);
    }
    for (const [k, faixas] of porArtista)
      familiaDoArtista.set(k, familiaDoGenero(generoDominante(faixas)));
  }

  // Poço em NÍVEIS, sem a própria semente: mesmo artista > mesmo gênero >
  // mesma família. O antigo terceiro nível — "a biblioteca inteira" — não
  // existe mais: é por ele que o gosto de uma pessoa virava o do acervo.
  const veredictos = vereditosPorFaixa();
  const paraConvivencia = (t: TrackDto) => ({
    genero: t.genre ?? null,
    conteudo: veredictos.get(t.id) ?? null,
  });
  const semente = { genero: ancora, conteudo: veredictos.get(seed.id) ?? null };
  const mesmaFamilia = (t: TrackDto): boolean => {
    if (familiaAncora === null) return false;
    const f = familiaDoGenero(t.genre) ?? familiaDoArtista.get(chaveArtista(t)) ?? null;
    return f === familiaAncora;
  };
  const vistos = new Set<string>([seed.id]);
  const pool: TrackDto[] = [];
  const nivelDe = new Map<string, number>();
  const niveis: [number, readonly TrackDto[]][] = [
    [0, doArtista],
    [1, doGenero],
    [2, biblioteca.filter(mesmaFamilia)],
  ];
  for (const [nivel, grupo] of niveis) {
    for (const t of grupo) {
      if (vistos.has(t.id)) continue;
      // Faixa SEM gênero de OUTRO artista só entra se o artista dela é da
      // família da âncora (o nível 2 já cuidou disso).
      if (nivel === 1 && !t.genre) continue;
      if (!podemConviver(semente, paraConvivencia(t))) continue;
      // Idade × conteúdo: a rádio nunca sugere o que esta pessoa não pode ouvir.
      if (!podeOuvir(t)) continue;
      vistos.add(t.id);
      pool.push(t);
      nivelDe.set(t.id, nivel);
    }
  }
  if (pool.length === 0) return [];

  // 1) Semântico — só quando há vetores suficientes (senão devolve pouco/nada).
  const semantico = similarTo(seed, pool, limite);
  if (semantico.length >= Math.min(8, pool.length)) {
    // O ranking semântico não sabe nada de "quantas seguidas" — sem esta
    // passada, um acervo com muitas faixas próximas do MESMO artista emendava
    // álbum com álbum, e a "rádio" virava só mais do mesmo artista.
    return comVariedade(semantico, semantico.length);
  }

  // 2) Heurístico: mesmo artista primeiro, depois gênero/resto; teto por artista.
  const dia = daySeed();
  const mesmoArtista = seededShuffle(
    pool.filter((t) => chaveArtista(t) === chaveArtista(seed)),
    dia,
  );
  // O resto EM ORDEM DE NÍVEL (mesmo gênero antes de só mesma família);
  // embaralhado só dentro de cada nível. Embaralhar tudo junto apagava a
  // afinidade: a faixa de outro gênero da família valia o mesmo que a do gênero.
  const outros = pool.filter((t) => chaveArtista(t) !== chaveArtista(seed));
  const resto = [1, 2, 0].flatMap((nivel) =>
    seededShuffle(
      outros.filter((t) => nivelDe.get(t.id) === nivel),
      (dia ^ (0x9e3779b9 + nivel)) >>> 0,
    ),
  );

  const usados = new Map<string, number>();
  const out: TrackDto[] = [];
  const empurrar = (t: TrackDto): boolean => {
    const k = chaveArtista(t);
    const c = usados.get(k) ?? 0;
    if (k && c >= MAX_POR_ARTISTA) return false;
    usados.set(k, c + 1);
    out.push(t);
    return true;
  };

  // Metade pode vir do mesmo artista (o mais "parecido"); o resto diversifica.
  for (const t of mesmoArtista) {
    if (out.length >= Math.ceil(limite / 2)) break;
    empurrar(t);
  }
  for (const t of resto) {
    if (out.length >= limite) break;
    empurrar(t);
  }
  // Se o teto barrou demais (biblioteca de poucos artistas), completa sem teto.
  if (out.length < Math.min(limite, pool.length)) {
    const jaTem = new Set(out.map((t) => t.id));
    for (const t of [...mesmoArtista, ...resto]) {
      if (jaTem.has(t.id)) continue;
      out.push(t);
      jaTem.add(t.id);
      if (out.length >= limite) break;
    }
  }
  // MAX_POR_ARTISTA (acima) só limita o TOTAL de um artista na lista inteira;
  // não impede duas seguidas logo no começo, que é exatamente o corte que se
  // percebe quando um álbum termina e "a continuação" é o próprio artista de
  // novo. `comVariedade` intercala sem tirar ninguém da lista.
  return comVariedade(out.slice(0, limite), Math.min(limite, out.length));
}
