/**
 * AUDITORIA DE CRÉDITOS — a lógica PURA (testável, sem banco).
 *
 * Procura no acervo as faixas cujo crédito (título/artista) tem cara de estrago
 * de importação: o canal ou a gravadora no lugar do artista, o título do vídeo
 * inteiro no campo do título, "feat"/lista dentro do nome do artista, "Desconhecido",
 * o artista repetido dentro do título, e artista reescrito (pela curadoria/IA)
 * com um nome que o vídeo original não prova.
 *
 * O executável é `auditarCreditos.ts`. Nada aqui lê nem grava o banco.
 */
import { ehGravadora, ehSelo, lerTituloDeVideo, separarCreditos } from '@radinho/shared';
import { nomeApareceEm } from '../workers/guardaDeArtista.js';

export type CodigoDeAchado =
  | 'artista-igual-canal'
  | 'titulo-nao-separado'
  | 'artista-feat-ou-lista'
  | 'artista-desconhecido'
  | 'titulo-contem-artista'
  | 'artista-sem-prova'
  | 'parser-diverge';

export interface Achado {
  codigo: CodigoDeAchado;
  detalhe: string;
}

export interface FaixaAuditavel {
  id: string;
  titulo: string;
  artistas: string[];
  tituloOriginal: string | null;
  artistasOriginais: string[];
  /** Selo/canal gravado na faixa, quando há. */
  selo: string | null;
}

export interface Correcao {
  titulo: string;
  artistas: string[];
  selo: string | null;
}

export interface ItemDoRelatorio {
  id: string;
  titulo: string;
  artistas: string[];
  tituloOriginal: string | null;
  achados: Achado[];
  proposta?: Correcao | null;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function nomes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (a && typeof a === 'object' ? (a as { name?: unknown }).name : a))
    .map(texto)
    .filter(Boolean);
}

/** Linha do acervo (`CatalogTrack.data`) → o que a auditoria precisa. */
export function faixaDoAcervo(id: string, data: unknown): FaixaAuditavel | null {
  const track = (data as { track?: Record<string, unknown> } | null)?.track;
  if (!track || typeof track !== 'object') return null;
  const titulo = texto(track.title);
  if (!titulo) return null;
  return {
    id,
    titulo,
    artistas: nomes(track.artists),
    tituloOriginal: texto(track.tituloOriginal) || null,
    artistasOriginais: nomes(track.artistasOriginais),
    selo: texto(track.label) || null,
  };
}

const chave = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const TITULO_DE_VIDEO = /\s[-–—|]\s/;
const PARTICIPACAO = /\b(?:feat|ft|featuring|part|participa[cç][aã]o)\b\.?/i;
const PLACEHOLDER =
  /^(?:desconhecido|unknown|unknown artist|artista desconhecido|various artists)?$/;

/** Os achados de UMA faixa. Lista vazia = nada suspeito. */
export function auditarFaixa(f: FaixaAuditavel): Achado[] {
  const achados: Achado[] = [];

  // (iv) sem artista de verdade
  if (f.artistas.length === 0 || f.artistas.every((a) => PLACEHOLDER.test(chave(a)))) {
    achados.push({ codigo: 'artista-desconhecido', detalhe: f.artistas.join(', ') || '(vazio)' });
  }
  const reais = f.artistas.filter((a) => !PLACEHOLDER.test(chave(a)));

  // (i) artista é a gravadora/canal
  for (const a of reais) {
    if (ehGravadora(a) || ehSelo(a) || (f.selo && chave(a) === chave(f.selo))) {
      achados.push({ codigo: 'artista-igual-canal', detalhe: a });
    }
  }

  // (ii) título com cara de nome de vídeo
  if (TITULO_DE_VIDEO.test(f.titulo)) {
    achados.push({ codigo: 'titulo-nao-separado', detalhe: f.titulo });
  }

  // (iii) "feat"/lista/&/e dentro do nome do artista, salvo grupo legítimo
  for (const a of reais) {
    const partes = separarCreditos(a);
    if (PARTICIPACAO.test(a) || partes.length > 1) {
      achados.push({ codigo: 'artista-feat-ou-lista', detalhe: a });
    }
  }

  // (v) o nome do artista dentro do título
  for (const a of reais) {
    const k = chave(a);
    if (k.length >= 3 && chave(f.titulo) !== k && ` ${chave(f.titulo)} `.includes(` ${k} `)) {
      achados.push({ codigo: 'titulo-contem-artista', detalhe: `${a} em "${f.titulo}"` });
    }
  }

  // (vi) artista diferente do original e sem prova no vídeo original
  if (f.tituloOriginal || f.artistasOriginais.length > 0) {
    const mudou =
      f.artistasOriginais.length > 0 &&
      chave(f.artistasOriginais.join(' ')) !== chave(f.artistas.join(' '));
    if (mudou) {
      const provas = [f.tituloOriginal ?? '', f.selo ?? '', ...f.artistasOriginais];
      const semProva = reais.filter((a) => !provas.some((p) => nomeApareceEm(a, p)));
      if (semProva.length > 0) {
        achados.push({ codigo: 'artista-sem-prova', detalhe: semProva.join(', ') });
      }
    }
  }

  // (vii) o parser de hoje daria outra coisa para o título original
  if (f.tituloOriginal) {
    const lido = lerTituloDeVideo(f.tituloOriginal, f.selo);
    const mesmoTitulo = chave(lido.title) === chave(f.titulo);
    const lidos = lido.artists.map(chave).filter(Boolean);
    const gravados = reais.map(chave).filter(Boolean);
    const mesmosArtistas =
      lidos.length === 0 ||
      (lidos.length === gravados.length && lidos.every((a) => gravados.includes(a)));
    if (!mesmoTitulo || !mesmosArtistas) {
      achados.push({
        codigo: 'parser-diverge',
        detalhe: `parser: "${lido.title}" / ${lido.artists.join(', ') || '(sem artista)'}`,
      });
    }
  }
  return achados;
}

