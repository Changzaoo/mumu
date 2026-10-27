/**
 * CRÉDITOS PROFUNDOS, 24/7 — quem produziu, compôs, mixou, lançou e
 * empresaria cada faixa e cada artista do acervo.
 *
 * O app já mostrava "Composição" e "Produção" buscando na MusicBrainz DO
 * NAVEGADOR, faixa a faixa, sem cache compartilhado (lib/credits). Agora o
 * servidor lê uma vez, de três fontes (MusicBrainz, Discogs, o que o
 * importador já trouxe), funde pela regra única de nomes do shared e grava
 * por papel em `CreditoDaFaixa` / `CreditoDoArtista`. Daí sai a ficha da
 * faixa, a ficha técnica do artista e a navegação "quem mais ele produziu".
 *
 * O QUE ELE FAZ, a cada batida:
 *   1. FAIXAS — as sem ficha (ou vencidas), as de artistas seguidos antes;
 *      para cada uma: acervo (sem rede) + MusicBrainz (gravação → obra →
 *      lançamento) + Discogs (com token); funde; grava substituindo;
 *   2. ARTISTAS — fichas com mbid e créditos vencidos: contrato de
 *      gravadora, editora, empresário (relações do MusicBrainz).
 *
 * FREIOS: orçamento diário próprio em `WorkerState` (`creditos.orcamento`),
 * poucas faixas por batida, a MESMA fila serial da MusicBrainz do worker
 * `mundo` (1 req/2 s), e 503 marca "volta em 1 h", não "não tem crédito".
 * Faixa identificada é relida só depois de meses: crédito não muda.
 */
import type { PapelDeCredito } from '@prisma/client';
import { chaveDeIdentidadeDoArtista } from '@radinho/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import {
  creditosDoAcervo,
  fundirCreditos,
  lerArtistaMB,
  lerDiscogs,
  lerGravacaoMB,
  type CreditoLido,
} from './creditos.fontes.js';
import { FonteIndisponivel, Orcamento } from './mundo.fontes.js';

/**
 * Folga para a transação: o banco pode estar do outro lado de um túnel (em
 * desenvolvimento) ou ocupado; os 5 s padrão do Prisma já estouraram numa
 * gravação de cinco linhas.
 */
const TRANSACAO = { timeout: 30_000, maxWait: 10_000 } as const;

const log = logger.child({ worker: 'creditos' });

const CHAVE_DO_ORCAMENTO = 'creditos.orcamento';
/** Sobe quando a leitura muda a ponto de valer reler o acervo inteiro. */
export const VERSAO_DOS_CREDITOS = 1;
/** Faixa identificada: relida depois disto (crédito não muda). */
const RELER_IDENTIFICADA_DIAS = 120;
/** Faixa que a MusicBrainz não conhece: tenta de novo em um mês. */
const RELER_DESCONHECIDA_DIAS = 30;
/** Fonte fora do ar: volta em uma hora. */
const RETENTATIVA_MS = 60 * 60_000;
/** Créditos do artista (contrato, editora, empresário): relidos por mês. */
const RELER_ARTISTA_DIAS = 30;

interface FaixaDoAcervo {
  id: string;
  titulo: string;
  artista: string;
  composer: string | null;
  label: string | null;
}

/** Linha do acervo → o que a leitura precisa. Puro. */
export function faixaDaEntrada(id: string, data: unknown): FaixaDoAcervo | null {
  const track = (data as { track?: Record<string, unknown> } | null)?.track;
  if (!track) return null;
  const titulo = typeof track.title === 'string' ? track.title.trim() : '';
  const artistas = Array.isArray(track.artists) ? (track.artists as Array<{ name?: unknown }>) : [];
  const artista = typeof artistas[0]?.name === 'string' ? artistas[0].name.trim() : '';
  if (!titulo || !artista) return null;
  return {
    id,
    titulo,
    artista,
    composer: typeof track.composer === 'string' ? track.composer : null,
    label: typeof track.label === 'string' ? track.label : null,
  };
}

