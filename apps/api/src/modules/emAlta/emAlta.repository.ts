/**
 * Onde o "em alta" fica gravado: uma linha de `WorkerState`, chave
 * `emAlta.paradas`. O worker grava, a rota lê. Sem tabela nova: é um retrato
 * que o próximo retrato substitui inteiro.
 */
import type { EmAltaDto } from '@radinho/shared';
import { prisma } from '../../infra/db/prisma.js';

export const CHAVE_EM_ALTA = 'emAlta.paradas';

export async function gravarEmAlta(dto: EmAltaDto): Promise<void> {
  await prisma.workerState.upsert({
    where: { key: CHAVE_EM_ALTA },
    create: { key: CHAVE_EM_ALTA, value: dto as object },
    update: { value: dto as object },
  });
}

export async function lerEmAlta(): Promise<EmAltaDto | null> {
  const linha = await prisma.workerState.findUnique({ where: { key: CHAVE_EM_ALTA } });
  const valor = linha?.value as Partial<EmAltaDto> | null | undefined;
  if (!valor || typeof valor.atualizadoEm !== 'string' || !Array.isArray(valor.generos)) return null;
  return { atualizadoEm: valor.atualizadoEm, generos: valor.generos };
}