const CORRIGIVEIS: ReadonlySet<CodigoDeAchado> = new Set([
  'artista-igual-canal',
  'titulo-nao-separado',
  'artista-feat-ou-lista',
  'parser-diverge',
]);

/**
 * A correção pelo parser, ou `null` (nada a propor / parser em dúvida).
 *
 * Nunca inventa: os artistas propostos saem do TEXTO do vídeo (título original
 * ou o título atual); se o parser não achou ninguém, ficam os atuais.
 */
export function proporCorrecao(f: FaixaAuditavel, achados: Achado[]): Correcao | null {
  if (!achados.some((a) => CORRIGIVEIS.has(a.codigo))) return null;
  const fonte = f.tituloOriginal ?? f.titulo;
  const lido = lerTituloDeVideo(fonte, f.selo);
  const titulo = lido.title.trim();
  if (titulo.length < 2) return null;
  // Artistas: os do parser; sem eles, os atuais que não são selo.
  let artistas = lido.artists.filter((a) => !ehSelo(a));
  if (artistas.length === 0)
    artistas = f.artistas.filter((a) => !ehSelo(a) && !PLACEHOLDER.test(chave(a)));
  // Toda proposta precisa de prova no texto do vídeo ou nos artistas atuais.
  const provas = [fonte, f.titulo, ...f.artistas, ...f.artistasOriginais];
  artistas = artistas.filter((a) => provas.some((p) => nomeApareceEm(a, p)));
  const selo = lido.label ?? f.selo;
  const igualTitulo = chave(titulo) === chave(f.titulo);
  const igualArtistas =
    artistas.length === f.artistas.length &&
    artistas.every((a, i) => chave(a) === chave(f.artistas[i] ?? ''));
  if (igualTitulo && igualArtistas) return null;
  if (artistas.length === 0) return null; // sem quem creditar, não propõe
  return { titulo, artistas, selo: selo ?? null };
}

export interface Relatorio {
  geradoEm: string;
  total: number;
  sinalizadas: number;
  porCodigo: Record<string, number>;
  itens: ItemDoRelatorio[];
}

export function montarRelatorio(
  itens: ItemDoRelatorio[],
  total: number,
  geradoEm = new Date().toISOString(),
): Relatorio {
  const porCodigo: Record<string, number> = {};
  for (const it of itens)
    for (const a of it.achados) porCodigo[a.codigo] = (porCodigo[a.codigo] ?? 0) + 1;
  return { geradoEm, total, sinalizadas: itens.length, porCodigo, itens };
}

/** Nome da tabela de backup do dia — só dígitos, seguro para ir no SQL. */
export function nomeDaTabelaDeBackup(dia: Date): string {
  const y = dia.getFullYear();
  const m = String(dia.getMonth() + 1).padStart(2, '0');
  const d = String(dia.getDate()).padStart(2, '0');
  return `catalog_backup_creditos_${y}${m}${d}`;
}

export const TABELA_DE_BACKUP_VALIDA = /^catalog_backup_creditos_\d{8}$/;

/**
 * O patch que uma correção faz em `data.track` — título/artistas novos e a
 * marca de reversão (`tituloOriginal`/`artistasOriginais`) quando ainda não há.
 */
export function aplicarCorrecao(
  track: Record<string, unknown>,
  c: Correcao,
): Record<string, unknown> {
  const slug = (n: string): string => chave(n).replace(/ /g, '-');
  const existentes = Array.isArray(track.artists)
    ? (track.artists as Array<{ name?: unknown }>)
    : [];
  const artists = c.artistas.map(
    (name, order) =>
      existentes.find((a) => a?.name === name) ?? {
        id: `credito:${slug(name)}`,
        name,
        slug: slug(name),
        imageUrl: null,
        order,
      },
  );
  const novo: Record<string, unknown> = { ...track, title: c.titulo, artists };
  if (!track.tituloOriginal) novo.tituloOriginal = track.title;
  if (!track.artistasOriginais) novo.artistasOriginais = track.artists ?? [];
  if (c.selo && !track.label) novo.label = c.selo;
  return novo;
}
