/**
 * O teto diário do pesquisador sobrevive a reinício (WorkerState) e conta o
 * dia no relógio de São Paulo, não em UTC.
 */
import { describe, expect, it, vi } from 'vitest';

const env: Record<string, unknown> = {
  IMPORTER_URL: 'http://importer:8790',
  IMPORT_SERVICE_TOKEN: 'tok',
  PESQUISADOR_MAX_POR_DIA: 5,
};
vi.mock('../config/index.js', () => ({ env }));
vi.mock('../core/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn() },
}));
const findUnique = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('../infra/db/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => []),
    workerState: { findUnique, upsert: vi.fn(async () => undefined) },
  },
}));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack: vi.fn() }));

const { diaLocal, pesquisarUmaVez } = await import('./pesquisador.worker.js');

describe('teto diário', () => {
  it('o dia é o de São Paulo: 01:00 UTC ainda é o dia anterior', () => {
    expect(diaLocal(new Date('2026-11-03T01:00:00Z'))).toBe('2026-11-02');
    expect(diaLocal(new Date('2026-11-03T12:00:00Z'))).toBe('2026-11-03');
  });

  it('o que foi trazido antes do reinício continua contando', async () => {
    const agora = new Date('2026-11-03T15:00:00Z');
    findUnique.mockResolvedValueOnce({ value: { dia: '2026-11-03', trazidasHoje: 5 } });
    const r = await pesquisarUmaVez(agora);
    expect(r).toMatchObject({ rodou: false, motivo: 'teto do dia alcançado' });
    expect(findUnique).toHaveBeenCalledWith({ where: { key: 'pesquisador.teto' } });
  });
});
