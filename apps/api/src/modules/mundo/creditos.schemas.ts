import { z } from 'zod';

/** Os papéis de crédito — espelho do enum `PapelDeCredito` do Prisma. */
export const PAPEIS_DE_CREDITO = [
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
] as const;

export const papelDeCreditoSchema = z.enum(PAPEIS_DE_CREDITO);
export type PapelDeCredito = z.infer<typeof papelDeCreditoSchema>;