/** Faixas na vez: sem ficha, vencidas ou de versão velha; seguidos antes. */
async function faixasNaVez(agora: Date, quantas: number): Promise<FaixaDoAcervo[]> {
  const linhas = await prisma.$queryRaw<Array<{ id: string; data: unknown }>>`
    SELECT t.id, t.data
    FROM "CatalogTrack" t
    LEFT JOIN "FichaDaFaixa" f ON f."trackId" = t.id
    LEFT JOIN "FichaDoArtista" a
      ON a.chave = (
        SELECT fa.chave FROM "FichaDoArtista" fa
        WHERE fa.nome = t.data->'track'->'artists'->0->>'name' LIMIT 1
      )
    WHERE f."trackId" IS NULL
       OR f.versao < ${VERSAO_DOS_CREDITOS}
       OR f."proximaEm" <= ${agora}
    ORDER BY COALESCE(a.prioridade, 0) DESC, t."updatedAt" DESC
    LIMIT ${quantas}
  `;
  return linhas
    .map((l) => faixaDaEntrada(l.id, l.data))
    .filter((f): f is FaixaDoAcervo => f !== null);
}

export interface LeituraDaFaixa {
  creditos: CreditoLido[];
  mbRecordingId: string | null;
  mbWorkId: string | null;
  mbReleaseId: string | null;
  discogsReleaseId: number | null;
  erros: string[];
  indisponivel: boolean;
}

/** Lê as três fontes para uma faixa. Nunca lança. */
export async function lerFaixa(faixa: FaixaDoAcervo, orc: Orcamento): Promise<LeituraDaFaixa> {
  const leitura: LeituraDaFaixa = {
    creditos: creditosDoAcervo(faixa),
    mbRecordingId: null,
    mbWorkId: null,
    mbReleaseId: null,
    discogsReleaseId: null,
    erros: [],
    indisponivel: false,
  };
  try {
    const mb = await lerGravacaoMB(faixa.titulo, faixa.artista, orc);
    if (mb) {
      leitura.mbRecordingId = mb.recordingId;
      leitura.mbWorkId = mb.workId;
      leitura.mbReleaseId = mb.releaseId;
      leitura.creditos.push(...mb.creditos);
    } else {
      leitura.erros.push('musicbrainz: gravação não identificada com certeza');
    }
  } catch (err) {
    leitura.erros.push(`musicbrainz: ${String(err).slice(0, 120)}`);
    if (err instanceof FonteIndisponivel) leitura.indisponivel = true;
  }
  try {
    const dg = await lerDiscogs(faixa.titulo, faixa.artista, orc);
    if (dg) {
      leitura.discogsReleaseId = dg.releaseId;
      leitura.creditos.push(...dg.creditos);
    }
  } catch (err) {
    leitura.erros.push(`discogs: ${String(err).slice(0, 120)}`);
    if (err instanceof FonteIndisponivel) leitura.indisponivel = true;
  }
  leitura.creditos = fundirCreditos(leitura.creditos);
  return leitura;
}

function proximaLeitura(leitura: LeituraDaFaixa, agora: Date): Date {
  if (leitura.indisponivel) return new Date(agora.getTime() + RETENTATIVA_MS);
  const dias = leitura.mbRecordingId ? RELER_IDENTIFICADA_DIAS : RELER_DESCONHECIDA_DIAS;
  return new Date(agora.getTime() + dias * 86_400_000);
}

async function gravarFaixa(
  faixa: FaixaDoAcervo,
  leitura: LeituraDaFaixa,
  gastas: number,
  agora: Date,
): Promise<void> {
  const linhas = leitura.creditos.map((c) => ({
    id: `${faixa.id}|${c.papel}|${c.chave}`,
    trackId: faixa.id,
    papel: c.papel as PapelDeCredito,
    nome: c.nome,
    chave: c.chave,
    fonte: c.fonte,
    dados: (c.dados ?? undefined) as object | undefined,
  }));
  await prisma.$transaction(async (tx) => {
    await tx.fichaDaFaixa.upsert({
      where: { trackId: faixa.id },
      create: {
        trackId: faixa.id,
        mbRecordingId: leitura.mbRecordingId,
        mbWorkId: leitura.mbWorkId,
        mbReleaseId: leitura.mbReleaseId,
        discogsReleaseId: leitura.discogsReleaseId,
        lidoEm: agora,
        proximaEm: proximaLeitura(leitura, agora),
        erro: leitura.erros.length > 0 ? leitura.erros.join(' | ').slice(0, 500) : null,
        versao: leitura.indisponivel ? 0 : VERSAO_DOS_CREDITOS,
        chamadas: gastas,
      },
      update: {
        mbRecordingId: leitura.mbRecordingId ?? undefined,
        mbWorkId: leitura.mbWorkId ?? undefined,
        mbReleaseId: leitura.mbReleaseId ?? undefined,
        discogsReleaseId: leitura.discogsReleaseId ?? undefined,
        lidoEm: agora,
        proximaEm: proximaLeitura(leitura, agora),
        erro: leitura.erros.length > 0 ? leitura.erros.join(' | ').slice(0, 500) : null,
        versao: leitura.indisponivel ? 0 : VERSAO_DOS_CREDITOS,
        chamadas: { increment: gastas },
      },
    });
    // Com a fonte fora do ar não se apaga o que já estava gravado.
    if (!leitura.indisponivel) {
      await tx.creditoDaFaixa.deleteMany({ where: { trackId: faixa.id } });
      if (linhas.length > 0)
        await tx.creditoDaFaixa.createMany({ data: linhas, skipDuplicates: true });
    }
  }, TRANSACAO);
}

