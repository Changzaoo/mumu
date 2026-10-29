/**
 * Jornada — liga semanal e indicações. Leitura e escrita no Postgres.
 */
import type { ConviteDto, JornadaDto, JornadaMembroDto } from '@radinho/shared';
import { prisma } from '../../infra/db/prisma.js';
import { ligaAposVirada, semanaIso } from './jornada.regras.js';

const TAMANHO_DO_GRUPO = 30;

interface Estado {
  semana: string;
  liga: number;
  xpSemana: number;
  sequencia: number;
  recorde: number;
}

/** Quantos estão À FRENTE na liga/semana (mais XP). Posição = isso + 1. */
function aFrente(liga: number, semana: string, xp: number): Promise<number> {
  return prisma.jornada.count({ where: { liga, semana, xpSemana: { gt: xp } } });
}

/** Monta o DTO a partir do estado da pessoa. */
async function montarDto(
  userId: string,
  eu: { handle: string; displayName: string; avatarUrl: string | null },
  estado: Estado,
): Promise<JornadaDto> {
  const { semana, liga } = estado;
  const [linhas, amigos] = await Promise.all([
    prisma.jornada.findMany({
      where: { liga, semana },
      orderBy: [{ xpSemana: 'desc' }, { atualizadoEm: 'asc' }],
      take: TAMANHO_DO_GRUPO,
      include: { user: { select: { handle: true, displayName: true, avatarUrl: true } } },
    }),
    prisma.indicacao.count({ where: { padrinhoId: userId } }),
  ]);

  // O XP que vale para mim é o do `estado` (pode ser zero numa semana ainda
  // não gravada), então uso ele em vez da linha lida.
  const grupo: JornadaMembroDto[] = linhas.map((l) => ({
    handle: l.user.handle,
    displayName: l.user.displayName,
    avatarUrl: l.user.avatarUrl,
    xp: l.userId === userId ? estado.xpSemana : l.xpSemana,
    sequencia: l.userId === userId ? estado.sequencia : l.sequencia,
    eu: l.userId === userId,
  }));

  const indice = grupo.findIndex((m) => m.eu);
  let posicao: number;
  if (indice >= 0) {
    posicao = indice + 1;
  } else {
    // Fora dos 30 (ou ainda sem linha): entro ao fim com a posição real.
    posicao = (await aFrente(liga, semana, estado.xpSemana)) + 1;
    grupo.push({
      handle: eu.handle,
      displayName: eu.displayName,
      avatarUrl: eu.avatarUrl,
      xp: estado.xpSemana,
      sequencia: estado.sequencia,
      eu: true,
    });
  }

  return {
    semana,
    liga,
    xpSemana: estado.xpSemana,
    sequencia: estado.sequencia,
    recorde: estado.recorde,
    posicao,
    grupo,
    amigos,
    handle: eu.handle,
  };
}

function carregarEu(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { handle: true, displayName: true, avatarUrl: true },
  });
}

/**
 * GET. Se a semana guardada já passou, a pessoa aparece com XP zero na semana
 * atual (a virada de liga em si só acontece quando o aparelho envia o PUT).
 */
export async function obter(userId: string): Promise<JornadaDto> {
  const [eu, j] = await Promise.all([
    carregarEu(userId),
    prisma.jornada.findUnique({ where: { userId } }),
  ]);
  const atual = semanaIso();
  const estado: Estado =
    j && j.semana >= atual
      ? {
          semana: j.semana,
          liga: j.liga,
          xpSemana: j.xpSemana,
          sequencia: j.sequencia,
          recorde: j.recorde,
        }
      : {
          semana: atual,
          liga: j?.liga ?? 0,
          xpSemana: 0,
          sequencia: j?.sequencia ?? 0,
          recorde: j?.recorde ?? 0,
        };
  return montarDto(userId, eu, estado);
}

export interface EnvioJornada {
  semana: string;
  xpSemana: number;
  sequencia: number;
  recorde: number;
}

/**
 * PUT. Semana velha: ignora o XP. Mesma semana: fica o maior. Semana nova:
 * fecha a anterior (sobe/desce de liga) e abre a nova com o XP enviado.
 */
