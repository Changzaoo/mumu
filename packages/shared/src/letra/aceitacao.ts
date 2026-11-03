/**
 * A LETRA É DESTA MÚSICA? — a prova mínima para aceitar uma linha do LRCLIB (ou
 * de qualquer fonte com título/artista/duração) e a escolha da melhor entre as
 * candidatas. Pura: o navegador e os scripts Node usam a mesma régua.
 *
 * Regras (falta de prova é reprovação):
 *  1. O título tem de casar. Frouxo ("Warzone" ~ "Warzone (Remix)") só quando a
 *     DURAÇÃO confirma; sem duração para comparar, o título limpo tem de ser
 *     IGUAL — senão "Vida Loka, Pt. 2" aceitava a letra de "Vida Loka".
 *  2. Faixa instrumental (no título) não recebe letra de versão cantada, nem
 *     o contrário. As outras marcas de versão (remix, ao vivo, acústico…)
 *     ficam a cargo da duração; sem duração, a letra é só texto, e o texto da
 *     versão ao vivo é o mesmo. Entre candidatas, a mesma versão ganha.
 *  3. Artista conhecido dos dois lados e diferente: recusa. "MC" sozinho não é
 *     artista nenhum — nome genérico contido em outro não conta como igual.
 *  4. Duração conhecida dos dois lados e a mais de 3 s: recusa.
 *  5. E, no fim, ou o artista bate ou a duração bate.
 */
import { separarCreditos } from '../ai/creditosDeArtista.js';
import {
  contemPalavrasInteiras,
  limparTituloDaLetra,
  marcasDeVersao,
  normalizarParaComparar,
} from './normalizar.js';

export interface LrclibRow {
  id?: number | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean | null;
}

/** Folga de duração entre a faixa e a linha (segundos). */
export const FOLGA_DE_DURACAO_SEG = 3;

/** Palavras que, sozinhas, não identificam artista nenhum. */
const GENERICOS = new Set([
  'mc',
  'dj',
  'mr',
  'mrs',
  'ms',
  'lil',
  'the',
  'os',
  'as',
  'o',
  'a',
  'el',
  'la',
  'los',
  'las',
  'banda',
  'grupo',
  'trio',
  'duo',
  'feat',
  'ft',
  'e',
  'and',
  'with',
  'com',
  'y',
  'x',
  'part',
  'various',
  'artists',
  'artist',
  'varios',
  'artistas',
  'unknown',
  'desconhecido',
  'official',
  'oficial',
  'band',
  'orchestra',
  'orquestra',
  'coral',
  'coro',
]);

/** Créditos que equivalem a "não sei quem é". */
const SEM_ARTISTA = new Set([
  'desconhecido',
  'artista desconhecido',
  'unknown',
  'unknown artist',
  'various artists',
  'varios artistas',
  'va',
]);

const CONECTIVOS = new Set(['e', 'and', 'feat', 'ft', 'with', 'com', 'y', 'x', 'part']);

function temNucleo(nome: string): boolean {
  return nome
    .split(' ')
    .some((t) => !GENERICOS.has(t) && (t.length >= 2 || /[^\p{Script=Latin}\p{N}]/u.test(t)));
}

/** Um nome normalizado casa com o outro (igual, ou um contém o outro com núcleo). */
export function nomeDeArtistaBate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [menor, maior] = a.length <= b.length ? [a, b] : [b, a];
  return contemPalavrasInteiras(maior, menor) && temNucleo(menor);
}

/** Todas as formas normalizadas de um crédito: inteiro e cada participante. */
export function formasDoArtista(credito: string | null | undefined): string[] {
  const bruto = String(credito ?? '').trim();
  if (!bruto) return [];
  const formas = new Set<string>();
  const inteiro = normalizarParaComparar(bruto);
  if (inteiro && !SEM_ARTISTA.has(inteiro)) formas.add(inteiro);
  let partes: string[] = [];
  try {
    partes = separarCreditos(bruto);
  } catch {
    partes = [];
  }
  for (const p of partes) {
    const n = normalizarParaComparar(p);
    if (n && !SEM_ARTISTA.has(n)) formas.add(n);
  }
  // "Chitãozinho & Xororó" ~ "Chitaozinho e Xororo": o conectivo no meio não
  // pode separar a mesma dupla.
  for (const f of [...formas]) {
    const semConectivo = f
      .split(' ')
      .filter((t) => !CONECTIVOS.has(t))
      .join(' ');
    if (semConectivo && semConectivo !== f) formas.add(semConectivo);
  }
  return [...formas];
}

