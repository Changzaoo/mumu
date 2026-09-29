/**
 * A VARREDURA DE DURAÇÕES — toda faixa do acervo com o tempo de verdade.
 *
 * O PROBLEMA. Faixa importada pelo servidor (link colado com o app fechado,
 * playlist inteira) nascia com `durationMs: 0`, na aposta de que o aparelho
 * mediria na primeira vez que tocasse. Só que faixa que ninguém tocou nunca é
 * medida, e a medida do aparelho numa faixa EMPRESTADA do acervo nem sobe para
 * o servidor. Resultado: listas inteiras mostrando "0:00" (várias do mesmo
 * álbum, porque vieram na mesma playlist), e algumas com um tempo errado — o
 * palpite que o navegador faz no meio de um stream parcial ("0:14" numa faixa
 * de quatro minutos).
 *
 * O CONSERTO BARATO. A duração está no cabeçalho do próprio MP3 (quadros
 * contados pelo encoder — ver `duracaoDoMp3` no shared). Então, para cada faixa
 * com cópia no cofre e sem duração confiável, este agente lê só o COMEÇO do
 * arquivo (duas leituras com Range: a etiqueta ID3 com a capa, depois alguns
 * KB de áudio) — nada de baixar a música, nada de ffprobe.
 *
 * O QUE ELE GRAVA. A duração no acervo e nas cópias da faixa guardadas nas
 * bibliotecas das contas (com `updatedAt` novo, que é o que a sincronia por
 * delta leva para todos os aparelhos). A biblioteca só é corrigida quando o
 * valor dela está ausente ou longe do medido: duração boa não se mexe.
 *
 * O QUE ELE NUNCA FAZ.
 *  • Não conclui nada de 503/rede: o cofre pode estar reconstruindo. Tenta de
 *    novo na próxima volta.
 *  • Não grava `0`. Arquivo que não é MP3 (upload de m4a, flac) ganha a marca
 *    `duracaoSemMedida` e sai da fila — quem mede esse é o aparelho que tocar.
 *
 * RITMO. Lote pequeno a cada poucos minutos: o cofre é a mesma máquina que
 * serve música. Um acervo de milhares de faixas zera em algumas horas.
 */
import { duracaoDoMp3, tamanhoDoId3 } from '@radinho/shared';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';
import { baseInterna } from './varreduraNoturna.worker.js';

const log = logger.child({ worker: 'duracoes' });

/** Faixas por volta — ver RITMO. */
const LOTE = 100;
/**
 * Entre voltas. Não mais curto que isto: cada volta que CORRIGE alguma faixa
 * muda o ETag do acervo, e todo aparelho baixa a listagem de novo.
 */
const INTERVALO_MS = 10 * 60_000;
/** Teto de cópias de biblioteca preenchidas a partir do acervo por volta. */
const LOTE_BIBLIOTECA = 500;
/** Cópia que não respondeu neste tempo não provou nada. */
const TIMEOUT_MS = 15_000;
/** Primeira leitura: cabe a ID3 de quase todo arquivo (capa de ~30-60 KB). */
const PRIMEIRA_LEITURA = 128 * 1024;
/** Segunda leitura, depois de uma ID3 maior: o cabeçalho de quadros está aqui. */
const SEGUNDA_LEITURA = 16 * 1024;
/**
 * Abaixo disto a duração gravada é SUSPEITA e vale conferir uma vez: é a faixa
 * de "0:14" — o palpite do navegador em stream parcial que um aparelho gravou.
 * Vinheta curta de verdade também cai aqui; conferida, ganha a marca e sai.
 */
const SUSPEITA_MS = 30_000;

type Obj = Record<string, unknown>;

/** O endereço por onde ESTE servidor alcança a cópia. */
export function urlParaLer(remoteUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  // A URL gravada é a PÚBLICA (túnel, Cloudflare). Daqui, o caminho interno é
  // mais curto e não passa por limite nenhum do túnel.
  const interna = baseInterna();
  if (interna && u.pathname.startsWith('/blob/')) return `${interna}${u.pathname}${u.search}`;
  return u.toString();
}

type Leitura = { bytes: Uint8Array; total: number } | 'morta' | 'incerta';