/** Artistas com mbid cujos créditos nunca foram lidos ou venceram. */
async function artistasNaVez(agora: Date, quantos: number) {
  return prisma.fichaDoArtista.findMany({
    where: {
      mbid: { not: null },
      OR: [{ creditosProximaEm: null }, { creditosProximaEm: { lte: agora } }],
    },
    orderBy: [{ prioridade: 'desc' }],
    take: quantos,
  });
}

async function lerEGravarArtista(
  ficha: { chave: string; nome: string; mbid: string | null },
  orc: Orcamento,
  agora: Date,
): Promise<number> {
  if (!ficha.mbid) return 0;
  const antes = orc.gastas;
  let creditos: CreditoLido[] = [];
  let indisponivel = false;
  let erro: string | null = null;
  try {
    creditos = fundirCreditos(await lerArtistaMB(ficha.mbid, orc));
  } catch (err) {
    erro = String(err).slice(0, 300);
    indisponivel = err instanceof FonteIndisponivel;
  }
  const proxima = indisponivel
    ? new Date(agora.getTime() + RETENTATIVA_MS)
    : new Date(agora.getTime() + RELER_ARTISTA_DIAS * 86_400_000);
  await prisma.$transaction(async (tx) => {
    if (!indisponivel) {
      await tx.creditoDoArtista.deleteMany({ where: { chave: ficha.chave, fonte: 'musicbrainz' } });
      if (creditos.length > 0) {
        await tx.creditoDoArtista.createMany({
          data: creditos.map((c) => ({
            id: `${ficha.chave}|${c.papel}|${c.chave}`,
            chave: ficha.chave,
            papel: c.papel as PapelDeCredito,
            nome: c.nome,
            chaveDoNome: c.chave,
            fonte: c.fonte,
            dados: (c.dados ?? undefined) as object | undefined,
          })),
          skipDuplicates: true,
        });
      }
    }
    await tx.fichaDoArtista.update({
      where: { chave: ficha.chave },
      data: {
        creditosEm: agora,
        creditosProximaEm: proxima,
        creditosErro: erro,
        chamadas: { increment: orc.gastas - antes },
      },
    });
  }, TRANSACAO);
  return creditos.length;
}

async function orcamentoDoDia(agora: Date): Promise<Orcamento> {
  const dia = agora.toISOString().slice(0, 10);
  const linha = await prisma.workerState
    .findUnique({ where: { key: CHAVE_DO_ORCAMENTO } })
    .catch(() => null);
  const v = (linha?.value ?? {}) as { dia?: string; gastas?: number };
  const orc = new Orcamento(env.CREDITOS_MAX_CHAMADAS_DIA);
  if (v.dia === dia && typeof v.gastas === 'number') orc.gastas = v.gastas;
  return orc;
}

async function guardarOrcamento(orc: Orcamento, agora: Date): Promise<void> {
  const value = { dia: agora.toISOString().slice(0, 10), gastas: orc.gastas, teto: orc.teto };
  await prisma.workerState
    .upsert({
      where: { key: CHAVE_DO_ORCAMENTO },
      create: { key: CHAVE_DO_ORCAMENTO, value },
      update: { value },
    })
    .catch(() => undefined);
}

