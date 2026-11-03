/**
 * RESTAURAR O `remoteUrl` DAS FAIXAS que perderam a cópia, a partir do índice
 * da borda (o áudio existe em musicas.radinho.online/blob/<id>?k=<k>).
 *
 *   npx tsx src/scripts/restaurarCopiasDoIndice.ts --indice D:/.../indice.json --dry-run
 *   node dist/scripts/restaurarCopiasDoIndice.js --indice indice.json
 *
 * Só toca `data.remoteUrl`, `data.track.streamUrl` e `data.mimeType`, e só em
 * quem está SEM remoteUrl. Antes de gravar, guarda as linhas que vai mudar em
 * `catalog_backup_remoteurl_YYYYMMDD` (para reverter com um UPDATE ... FROM).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../infra/db/prisma.js';
import {
  lerIndice,
  nomeDoBackup,
  restaurar,
  semRemoteUrl,
  totaisVazios,
} from './restaurarCopias.js';

const LOTE = 500;

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const caminho = arg('--indice');
  if (!caminho) throw new Error('faltou --indice <caminho do indice.json>');
  const dry = process.argv.includes('--dry-run');
  const indice = lerIndice(readFileSync(resolve(caminho), 'utf8'));
  console.log(`índice: ${indice.size} ids${dry ? ' (dry-run)' : ''}`);

  // 1ª passada: só decide quais ids mudam (não grava nada).
  const totais = totaisVazios();
  const alvos: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const linhas = await prisma.catalogTrack.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: LOTE,
      select: { id: true, data: true },
    });
    if (linhas.length === 0) break;
    cursor = linhas[linhas.length - 1]?.id;
    for (const l of linhas) {
      if (!semRemoteUrl(l.data)) continue;
      totais.semRemote++;
      if (indice.has(l.id)) {
        totais.noIndice++;
        alvos.push(l.id);
      } else totais.foraDoIndice++;
    }
  }

  if (!dry && alvos.length > 0) {
    const tabela = nomeDoBackup();
    if (!/^catalog_backup_remoteurl_\d{8}$/.test(tabela))
      throw new Error('nome de backup inválido');
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${tabela}" AS SELECT id, data FROM "CatalogTrack" WHERE false`,
    );
    for (let i = 0; i < alvos.length; i += LOTE) {
      const ids = alvos.slice(i, i + LOTE);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${tabela}" (id, data) SELECT id, data FROM "CatalogTrack" WHERE id = ANY($1::text[]) AND id NOT IN (SELECT id FROM "${tabela}")`,
        ids,
      );
    }
    console.log(`backup: ${tabela}`);
    for (let i = 0; i < alvos.length; i += LOTE) {
      const linhas = await prisma.catalogTrack.findMany({
        where: { id: { in: alvos.slice(i, i + LOTE) } },
        select: { id: true, data: true },
      });
      for (const l of linhas) {
        const novo = restaurar(l.id, l.data, indice); // recheca: só quem ainda está sem cópia
        if (!novo) continue;
        await prisma.catalogTrack.update({ where: { id: l.id }, data: { data: novo as object } });
        totais.restauradas++;
      }
    }
  }

  console.log(
    `sem remoteUrl: ${totais.semRemote} · no índice: ${totais.noIndice} · restauradas: ${totais.restauradas} · fora do índice: ${totais.foraDoIndice}`,
  );
}

main()
  .catch((err) => {
    console.error('restauração abortada:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
