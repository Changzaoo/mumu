/**
 * CRÉDITOS PROFUNDOS, lidos do Postgres — o que o worker `creditos` gravou.
 *
 * Três perguntas, três leituras:
 *   • a ficha de UMA FAIXA (produtor, compositor, gravadora…);
 *   • a ficha técnica de UM ARTISTA: contrato/editora/empresário dele e as
 *     pessoas que mais aparecem nos créditos das faixas dele no acervo;
 *   • UMA PESSOA creditada (por chave de identidade): tudo o que ela
 *     produziu/compôs no acervo — "quem mais ele produziu".
 */
import type { PapelDeCredito } from '@prisma/client';
import { chaveDeIdentidadeDoArtista } from '@radinho/shared';
import { prisma } from '../../infra/db/prisma.js';

export interface CreditoDto {
  papel: PapelDeCredito;
  nome: string;
  chave: string;
  fonte: string;
  /** Período, catálogo, nível (faixa/disco)… o que a fonte deu. */
  dados: Record<string, unknown> | null;
}

export interface CreditosDaFaixaDto {
  trackId: string;
  lidoEm: string | null;
  /** Nulo = o worker ainda não chegou nesta faixa. */
  identificada: boolean | null;
  creditos: CreditoDto[];
}

function dto(c: {
  papel: PapelDeCredito;
  nome: string;
  fonte: string;
  dados: unknown;
  chave?: string;
  chaveDoNome?: string;
}): CreditoDto {
  return {
    papel: c.papel,
    nome: c.nome,
    chave: c.chaveDoNome ?? c.chave ?? '',
    fonte: c.fonte,
    dados: (c.dados as Record<string, unknown> | null) ?? null,
  };
}

const ORDEM_DOS_PAPEIS: PapelDeCredito[] = [
  'PRODUTOR',
  'COMPOSITOR',
  'LETRISTA',
  'ARRANJADOR',
  'MIXAGEM',
  'MASTERIZACAO',
  'ENGENHEIRO',
  'INTERPRETE',
  'GRAVADORA',
  'SELO',
  'PRODUTORA',
  'EDITORA',
  'EMPRESARIO',
];

