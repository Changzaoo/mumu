/**
 * O MUNDO DA MÚSICA, lido do Postgres — o que o worker `mundo` já trouxe.
 *
 * Nenhuma função aqui chama fonte externa. A página do artista e a Home
 * recebem o cache; quem o enche é o worker, com orçamento e intervalo.
 */
import type { TipoDeEvento } from '@prisma/client';
import { chaveDeIdentidadeDoArtista } from '@radinho/shared';
import { prisma } from '../../infra/db/prisma.js';
import { JANELA_PASSADA_DIAS } from '../../workers/mundo.worker.js';

export interface EventoDto {
  id: string;
  tipo: TipoDeEvento;
  titulo: string;
  descricao: string | null;
  quando: string | null;
  local: string | null;
  cidade: string | null;
  pais: string | null;
  preco: string | null;
  linkIngresso: string | null;
  link: string | null;
  youtubeId: string | null;
  embed: boolean;
  fonte: string;
}

export interface AgendaDto {
  artista: string;
  /** Nulo = o worker ainda não leu este artista (a ficha acabou de nascer). */
  atualizadoEm: string | null;
  links: Record<string, string>;
  eventos: EventoDto[];
}

export interface AvisoDto extends EventoDto {
  artista: string;
  chave: string;
}

function dto(e: {
  id: string;
  tipo: TipoDeEvento;
  titulo: string;
  descricao: string | null;
  quando: Date | null;
  local: string | null;
  cidade: string | null;
  pais: string | null;
  preco: string | null;
  linkIngresso: string | null;
  link: string | null;
  youtubeId: string | null;
  embed: boolean;
  fonte: string;
}): EventoDto {
  return {
    id: e.id,
    tipo: e.tipo,
    titulo: e.titulo,
    descricao: e.descricao,
    quando: e.quando?.toISOString() ?? null,
    local: e.local,
    cidade: e.cidade,
    pais: e.pais,
    preco: e.preco,
    linkIngresso: e.linkIngresso,
    link: e.link,
    youtubeId: e.youtubeId,
    embed: e.embed,
    fonte: e.fonte,
  };
}

/** O nome existe no acervo? Barato: 5,7 mil linhas, contenção em JSONB. */
async function estaNoAcervo(nome: string): Promise<boolean> {
  const alvo = JSON.stringify([{ name: nome }]);
  const linhas = await prisma.$queryRaw<Array<{ um: number }>>`
    SELECT 1 AS um FROM "CatalogTrack" WHERE data->'track'->'artists' @> ${alvo}::jsonb LIMIT 1
  `;
  return linhas.length > 0;
}

/**
 * A agenda de um artista. Sem ficha ainda: se o nome está no acervo, a ficha
 * nasce aqui (sem rede) e o worker a lê na próxima batida — a página pede,
 * o agente traz, a próxima visita encontra.
 */
export async function agendaDoArtista(nome: string, agora = new Date()): Promise<AgendaDto | null> {
  const chave = chaveDeIdentidadeDoArtista(nome);
  if (!chave) return null;
  let ficha = await prisma.fichaDoArtista.findUnique({ where: { chave } });
  if (!ficha) {
    if (nome.length > 120 || !(await estaNoAcervo(nome))) return null;
    ficha = await prisma.fichaDoArtista.upsert({
      where: { chave },
      create: { chave, nome, prioridade: 1 },
      update: {},
    });
  }
  const corte = new Date(agora.getTime() - JANELA_PASSADA_DIAS * 86_400_000);
  const eventos = await prisma.eventoDoArtista.findMany({
    where: {
      chave,
      OR: [
        { tipo: { in: ['PREMIO', 'LANCAMENTO'] } },
        { quando: null },
        { quando: { gte: corte } },
      ],
    },
    orderBy: [{ quando: { sort: 'desc', nulls: 'last' } }],
    take: 80,
  });
  return {
    artista: ficha.nome,
    atualizadoEm: ficha.agendaEm?.toISOString() ?? null,
    links: (ficha.links as Record<string, string> | null) ?? {},
    eventos: eventos.map(dto),
  };
}

/** Janela dos avisos da Home: o que vem aí e o que acabou de acontecer. */
export const AVISO_FUTURO_DIAS = 45;
export const AVISO_PASSADO_DIAS = 30;

/**
 * Avisos para quem segue estes artistas: show ou transmissão nos próximos 45
 * dias, prêmio ou lançamento dos últimos 30. Até 12, os mais próximos antes.
 */
export async function avisosPara(nomes: string[], agora = new Date()): Promise<AvisoDto[]> {
  const chaves = [...new Set(nomes.map(chaveDeIdentidadeDoArtista).filter(Boolean))];
  if (chaves.length === 0) return [];
  const futuro = new Date(agora.getTime() + AVISO_FUTURO_DIAS * 86_400_000);
  const passado = new Date(agora.getTime() - AVISO_PASSADO_DIAS * 86_400_000);
  const ontem = new Date(agora.getTime() - 86_400_000);
  const eventos = await prisma.eventoDoArtista.findMany({
    where: {
      chave: { in: chaves },
      OR: [
        { tipo: { in: ['SHOW', 'FESTIVAL', 'TRANSMISSAO'] }, quando: { gte: ontem, lte: futuro } },
        // Transmissão ao vivo agora (sem horário) também avisa.
        { tipo: 'TRANSMISSAO', quando: null, fonte: 'youtube' },
        { tipo: { in: ['PREMIO', 'LANCAMENTO'] }, quando: { gte: passado, lte: agora } },
      ],
    },
    include: { ficha: { select: { nome: true } } },
    orderBy: [{ quando: { sort: 'asc', nulls: 'first' } }],
    take: 40,
  });
  // Um aviso por artista por tipo: a Home é um lembrete, não a agenda.
  const vistos = new Set<string>();
  const saida: AvisoDto[] = [];
  for (const e of eventos) {
    const k = `${e.chave}|${e.tipo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push({ ...dto(e), artista: e.ficha.nome, chave: e.chave });
    if (saida.length >= 12) break;
  }
  return saida;
}
