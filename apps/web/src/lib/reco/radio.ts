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
import { podemConviver, type VeredictoDeConteudo, type TrackDto } from '@aurial/shared';
import * as localLibrary from '@/lib/local/localLibrary';
import { similarTo } from './semanticMixes';
import { daySeed, seededShuffle } from './recommend';

function nomeArtista(t: TrackDto): string {
  return t.artists?.[0]?.name ?? '';
}
function chaveArtista(t: TrackDto): string {
  return nomeArtista(t).toLowerCase().trim();
}

/** Teto por artista na rádio: parecida não é a discografia de um só. */
const MAX_POR_ARTISTA = 4;

/**
 * O veredito de conteúdo que a faixa carrega, gravado pelo agente do servidor
 * (`conteudoDaFaixa.worker`). Ausente = desconhecido, e desconhecido NÃO é
 * limpo — ver `conteudoExplicito`.
 */
function conteudoDe(t: TrackDto): VeredictoDeConteudo | null {
  return (t as { conteudo?: { veredicto?: VeredictoDeConteudo } }).conteudo?.veredicto ?? null;
}

function paraConvivencia(t: TrackDto): {
  genero?: string | null;
  conteudo?: VeredictoDeConteudo | null;
} {
  return { genero: t.genre ?? null, conteudo: conteudoDe(t) };
}

export function construirRadio(seed: TrackDto, limite = 40): TrackDto[] {
  const seedArtista = nomeArtista(seed);
  const seedGenero = seed.genre ?? null;

  const doArtista = seedArtista ? localLibrary.artistTracks(seedArtista) : [];
  const doGenero = seedGenero ? localLibrary.genreTracks(seedGenero) : [];
  const biblioteca = localLibrary.list().map((e) => e.track);

  // Pool único, sem a própria semente, na ordem de afinidade grosseira
  // (artista > gênero > resto).
  // O TERCEIRO NÍVEL ERA A BIBLIOTECA INTEIRA, SEM OLHAR GÊNERO.
  //
  // Era ele que enchia a fila na prática — os dois primeiros acabam rápido — e
  // era por ele que um louvor podia ser seguido de funk com palavrão, sem a
  // pessoa ter pedido nada. O filtro abaixo é a única porta: vale para o poço
  // inteiro, então protege também o caminho semântico logo adiante, que
  // ranqueia SOBRE este mesmo poço.
  const semente = paraConvivencia(seed);
  const vistos = new Set<string>([seed.id]);
  const pool: TrackDto[] = [];
  for (const grupo of [doArtista, doGenero, biblioteca]) {
    for (const t of grupo) {
      if (vistos.has(t.id)) continue;
      vistos.add(t.id);
      if (!podemConviver(semente, paraConvivencia(t))) continue;
      pool.push(t);
    }
  }
  if (pool.length === 0) return [];

  // 1) Semântico — só quando há vetores suficientes (senão devolve pouco/nada).
  const semantico = similarTo(seed, pool, limite);
  if (semantico.length >= Math.min(8, pool.length)) return semantico;

  // 2) Heurístico: mesmo artista primeiro, depois gênero/resto; teto por artista.
  const dia = daySeed();
  const mesmoArtista = seededShuffle(
    pool.filter((t) => chaveArtista(t) === chaveArtista(seed)),
    dia,
  );
  const resto = seededShuffle(
    pool.filter((t) => chaveArtista(t) !== chaveArtista(seed)),
    (dia ^ 0x9e3779b9) >>> 0,
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
  return out.slice(0, limite);
}