/** Lê `[inicio, inicio + n)` do arquivo, sem nunca baixar mais que isso. */
async function lerTrecho(url: string, inicio: number, n: number): Promise<Leitura> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      // Nada de Authorization: é o token `k` da URL que abre a cópia.
      headers: { Range: `bytes=${inicio}-${inicio + n - 1}` },
      signal: controller.signal,
    });
    if (res.status === 404 || res.status === 403 || res.status === 416) return 'morta';
    if (!res.ok || !res.body) return 'incerta';
    const faixa = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    const total = faixa
      ? Number(faixa[1])
      : res.status === 200
        ? Number(res.headers.get('content-length') ?? 0)
        : 0;
    // Quem ignorou o Range manda o arquivo inteiro: lemos só o que cabe.
    const pedacos: Uint8Array[] = [];
    let lidos = 0;
    const leitor = res.body.getReader();
    const pular = res.status === 200 ? inicio : 0;
    while (lidos < pular + n) {
      const { done, value } = await leitor.read();
      if (done || !value) break;
      pedacos.push(value);
      lidos += value.length;
    }
    void leitor.cancel().catch(() => undefined);
    const tudo = new Uint8Array(lidos);
    let i = 0;
    for (const p of pedacos) {
      tudo.set(p, i);
      i += p.length;
    }
    return { bytes: tudo.subarray(pular, pular + n), total };
  } catch {
    return 'incerta';
  } finally {
    clearTimeout(timer);
  }
}

/** Duração da cópia no cofre, lida do cabeçalho. */
export async function medirCopia(url: string): Promise<number | null | 'morta' | 'incerta'> {
  const cabeca = await lerTrecho(url, 0, PRIMEIRA_LEITURA);
  if (typeof cabeca === 'string') return cabeca;
  const ms = duracaoDoMp3(cabeca.bytes, cabeca.total);
  if (ms) return ms;
  // A capa embutida era maior que a primeira leitura: pula a etiqueta inteira.
  const id3 = tamanhoDoId3(cabeca.bytes);
  if (id3 <= cabeca.bytes.length || cabeca.total <= id3) return null;
  const corpo = await lerTrecho(url, id3, SEGUNDA_LEITURA);
  if (typeof corpo === 'string') return corpo;
  return duracaoDoMp3(corpo.bytes, cabeca.total, id3);
}

/** Longe o bastante para a medida vencer a gravada (e não um arredondamento). */
export function divergeMuito(gravada: unknown, medida: number): boolean {
  if (!(typeof gravada === 'number' && Number.isFinite(gravada) && gravada > 0)) return true;
  return Math.abs(gravada - medida) > Math.max(5000, medida * 0.1);
}

/**
 * As faixas com cópia e sem duração confiável. `CASE` antes do cast, porque o
 * Postgres não promete a ordem de um `OR`: um `durationMs` que chegou como
 * texto derrubaria a consulta inteira, e o agente com ela.
 */
async function candidatas(limite: number): Promise<Array<{ id: string; data: CatalogEntry }>> {
  const linhas = await prisma.$queryRaw<Array<{ id: string; data: unknown }>>`
    SELECT id, data FROM "CatalogTrack"
    WHERE COALESCE(data->>'remoteUrl', data->'track'->>'streamUrl') LIKE 'http%'
      AND COALESCE(data->>'duracaoSemMedida', '') = ''
      AND COALESCE(data->>'duracaoMedidaEm', '') = ''
      AND (CASE WHEN jsonb_typeof(data->'track'->'durationMs') = 'number'
                THEN (data->'track'->>'durationMs')::float8 ELSE 0 END) < ${SUSPEITA_MS}::int
    ORDER BY "updatedAt" DESC
    LIMIT ${limite}
  `;
  return linhas.map((l) => ({ id: l.id, data: l.data as CatalogEntry }));
}

/**
 * Leva a duração às bibliotecas das contas que guardam esta faixa. `updatedAt`
 * explícito porque SQL cru não passa pelo `@updatedAt` do Prisma — e é por ele
 * que a sincronia descobre o que mudou.
 */
async function corrigirBibliotecas(id: string, ms: number): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "UserCollectionItem"
    SET data = jsonb_set(data::jsonb, '{track,durationMs}', to_jsonb(${ms}::int)),
        "updatedAt" = now()
    WHERE collection = 'library' AND "itemId" = ${id} AND deleted = false
      AND jsonb_typeof(data->'track') = 'object'
      AND ABS((CASE WHEN jsonb_typeof(data->'track'->'durationMs') = 'number'
                    THEN (data->'track'->>'durationMs')::float8 ELSE 0 END) - ${ms}::int)
          > GREATEST(5000, ${ms}::int * 0.1)
  `;
}

/**
 * A marca que tira a faixa da fila — SEM mexer no `updatedAt`. A marca não
 * aparece na listagem (é campo do servidor), então bumpar o carimbo faria o
 * acervo inteiro parecer mudado para todo aparelho à toa.
 */
async function marcar(id: string, campo: 'duracaoMedidaEm' | 'duracaoSemMedida'): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "CatalogTrack"
    SET data = jsonb_set(data::jsonb, ARRAY[${campo}]::text[], to_jsonb(${new Date().toISOString()}::text))
    WHERE id = ${id}
  `;
}