/** Uma batida. Exportada para rodar sem esperar o relógio. */
export async function creditosUmaVez(agora = new Date()): Promise<{
  rodou: boolean;
  motivo?: string;
  faixas: number;
  artistas: number;
  creditos: number;
  chamadas: number;
}> {
  const parado = (motivo: string) => ({
    rodou: false,
    motivo,
    faixas: 0,
    artistas: 0,
    creditos: 0,
    chamadas: 0,
  });
  const orc = await orcamentoDoDia(agora);
  if (orc.esgotado) return parado('teto de chamadas do dia alcançado');
  const antes = orc.gastas;

  // Ficha de faixa que saiu do acervo não precisa mais existir.
  await prisma.$executeRaw`
    DELETE FROM "FichaDaFaixa" f WHERE NOT EXISTS (SELECT 1 FROM "CatalogTrack" t WHERE t.id = f."trackId")
  `.catch(() => undefined);

  let faixas = 0;
  let creditos = 0;
  for (const faixa of await faixasNaVez(agora, env.CREDITOS_FAIXAS_POR_BATIDA)) {
    if (orc.esgotado) break;
    const gastasAntes = orc.gastas;
    const leitura = await lerFaixa(faixa, orc);
    try {
      await gravarFaixa(faixa, leitura, orc.gastas - gastasAntes, agora);
      faixas += 1;
      creditos += leitura.creditos.length;
      log.info(
        {
          faixa: `${faixa.artista} – ${faixa.titulo}`,
          mb: leitura.mbRecordingId,
          discogs: leitura.discogsReleaseId,
          creditos: leitura.creditos.map((c) => `${c.papel}:${c.nome}`),
          chamadas: orc.gastas - gastasAntes,
          erros: leitura.erros,
        },
        'créditos da faixa gravados',
      );
    } catch (err) {
      log.warn({ faixa: faixa.id, err: String(err) }, 'não deu para gravar os créditos');
    }
    await guardarOrcamento(orc, agora);
  }

  let artistas = 0;
  for (const ficha of await artistasNaVez(agora, env.CREDITOS_ARTISTAS_POR_BATIDA)) {
    if (orc.esgotado) break;
    try {
      const n = await lerEGravarArtista(ficha, orc, agora);
      artistas += 1;
      creditos += n;
      log.info({ artista: ficha.nome, creditos: n }, 'créditos do artista gravados');
    } catch (err) {
      log.warn(
        { artista: ficha.nome, err: String(err) },
        'não deu para gravar os créditos do artista',
      );
    }
    await guardarOrcamento(orc, agora);
  }
  if (faixas === 0 && artistas === 0) return parado('nada na vez');
  return { rodou: true, faixas, artistas, creditos, chamadas: orc.gastas - antes };
}

export function startCreditosWorker(): () => void {
  if (!env.CREDITOS_ENABLED) {
    log.info({}, 'créditos profundos desligados por configuração');
    return () => undefined;
  }
  let parado = false;
  let rodando = false;
  const bater = (): void => {
    if (parado || rodando) return;
    rodando = true;
    void creditosUmaVez()
      .then((r) => {
        if (!r.rodou) log.info({ motivo: r.motivo }, 'créditos declinaram esta batida');
        else
          log.info(
            { faixas: r.faixas, artistas: r.artistas, creditos: r.creditos, chamadas: r.chamadas },
            'créditos terminaram a batida',
          );
      })
      .catch((err) => log.error({ err }, 'créditos falharam'))
      .finally(() => {
        rodando = false;
      });
  };
  // Depois do `mundo` (que sobe aos 90 s): as duas filas dividem a MusicBrainz.
  const primeira = setTimeout(bater, 150_000);
  const timer = setInterval(bater, env.CREDITOS_BATIDA_MIN * 60_000);
  primeira.unref?.();
  timer.unref?.();
  log.info(
    {
      batidaMin: env.CREDITOS_BATIDA_MIN,
      faixasPorBatida: env.CREDITOS_FAIXAS_POR_BATIDA,
      tetoDia: env.CREDITOS_MAX_CHAMADAS_DIA,
      discogs: Boolean(env.DISCOGS_TOKEN),
    },
    'créditos profundos 24/7 iniciados',
  );
  return () => {
    parado = true;
    clearTimeout(primeira);
    clearInterval(timer);
  };
}

/** Para a API: a chave de identidade de um nome creditado. */
export const chaveDoCreditado = chaveDeIdentidadeDoArtista;
