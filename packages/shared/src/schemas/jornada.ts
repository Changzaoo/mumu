import { z } from 'zod';

/**
 * Jornada — a parte da retenção que precisa ser COMPARADA entre pessoas.
 *
 * Sequência de dias e conquistas são calculadas no aparelho; o servidor guarda
 * só a liga semanal e as indicações de amigos.
 */

/** Ligas, da pior para a melhor: o índice é o valor guardado (0..5). */
export const LIGAS_JORNADA = ['Bronze', 'Prata', 'Ouro', 'Safira', 'Rubi', 'Diamante'] as const;
export const LIGA_MAXIMA = LIGAS_JORNADA.length - 1;

/** Semana ISO no formato 'YYYY-Www'. */
export const semanaIsoSchema = z.string().regex(/^\d{4}-W\d{2}$/);

export const atualizarJornadaSchema = z.object({
  semana: semanaIsoSchema,
  xpSemana: z.number().int().min(0).max(20000),
  sequencia: z.number().int().min(0).max(10000),
  recorde: z.number().int().min(0).max(10000),
});
export type AtualizarJornadaInput = z.infer<typeof atualizarJornadaSchema>;

export const conviteBodySchema = z.object({
  padrinho: z.string().trim().min(1).max(64),
  deviceId: z
    .string()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9_:-]+$/, 'id de aparelho inválido'),
});
export type ConviteBody = z.infer<typeof conviteBodySchema>;

export interface JornadaMembroDto {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  sequencia: number;
  /** É a pessoa que pediu. */
  eu: boolean;
}

export interface JornadaDto {
  semana: string;
  /** 0..5 — índice em LIGAS_JORNADA. */
  liga: number;
  xpSemana: number;
  sequencia: number;
  recorde: number;
  /** 1-based no grupo da liga. */
  posicao: number;
  grupo: JornadaMembroDto[];
  /** Quantos amigos entraram pelo convite desta pessoa. */
  amigos: number;
  handle: string;
  /** Só na resposta do PUT, quando a virada de semana mudou a liga. */
  mudouDeLiga?: 'subiu' | 'desceu';
}

export interface ConviteDto {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  amigos: number;
}
