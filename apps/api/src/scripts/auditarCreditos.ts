/**
 * AUDITAR OS CRÉDITOS DO ACERVO (título/artista) — NÃO GRAVA NADA por padrão.
 *
 *   npx tsx src/scripts/auditarCreditos.ts --saida relatorio.json
 *   npx tsx src/scripts/auditarCreditos.ts --saida relatorio.json --dry-run        (inclui a PROPOSTA)
 *   npx tsx src/scripts/auditarCreditos.ts --saida relatorio.json --corrigir       (GRAVA, com backup)
 *
 * Varre `CatalogTrack` em lotes de 500 (sem o vetor `dna`) e escreve o relatório
 * JSON com as faixas suspeitas (ver auditarCreditos.logica.ts: artista = canal/
 * gravadora, título de vídeo não separado, "feat"/lista no artista, Desconhecido,
 * artista dentro do título, artista sem prova no vídeo original, parser de hoje
 * diverge do gravado).
 *
 * `--corrigir` aplica a correção proposta pelo parser (tituloDeVideo) e SÓ ENTÃO
 * grava: antes copia as linhas que vai mexer para a tabela
 * `catalog_backup_creditos_YYYYMMDD` (restaurar = copiar `data` de volta). Com
 * `--dry-run` junto, nada é gravado — só a proposta entra no relatório.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import {
  aplicarCorrecao,
  auditarFaixa,
  faixaDoAcervo,
  montarRelatorio,
  nomeDaTabelaDeBackup,
  proporCorrecao,
  TABELA_DE_BACKUP_VALIDA,
  type ItemDoRelatorio,
} from './auditarCreditos.logica.js';

const log = logger.child({ script: 'auditarCreditos' });
const LOTE = 500;

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string): boolean => process.argv.includes(nome);

const SAIDA = resolve(arg('--saida') ?? 'auditoria-creditos.json');
const DRY = tem('--dry-run');
const CORRIGIR = tem('--corrigir');
const PROPOR = DRY || CORRIGIR;

async function lerLote(depoisDe: string): Promise<Array<{ id: string; data: unknown }>> {
  return prisma.$queryRaw<Array<{ id: string; data: unknown }>>`
    SELECT id, (data::jsonb - 'dna') AS data
    FROM "CatalogTrack"
    WHERE id > ${depoisDe}
    ORDER BY id ASC
    LIMIT ${LOTE}
  `;
}

async function garantirBackup(tabela: string): Promise<void> {
  if (!TABELA_DE_BACKUP_VALIDA.test(tabela)) throw new Error(`nome de backup inválido: ${tabela}`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${tabela} (id text PRIMARY KEY, data jsonb NOT NULL, "salvoEm" timestamptz NOT NULL DEFAULT now())`,
  );
}

async function gravar(
  tabela: string,
  id: string,
  novoTrack: Record<string, unknown>,
): Promise<void> {
  // Backup do `data` ORIGINAL (com dna) antes de tocar; não sobrescreve um
  // backup anterior da mesma faixa no mesmo dia (o primeiro é o original).
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${tabela} (id, data) SELECT id, data::jsonb FROM "CatalogTrack" WHERE id = $1 ON CONFLICT (id) DO NOTHING`,
    id,
  );
  // Só `track` muda: jsonb_set preserva o `dna` e tudo o mais sem lê-lo para a memória.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "CatalogTrack"
    SET data = jsonb_set(data::jsonb, '{track}', ${JSON.stringify(novoTrack)}::jsonb)
    WHERE id = ${id}
  `);
}

async function main(): Promise<void> {
  const itens: ItemDoRelatorio[] = [];
  const aGravar: Array<{
    id: string;
    data: unknown;
    correcao: NonNullable<ItemDoRelatorio['proposta']>;
  }> = [];
  let total = 0;
  let ultimo = '';
  for (;;) {
    const lote = await lerLote(ultimo);
    if (lote.length === 0) break;
    for (const linha of lote) {
      total++;
      ultimo = linha.id;
      const f = faixaDoAcervo(linha.id, linha.data);
      if (!f) continue;
      const achados = auditarFaixa(f);
      if (achados.length === 0) continue;
      const item: ItemDoRelatorio = {
        id: f.id,
        titulo: f.titulo,
        artistas: f.artistas,
        tituloOriginal: f.tituloOriginal,
        achados,
      };
      if (PROPOR) {
        const proposta = proporCorrecao(f, achados);
        item.proposta = proposta;
        if (proposta) aGravar.push({ id: f.id, data: linha.data, correcao: proposta });
      }
      itens.push(item);
    }
    log.info({ lidas: total, sinalizadas: itens.length }, 'lote auditado');
  }

  const relatorio = montarRelatorio(itens, total);
  writeFileSync(SAIDA, JSON.stringify(relatorio, null, 2));
  console.log(`relatório: ${SAIDA}`);
  console.log(
    `${relatorio.total} faixas, ${relatorio.sinalizadas} sinalizadas`,
    relatorio.porCodigo,
  );

  if (!CORRIGIR) {
    console.log(
      DRY ? `[dry-run] ${aGravar.length} correções propostas (nada gravado)` : 'nada gravado',
    );
    return;
  }
  if (DRY) {
    console.log(`[dry-run] ${aGravar.length} correções propostas (nada gravado)`);
    return;
  }
  const tabela = nomeDaTabelaDeBackup(new Date());
  await garantirBackup(tabela);
  let gravadas = 0;
  for (const x of aGravar) {
    const track = ((x.data as { track?: Record<string, unknown> }).track ?? {}) as Record<
      string,
      unknown
    >;
    await gravar(tabela, x.id, aplicarCorrecao(track, x.correcao));
    gravadas++;
  }
  console.log(`${gravadas} faixas corrigidas; backup em ${tabela}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