function ordenar<T extends { papel: PapelDeCredito; nome: string }>(lista: T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      ORDEM_DOS_PAPEIS.indexOf(a.papel) - ORDEM_DOS_PAPEIS.indexOf(b.papel) ||
      a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

export async function creditosDaFaixa(trackId: string): Promise<CreditosDaFaixaDto> {
  const ficha = await prisma.fichaDaFaixa.findUnique({
    where: { trackId },
    include: { creditos: true },
  });
  return {
    trackId,
    lidoEm: ficha?.lidoEm?.toISOString() ?? null,
    identificada: ficha ? Boolean(ficha.mbRecordingId || ficha.discogsReleaseId) : null,
    creditos: ficha ? ordenar(ficha.creditos).map(dto) : [],
  };
}

export interface ColaboradorDto {
  papel: PapelDeCredito;
  nome: string;
  chave: string;
  /** Em quantas faixas do artista no acervo esta pessoa aparece neste papel. */
  faixas: number;
}

export interface FichaTecnicaDto {
  artista: string;
  lidoEm: string | null;
  /** Do próprio artista: contrato, editora, empresário. */
  doArtista: CreditoDto[];
  /** Quem mais aparece nos créditos das faixas dele, por papel. */
  colaboradores: ColaboradorDto[];
  /** Quantas faixas do artista já têm ficha de créditos (e quantas no total). */
  faixasLidas: number;
  faixasNoAcervo: number;
}

/** Ids das faixas do acervo em que este nome é artista (qualquer posição). */
async function faixasDoArtista(nome: string): Promise<string[]> {
  const alvo = JSON.stringify([{ name: nome }]);
  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "CatalogTrack" WHERE data->'track'->'artists' @> ${alvo}::jsonb
  `;
  return linhas.map((l) => l.id);
}

export async function fichaTecnicaDoArtista(nome: string): Promise<FichaTecnicaDto | null> {
  const chave = chaveDeIdentidadeDoArtista(nome);
  if (!chave) return null;
  const ficha = await prisma.fichaDoArtista.findUnique({
    where: { chave },
    include: { creditos: true },
  });
  const ids = await faixasDoArtista(ficha?.nome ?? nome);
  if (!ficha && ids.length === 0) return null;

  const lidas =
    ids.length > 0 ? await prisma.fichaDaFaixa.count({ where: { trackId: { in: ids } } }) : 0;
  const agrupados =
    ids.length > 0
      ? await prisma.creditoDaFaixa.groupBy({
          by: ['papel', 'chave'],
          where: { trackId: { in: ids }, papel: { notIn: ['INTERPRETE'] }, chave: { not: chave } },
          _count: { _all: true },
          _max: { nome: true },
          orderBy: [{ _count: { trackId: 'desc' } }],
          take: 40,
        })
      : [];
  const colaboradores: ColaboradorDto[] = agrupados.map((g) => ({
    papel: g.papel,
    nome: g._max.nome ?? g.chave,
    chave: g.chave,
    faixas: g._count._all,
  }));

  return {
    artista: ficha?.nome ?? nome,
    lidoEm: ficha?.creditosEm?.toISOString() ?? null,
    doArtista: ficha ? ordenar(ficha.creditos).map(dto) : [],
    colaboradores: ordenar(colaboradores),
    faixasLidas: lidas,
    faixasNoAcervo: ids.length,
  };
}

export interface FaixaCreditadaDto {
  trackId: string;
  titulo: string;
  artista: string;
  coverUrl: string | null;
  papeis: PapelDeCredito[];
}

export interface PessoaDto {
  chave: string;
  nome: string;
  /** Papéis em que aparece, com contagem de faixas. */
  papeis: Array<{ papel: PapelDeCredito; faixas: number }>;
  faixas: FaixaCreditadaDto[];
  /** Artistas do acervo em cujos créditos de artista ela aparece. */
  artistas: Array<{ artista: string; papel: PapelDeCredito }>;
}

/** "Quem mais ele produziu no acervo": tudo de uma pessoa creditada. */
export async function pessoaCreditada(
  chave: string,
  papel?: PapelDeCredito,
): Promise<PessoaDto | null> {
  const limpa = chaveDeIdentidadeDoArtista(chave) || chave;
  const creditos = await prisma.creditoDaFaixa.findMany({
    where: { chave: limpa, ...(papel ? { papel } : {}) },
    orderBy: { criadoEm: 'desc' },
    take: 400,
  });
  const doArtista = await prisma.creditoDoArtista.findMany({
    where: { chaveDoNome: limpa },
    include: { ficha: { select: { nome: true } } },
    take: 50,
  });
  if (creditos.length === 0 && doArtista.length === 0) return null;

  const porFaixa = new Map<string, Set<PapelDeCredito>>();
  const contagem = new Map<PapelDeCredito, number>();
  let nome = creditos[0]?.nome ?? doArtista[0]?.nome ?? chave;
  for (const c of creditos) {
    if (c.fonte === 'musicbrainz') nome = c.nome; // a grafia mais confiável
    const set = porFaixa.get(c.trackId) ?? new Set<PapelDeCredito>();
    set.add(c.papel);
    porFaixa.set(c.trackId, set);
  }
  for (const [, set] of porFaixa) for (const p of set) contagem.set(p, (contagem.get(p) ?? 0) + 1);

  const ids = [...porFaixa.keys()];
  const linhas =
    ids.length > 0
      ? await prisma.catalogTrack.findMany({
          where: { id: { in: ids } },
          select: { id: true, data: true },
        })
      : [];
  const faixas: FaixaCreditadaDto[] = [];
  for (const l of linhas) {
    const track = (l.data as { track?: Record<string, unknown> }).track ?? {};
    const artistas = Array.isArray(track.artists)
      ? (track.artists as Array<{ name?: string }>)
      : [];
    faixas.push({
      trackId: l.id,
      titulo: String(track.title ?? ''),
      artista: artistas
        .map((a) => a.name)
        .filter(Boolean)
        .join(', '),
      coverUrl: typeof track.coverUrl === 'string' ? track.coverUrl : null,
      papeis: [...(porFaixa.get(l.id) ?? [])],
    });
  }
  faixas.sort(
    (a, b) =>
      a.artista.localeCompare(b.artista, 'pt-BR') || a.titulo.localeCompare(b.titulo, 'pt-BR'),
  );

  return {
    chave: limpa,
    nome,
    papeis: ordenar(
      [...contagem.entries()].map(([p, n]) => ({ papel: p, faixas: n, nome: '' })),
    ).map(({ papel: p, faixas: n }) => ({ papel: p, faixas: n })),
    faixas,
    artistas: doArtista.map((d) => ({ artista: d.ficha.nome, papel: d.papel })),
  };
}
