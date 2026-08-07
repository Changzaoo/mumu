#!/usr/bin/env node
/**
 * Refaz as METAS que a poda antiga apagou — o que devolve vida às faixas mudas.
 *
 * O PROBLEMA. O cofre tem teto e descarta as faixas menos tocadas. Até hoje o
 * descarte apagava o `.bin` E o `.json` da faixa. Como o token de acesso mora no
 * `.json`, a faixa descartada virava 404 PERMANENTE: nem o dono nem quem tinha
 * um link compartilhado conseguia ouvir de novo, e não havia como reemitir.
 *
 * Medido no acervo servido em produção, antes deste conserto:
 *   4.416 faixas | 1.185 sem URL nenhuma (27%) | ~1.480 com URL e 404 (34%)
 *   → 60% do acervo mudo, para visitante e para dono
 *
 * A POSSIBILIDADE. O acervo no Postgres guarda, por faixa, o `remoteUrl`
 * completo — e ele CARREGA o id e o token dentro de si:
 *
 *   https://importer.../blob/local%3A<uuid>?k=<token>
 *
 * Então a meta perdida é reconstruível: id e token saem da URL, `sourceUrl` sai
 * da própria linha do acervo. Com a meta de volta, o `GET /blob/` encontra o
 * token, vê que os bytes sumiram, e reextrai da origem — ver `reconstruirBlob`
 * em apps/importer/server.mjs.
 *
 * O QUE ESTE SCRIPT NÃO FAZ: baixar áudio. Ele só devolve o bilhete de acesso.
 * A reextração acontece sob demanda, quando alguém realmente pedir a faixa, com
 * teto de simultaneidade — de outro modo seriam 1.480 extrações de uma vez, e
 * isso derruba o IP para todo mundo.
 *
 * Idempotente: meta completa não é tocada; meta antiga só ganha a origem.
 *
 * Uso (no servidor):
 *   node infra/scripts/refazer-metas-do-cofre.mjs [--aplicar]
 * Sem `--aplicar` ele só relata o que faria.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APLICAR = process.argv.includes('--aplicar');
const BLOB_DIR = process.env.BLOB_DIR ?? '/mnt/cartaosd/aurial-blobs';

// A consulta devolve JSON de propósito. Separar a saída por um caractere de
// controle quebraria em qualquer URL que o contivesse — e URL de origem é
// justamente onde isso aconteceria sem ninguém notar.
const SQL = `SELECT coalesce(json_agg(json_build_object(
               'remote', data->>'remoteUrl',
               'source', data->>'sourceUrl')), '[]'::json)
             FROM "CatalogTrack"
             WHERE data->>'remoteUrl' IS NOT NULL`;

/** Extrai id e token de uma URL de capacidade do cofre. */
function lerUrl(remote) {
  try {
    const u = new URL(remote);
    if (!u.pathname.startsWith('/blob/')) return null;
    const id = decodeURIComponent(u.pathname.slice('/blob/'.length));
    const token = u.searchParams.get('k');
    return id && token ? { id, token } : null;
  } catch {
    return null;
  }
}

const existe = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function main() {
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', '-i', 'aurial-postgres-1', 'psql', '-U', 'aurial', '-d', 'aurial', '-t', '-A', '-c', SQL],
    { maxBuffer: 128 * 1024 * 1024 },
  );

  const linhas = JSON.parse(stdout.trim() || '[]');

  let comBytes = 0;
  let completas = 0;
  let refeitas = 0;
  let completadas = 0;
  let semOrigem = 0;
  let urlEstranha = 0;

  for (const { remote, source } of linhas) {
    const alvo = lerUrl(remote);
    if (!alvo) {
      urlEstranha += 1;
      continue;
    }
    const nome = encodeURIComponent(alvo.id);
    const metaPath = path.join(BLOB_DIR, `${nome}.json`);
    const binPath = path.join(BLOB_DIR, `${nome}.bin`);

    if (await existe(binPath)) comBytes += 1;

    if (await existe(metaPath)) {
      // A meta sobreviveu, mas pode ser de antes deste conserto e não trazer a
      // origem — sem ela a reconstrução não tem de onde puxar os bytes.
      let atual = null;
      try {
        atual = JSON.parse(await readFile(metaPath, 'utf8'));
      } catch {
        atual = null; // ilegível: tratada abaixo como ausente
      }
      if (atual && atual.sourceUrl) {
        completas += 1;
        continue;
      }
      if (atual && source) {
        if (APLICAR) await writeFile(metaPath, JSON.stringify({ ...atual, sourceUrl: source }));
        completadas += 1;
        continue;
      }
      if (atual) {
        semOrigem += 1;
        continue;
      }
    }

    if (!source) {
      // Sem origem não há como reconstruir; escrever a meta só criaria um 404
      // mais lento. Melhor contar e deixar visível.
      semOrigem += 1;
      continue;
    }
    if (APLICAR) {
      await writeFile(
        metaPath,
        JSON.stringify({
          token: alvo.token,
          contentType: 'audio/mpeg',
          size: 0, // desconhecido até a reconstrução regravar os bytes
          sourceUrl: source,
        }),
      );
    }
    refeitas += 1;
  }

  console.log(APLICAR ? '=== APLICADO ===' : '=== SIMULACAO (use --aplicar) ===');
  console.log(`  faixas no acervo com remoteUrl : ${linhas.length}`);
  console.log(`  metas REFEITAS (estavam sumidas): ${refeitas}`);
  console.log(`  metas completadas com a origem : ${completadas}`);
  console.log(`  ja estavam completas           : ${completas}`);
  console.log(`  sem origem (irrecuperavel)     : ${semOrigem}`);
  console.log(`  remoteUrl fora do padrao       : ${urlEstranha}`);
  console.log(`  bytes ainda no cofre           : ${comBytes}`);
}

main().catch((err) => {
  console.error('falhou:', err.message);
  process.exit(1);
});
