/**
 * Agente do acervo fiel — o acervo não pode anunciar cópia que não existe.
 *
 * O PROBLEMA. Cada entrada do acervo carrega um `remoteUrl`: a cópia do áudio
 * no cofre do importador, e a ÚNICA forma de qualquer aparelho ouvir aquela
 * faixa (o áudio original mora só na máquina que importou). Uma poda antiga do
 * cofre apagava a meta junto com os bytes, e sem a meta não há token nem como
 * reconstruir: a URL vira 404 permanente. O acervo, porém, continuou anunciando
 * essas cópias como se estivessem lá.
 *
 * O que isso produz do lado de quem ouve: um catálogo cheio de faixas que
 * respondem silêncio. Medido em 2026-08-30, com um `Range: bytes=0-0` numa
 * amostra das entradas que anunciavam cópia: cerca de um terço respondia 404.
 * O app aprendeu a contornar (pula e emenda em outra), mas contornar mentira do
 * servidor é remendo — o servidor é que não pode mentir.
 *
 * O QUE ELE FAZ. Varre o acervo devagar, em lotes, perguntando ao cofre se cada
 * cópia ainda serve. Quando a resposta é definitiva — 404/403, "não tenho isso"
 * —, apaga o `remoteUrl` e o `track.streamUrl` da entrada. O app já esconde
 * entrada sem cópia (ver `temComoTocar` em localLibrary), então a faixa some da
 * tela em vez de virar um card mudo.
 *
 * O QUE ELE NUNCA FAZ.
 *  • Não apaga a entrada nem o `sourceUrl`. É o `sourceUrl` que permite trazer
 *    a faixa de volta um dia: reimportar da origem e publicar cópia nova. Este
 *    agente esconde o que não toca; não joga fora o caminho de volta.
 *  • Não conclui nada de erro de rede, tempo esgotado ou 5xx. O cofre responde
 *    503 enquanto RECONSTRÓI uma faixa podada — tratar isso como morte mataria
 *    justamente a cópia que estava voltando. Só 404/403 é morte, que é a mesma
 *    regra que o app usa em `reportDeadRemote`.
 *
 * RITMO. O cofre roda na mesma máquina, então a varredura é deliberadamente
 * lenta: um lote pequeno por volta, com um cursor que dá a volta no acervo em
 * algumas horas. Descobrir isso um dia mais tarde não custa nada; sufocar o
 * importador que está servindo música custa.
 */
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';

const log = logger.child({ worker: 'acervo-fiel' });

/** Quantas cópias conferir por volta. Pequeno de propósito — ver RITMO. */
const LOTE = 60;
/** Quantas conferências em voo ao mesmo tempo. Espera rede, não CPU. */
const SIMULTANEAS = 6;
/** Uma cópia que não respondeu neste tempo não provou nada. */
const TIMEOUT_MS = 10_000;

/** Onde a varredura parou — o cursor dá a volta no acervo sozinho. */
let cursor: string | null = null;

export type Veredito = 'viva' | 'morta' | 'incerta';

/**
 * O que a resposta do cofre significa.
 *
 * Separado da rede para ser testável sem servidor: é aqui que mora a regra que
 * decide se uma faixa some do acervo, e ela precisa ser óbvia de ler.
 */
export function vereditoDeStatus(status: number): Veredito {
  if (status === 404 || status === 403) return 'morta';
  if (status >= 200 && status < 400) return 'viva';
  return 'incerta'; // 5xx, 429, 503 do cofre reconstruindo…
}

/** Pergunta ao cofre se a cópia ainda serve, sem baixar a música inteira. */
export async function conferirCopia(url: string): Promise<Veredito> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    return vereditoDeStatus(res.status);
  } catch {
    return 'incerta'; // rede/abort: nada provado
  } finally {
    clearTimeout(timer);
  }
}

interface EntradaDoAcervo {
  remoteUrl?: unknown;
  track?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * A entrada sem a cópia morta.
 *
 * Devolve `null` quando não havia nada a fazer, para que o chamador não gaste
 * uma escrita (e um `updatedAt` novo, que faria o acervo inteiro parecer
 * mudado para todos os clientes) à toa.
 */
export function semACopiaMorta(dados: EntradaDoAcervo, urlMorta: string): EntradaDoAcervo | null {
  if (dados.remoteUrl !== urlMorta) return null;
  const { remoteUrl: _fora, ...resto } = dados;
  const track = dados.track;
  return {
    ...resto,
    ...(track
      ? { track: { ...track, streamUrl: track.streamUrl === urlMorta ? null : track.streamUrl } }
      : {}),
  };
}

/** Uma volta: confere um lote e apaga as cópias que o cofre já não tem. */
export async function conferirLote(limite = LOTE): Promise<{ conferidas: number; mortas: number }> {
  const linhas = await prisma.catalogTrack.findMany({
    where: cursor ? { id: { gt: cursor } } : undefined,
    orderBy: { id: 'asc' },
    take: limite,
  });

  if (linhas.length === 0) {
    if (cursor !== null) {
      log.info('acervo varrido de ponta a ponta — recomeçando do início');
      cursor = null;
    }
    return { conferidas: 0, mortas: 0 };
  }
  cursor = linhas[linhas.length - 1]?.id ?? null;

  const candidatas = linhas
    .map((linha) => ({ id: linha.id, dados: linha.data as EntradaDoAcervo }))
    .filter(
      (c): c is { id: string; dados: EntradaDoAcervo & { remoteUrl: string } } =>
        typeof c.dados?.remoteUrl === 'string' && c.dados.remoteUrl.startsWith('http'),
    );

  let mortas = 0;
  for (let i = 0; i < candidatas.length; i += SIMULTANEAS) {
    const fatia = candidatas.slice(i, i + SIMULTANEAS);
    const vereditos = await Promise.all(fatia.map((c) => conferirCopia(c.dados.remoteUrl)));
    for (const [j, veredito] of vereditos.entries()) {
      const alvo = fatia[j];
      if (!alvo || veredito !== 'morta') continue;
      const novos = semACopiaMorta(alvo.dados, alvo.dados.remoteUrl);
      if (!novos) continue;
      try {
        await prisma.catalogTrack.update({
          where: { id: alvo.id },
          data: { data: novos as object },
        });
        mortas += 1;
        log.info({ faixa: alvo.id }, 'cópia sumiu do cofre — acervo para de anunciá-la');
      } catch (err) {
        log.warn({ err, faixa: alvo.id }, 'falha ao remover cópia morta do acervo');
      }
    }
  }

  return { conferidas: candidatas.length, mortas };
}

/** Sobe o laço. Devolve a parada, no mesmo contrato dos outros agentes. */
export function startAcervoFielWorker(intervaloMs = env.ACERVO_FIEL_INTERVAL_MS): () => void {
  let parado = false;
  let timer: NodeJS.Timeout | null = null;

  const volta = async (): Promise<void> => {
    if (parado) return;
    try {
      const { conferidas, mortas } = await conferirLote();
      if (mortas > 0) log.info({ conferidas, mortas }, 'lote conferido');
      else log.debug({ conferidas }, 'lote conferido');
    } catch (err) {
      log.error({ err }, 'volta do agente do acervo falhou');
    }
    if (parado) return;
    timer = setTimeout(() => void volta(), intervaloMs);
    timer.unref();
  };

  log.info({ intervaloMs, lote: LOTE }, 'agente do acervo fiel de olho');
  void volta();

  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