function artistasBatem(
  rowArtist: string | null | undefined,
  nomes: readonly string[],
): { comparavel: boolean; bate: boolean } {
  const daLinha = formasDoArtista(rowArtist);
  const pedidos = nomes.flatMap(formasDoArtista);
  const comparavel = daLinha.length > 0 && pedidos.length > 0;
  const bate = comparavel && pedidos.some((p) => daLinha.some((r) => nomeDeArtistaBate(p, r)));
  return { comparavel, bate };
}

/** O título sem o "Artista - " da frente (padrão de vídeo do YouTube). */
function semArtistaNaFrente(t: string): string {
  const m = /\s[-–—]\s/.exec(t);
  return m && m.index > 0 ? t.slice(m.index + m[0].length) : t;
}

function formasDoTitulo(t: string): string[] {
  const limpo = limparTituloDaLetra(t) || t;
  return Array.from(
    new Set([t, limpo, semArtistaNaFrente(limpo)].map(normalizarParaComparar).filter(Boolean)),
  );
}

/** Comparação de título: `forte` = igual depois de limpo; `frouxo` = contido. */
export function comparaTitulos(
  daLinha: string | null | undefined,
  pedido: string | null | undefined,
): { forte: boolean; frouxo: boolean } {
  const a = formasDoTitulo(String(daLinha ?? ''));
  const b = formasDoTitulo(String(pedido ?? ''));
  if (a.length === 0 || b.length === 0) return { forte: false, frouxo: false };
  const forte = a.some((x) => b.includes(x));
  const frouxo =
    forte ||
    a.some((x) => b.some((y) => contemPalavrasInteiras(x, y) || contemPalavrasInteiras(y, x)));
  return { forte, frouxo };
}

function mesmasMarcas(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}

/** Detalhe da decisão — para testes e para logar o motivo. */
export interface VereditoDaLinha {
  aceita: boolean;
  motivo:
    | 'ok'
    | 'sem-titulo'
    | 'titulo'
    | 'titulo-sem-duracao'
    | 'instrumental'
    | 'artista'
    | 'duracao'
    | 'sem-prova';
  artistaBate: boolean;
  duracaoBate: boolean;
  tituloForte: boolean;
  /** As duas têm as mesmas marcas de versão (remix, ao vivo…). */
  mesmaVersao: boolean;
  /** |duração da linha − da faixa| em segundos; Infinity quando não dá para medir. */
  diferencaSeg: number;
}