/**
 * A outra metade do backfill: a cópia da faixa na biblioteca de uma conta
 * ficou com `0` mesmo quando o acervo já sabe a duração (importada antes desta
 * correção, publicada por outro aparelho…). Copia do acervo, em lote e com
 * teto, só onde a biblioteca não tem valor nenhum.
 */
export async function preencherBibliotecasPeloAcervo(limite = LOTE_BIBLIOTECA): Promise<number> {
  // O teto fica no SELECT de dentro, que já só enxerga linhas que TÊM o que
  // receber: um teto sobre "sem duração" em geral podia travar para sempre nas
  // mesmas 500 faixas que o acervo também não conhece.
  return prisma.$executeRaw`
    UPDATE "UserCollectionItem" AS u
    SET data = jsonb_set(u.data::jsonb, '{track,durationMs}', c.data->'track'->'durationMs'),
        "updatedAt" = now()
    FROM "CatalogTrack" AS c
    WHERE u."itemId" = c.id
      AND (u."userId", u.collection, u."itemId") IN (
        SELECT l."userId", l.collection, l."itemId"
        FROM "UserCollectionItem" AS l
        JOIN "CatalogTrack" AS a ON a.id = l."itemId"
        WHERE l.collection = 'library' AND l.deleted = false
          AND jsonb_typeof(l.data->'track') = 'object'
          AND (CASE WHEN jsonb_typeof(a.data->'track'->'durationMs') = 'number'
                    THEN (a.data->'track'->>'durationMs')::float8 ELSE 0 END) >= 1000
          AND (CASE WHEN jsonb_typeof(l.data->'track'->'durationMs') = 'number'
                    THEN (l.data->'track'->>'durationMs')::float8 ELSE 0 END) <= 0
        LIMIT ${limite}
      )
  `;
}

/** Uma volta. Exportada para ser testada sem esperar o relógio. */
export async function medirLote(
  limite = LOTE,
): Promise<{ vistas: number; medidas: number; semMedida: number; bibliotecas: number }> {
  const lista = await candidatas(limite);
  let medidas = 0;
  let semMedida = 0;
  for (const c of lista) {
    const dados = c.data as Obj;
    const track = (dados.track ?? {}) as Obj;
    const remota = String(dados.remoteUrl ?? track.streamUrl ?? '');
    const url = urlParaLer(remota);
    const r = url ? await medirCopia(url) : null;
    if (r === 'incerta') continue; // tenta na próxima volta
    if (r === null || r === 'morta') {
      // Morta é assunto do acervo fiel; aqui só sai da fila de durações.
      semMedida++;
      await marcar(c.id, 'duracaoSemMedida');
      continue;
    }
    medidas++;
    if (divergeMuito(track.durationMs, r)) {
      // Mudou o que a lista mostra: aqui SIM o carimbo precisa andar, para os
      // aparelhos baixarem a duração nova.
      await upsertCatalogTrack(c.id, {
        ...dados,
        track: { ...track, durationMs: r },
        duracaoMedidaEm: new Date().toISOString(),
      });
    } else {
      await marcar(c.id, 'duracaoMedidaEm'); // a gravada já estava certa
    }
    const contas = await corrigirBibliotecas(c.id, r).catch((err: unknown) => {
      log.warn({ err, faixa: c.id }, 'duração medida, mas a biblioteca não aceitou');
      return 0;
    });
    if (contas > 0) log.debug({ faixa: c.id, contas }, 'duração levada às bibliotecas');
  }
  const bibliotecas = await preencherBibliotecasPeloAcervo().catch((err: unknown) => {
    log.warn({ err }, 'bibliotecas não receberam as durações do acervo');
    return 0;
  });
  return { vistas: lista.length, medidas, semMedida, bibliotecas };
}

/** Sobe o laço. Devolve a parada, no mesmo contrato dos outros agentes. */
export function startDuracoesWorker(intervaloMs = INTERVALO_MS): () => void {
  let parado = false;
  let timer: NodeJS.Timeout | null = null;

  const volta = async (): Promise<void> => {
    if (parado) return;
    try {
      const r = await medirLote();
      if (r.vistas > 0 || r.bibliotecas > 0) log.info(r, 'durações medidas no cofre');
    } catch (err) {
      log.error({ err }, 'volta da varredura de durações falhou');
    }
    if (parado) return;
    timer = setTimeout(() => void volta(), intervaloMs);
    timer.unref();
  };

  log.info({ intervaloMs, lote: LOTE }, 'varredura de durações iniciada');
  void volta();

  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