export async function atualizar(userId: string, envio: EnvioJornada): Promise<JornadaDto> {
  const [eu, j] = await Promise.all([
    carregarEu(userId),
    prisma.jornada.findUnique({ where: { userId } }),
  ]);
  // Relógio de aparelho adiantado não pode abrir uma semana no futuro.
  const atual = semanaIso();
  const semanaEnviada = envio.semana > atual ? atual : envio.semana;

  let estado: Estado;
  let mudou: 'subiu' | 'desceu' | undefined;

  if (!j) {
    estado = {
      semana: semanaEnviada,
      liga: 0,
      xpSemana: envio.xpSemana,
      sequencia: envio.sequencia,
      recorde: Math.max(envio.recorde, envio.sequencia),
    };
  } else if (semanaEnviada < j.semana) {
    estado = {
      semana: j.semana,
      liga: j.liga,
      xpSemana: j.xpSemana,
      sequencia: envio.sequencia,
      recorde: Math.max(j.recorde, envio.recorde),
    };
  } else if (semanaEnviada === j.semana) {
    estado = {
      semana: j.semana,
      liga: j.liga,
      xpSemana: Math.max(j.xpSemana, envio.xpSemana),
      sequencia: envio.sequencia,
      recorde: Math.max(j.recorde, envio.recorde),
    };
  } else {
    // VIRADA DE SEMANA: fecha a semana guardada e decide a liga.
    const [afrente, tamanho] = await Promise.all([
      aFrente(j.liga, j.semana, j.xpSemana),
      prisma.jornada.count({ where: { liga: j.liga, semana: j.semana } }),
    ]);
    const r = ligaAposVirada({
      liga: j.liga,
      xpAntigo: j.xpSemana,
      posicao: afrente + 1,
      tamanho,
    });
    mudou = r.mudou;
    estado = {
      semana: semanaEnviada,
      liga: r.liga,
      xpSemana: envio.xpSemana,
      sequencia: envio.sequencia,
      recorde: Math.max(j.recorde, envio.recorde),
    };
  }

  await prisma.jornada.upsert({
    where: { userId },
    create: { userId, ...estado },
    update: estado,
  });

  const dto = await montarDto(userId, eu, estado);
  return mudou ? { ...dto, mudouDeLiga: mudou } : dto;
}

export type ResultadoConvite = 'padrinho-inexistente' | 'proprio-padrinho' | 'novo' | 'repetido';

/** POST /convite — ver as regras no controlador. */
export async function registrarConvite(
  handlePadrinho: string,
  deviceId: string,
  userId: string | null,
): Promise<ResultadoConvite> {
  const padrinho = await prisma.user.findUnique({
    where: { handle: handlePadrinho },
    select: { id: true },
  });
  if (!padrinho) return 'padrinho-inexistente';
  if (userId && userId === padrinho.id) return 'proprio-padrinho';

  const jaIndicada = userId
    ? (await prisma.indicacao.findFirst({ where: { indicadoId: userId } })) !== null
    : false;

  const existente = await prisma.indicacao.findUnique({ where: { deviceId } });
  if (existente) {
    // Aparelho que convidou antes de ter conta: agora a conta entrou. O
    // padrinho não muda, e uma conta só pode ser indicada uma vez.
    if (userId && !existente.indicadoId && !jaIndicada && existente.padrinhoId !== userId) {
      await prisma.indicacao.update({ where: { deviceId }, data: { indicadoId: userId } });
    }
    return 'repetido';
  }
  if (jaIndicada) return 'repetido';
  try {
    await prisma.indicacao.create({
      data: { deviceId, padrinhoId: padrinho.id, indicadoId: userId },
    });
  } catch {
    return 'repetido'; // corrida: outro pedido com o mesmo deviceId ganhou
  }
  return 'novo';
}

export async function obterConvite(handle: string): Promise<ConviteDto | null> {
  const u = await prisma.user.findUnique({
    where: { handle },
    select: { id: true, handle: true, displayName: true, avatarUrl: true },
  });
  if (!u) return null;
  const amigos = await prisma.indicacao.count({ where: { padrinhoId: u.id } });
  return { handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, amigos };
}