export function julgarLinhaDoLrclib(
  row: LrclibRow,
  title: string,
  names: readonly string[],
  durationSec: number,
): VereditoDaLinha {
  const base = {
    artistaBate: false,
    duracaoBate: false,
    tituloForte: false,
    mesmaVersao: false,
    diferencaSeg: Number.POSITIVE_INFINITY,
  };
  if (!normalizarParaComparar(row.trackName) || !normalizarParaComparar(title)) {
    return { ...base, aceita: false, motivo: 'sem-titulo' };
  }
  const { forte, frouxo } = comparaTitulos(row.trackName, title);
  if (!frouxo) return { ...base, aceita: false, motivo: 'titulo' };
  const marcasDaLinha = marcasDeVersao(row.trackName);
  const marcasDoPedido = marcasDeVersao(title);
  const mesmaVersao = mesmasMarcas(marcasDaLinha, marcasDoPedido);
  if (marcasDaLinha.includes('instrumental') !== marcasDoPedido.includes('instrumental')) {
    return { ...base, tituloForte: forte, mesmaVersao, aceita: false, motivo: 'instrumental' };
  }

  const artistas = artistasBatem(row.artistName, names);
  if (artistas.comparavel && !artistas.bate) {
    return { ...base, tituloForte: forte, mesmaVersao, aceita: false, motivo: 'artista' };
  }

  const rowDur =
    typeof row.duration === 'number' && Number.isFinite(row.duration) ? row.duration : 0;
  const dur = Number.isFinite(durationSec) ? durationSec : 0;
  const duracaoComparavel = dur > 0 && rowDur > 0;
  const diferencaSeg = duracaoComparavel ? Math.abs(rowDur - dur) : Number.POSITIVE_INFINITY;
  const duracaoBate = duracaoComparavel && diferencaSeg <= FOLGA_DE_DURACAO_SEG;
  const r = {
    artistaBate: artistas.bate,
    duracaoBate,
    tituloForte: forte,
    mesmaVersao,
    diferencaSeg,
  };
  if (duracaoComparavel && !duracaoBate) return { ...r, aceita: false, motivo: 'duracao' };

  // Sem a duração confirmando, título "parecido" não basta: tem de ser o mesmo.
  if (!duracaoBate && !forte) return { ...r, aceita: false, motivo: 'titulo-sem-duracao' };
  if (!artistas.bate && !duracaoBate) return { ...r, aceita: false, motivo: 'sem-prova' };
  return { ...r, aceita: true, motivo: 'ok' };
}

/**
 * True quando a linha do LRCLIB É mesmo esta faixa. `names` são os créditos
 * da faixa (sem "Desconhecido"); `durationSec` ≤ 0 = duração desconhecida.
 */
export function linhaDoLrclibBate(
  row: LrclibRow,
  title: string,
  names: readonly string[],
  durationSec: number,
): boolean {
  return julgarLinhaDoLrclib(row, title, names, durationSec).aceita;
}

function temLetra(row: LrclibRow): { synced: boolean; plain: boolean } {
  return {
    synced: typeof row.syncedLyrics === 'string' && /\[\d{1,3}:\d{1,2}/.test(row.syncedLyrics),
    plain: typeof row.plainLyrics === 'string' && row.plainLyrics.trim().length > 0,
  };
}

/**
 * A MELHOR linha entre as candidatas (busca solta do LRCLIB): só as que passam
 * na prova; entre elas, com tempo antes de sem tempo, depois a duração mais
 * próxima, depois título idêntico, depois artista confirmado, e por fim a
 * ordem que a fonte devolveu. `null` quando nenhuma serve.
 */
export function escolherLinhaDoLrclib<T extends LrclibRow>(
  rows: readonly T[] | null | undefined,
  title: string,
  names: readonly string[],
  durationSec: number,
  opcoes: { exigirTempo?: boolean } = {},
): T | null {
  if (!Array.isArray(rows)) return null;
  const candidatas: Array<{ row: T; i: number; v: VereditoDaLinha; synced: boolean }> = [];
  rows.forEach((row: T, i: number) => {
    if (!row || typeof row !== 'object' || row.instrumental === true) return;
    const letra = temLetra(row);
    if (!letra.synced && !letra.plain) return;
    if (opcoes.exigirTempo && !letra.synced) return;
    const v = julgarLinhaDoLrclib(row, title, names, durationSec);
    if (v.aceita) candidatas.push({ row, i, v, synced: letra.synced });
  });
  const dif = (v: VereditoDaLinha): number =>
    Number.isFinite(v.diferencaSeg) ? v.diferencaSeg : 99;
  candidatas.sort(
    (a, b) =>
      Number(b.synced) - Number(a.synced) ||
      dif(a.v) - dif(b.v) ||
      Number(b.v.mesmaVersao) - Number(a.v.mesmaVersao) ||
      Number(b.v.tituloForte) - Number(a.v.tituloForte) ||
      Number(b.v.artistaBate) - Number(a.v.artistaBate) ||
      a.i - b.i,
  );
  return candidatas[0]?.row ?? null;
}
