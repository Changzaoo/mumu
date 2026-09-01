/**
 * QUEM CLASSIFICA O ACERVO INTEIRO — o lado servidor do sistema de conteúdo.
 *
 * O classificador (`packages/shared/ai/conteudoExplicito`) sabe julgar um
 * texto. Falta alguém buscar o texto de cinco mil faixas e gravar o veredito
 * onde todo aparelho enxergue. É este agente.
 *
 * Roda no servidor, e não no navegador, por um motivo simples: classificar no
 * cliente significaria cada aparelho baixar cinco mil letras e chegar às suas
 * próprias conclusões. Uma vez aqui, o veredito desce junto com a faixa na
 * sincronia que já existe, de graça, igual para todo mundo.
 *
 * ── SÓ CASAMENTO EXATO, E ISSO É A PARTE IMPORTANTE ──
 *
 * A busca de letra tem um modo difuso (`/api/search`) que devolve "a música
 * mais parecida". Ele é ótimo para karaokê e é PROIBIDO aqui.
 *
 * O motivo: classificar uma faixa usando a letra de OUTRA música é precisamente
 * o erro que este sistema existe para impedir. Uma letra de funk pegajoso
 * atribuída a um louvor marcaria o louvor como explícito; pior, o inverso
 * marcaria o funk como limpo e o liberaria para a fila de quem não quer isso.
 *
 * Então usamos `/api/get`, que exige artista, título e duração e responde 404
 * quando não tem certeza. Sem casamento exato, a faixa fica `desconhecido` — e
 * `desconhecido` é uma resposta legítima do sistema, não uma falha dele.
 */
import { classificarFaixa, type AnaliseDeConteudo } from '@aurial/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';

const LRCLIB = 'https://lrclib.net/api/get';

/** De quanto em quanto tempo o agente procura faixas sem veredito. */
const BATIDA_MS = 15 * 60_000;
/** Faixas por rodada. A LRCLIB é um serviço público e gratuito: sem rajada. */
const POR_RODADA = 120;
/** Respiro entre consultas, pelo mesmo motivo. */
const RESPIRO_MS = 700;

interface FaixaDoAcervo {
  id: string;
  data: CatalogEntry;
}

/**
 * O que fica gravado na faixa.
 *
 * Guarda os `achados` de propósito: quando alguém reclamar que uma música foi
 * marcada errado, a pergunta seguinte é "por qual palavra?". Sem isso, corrigir
 * o léxico vira adivinhação.
 */
export interface ConteudoDaFaixa extends AnaliseDeConteudo {
  /** Quando foi classificada, para poder reclassificar depois de mudar o léxico. */
  em: string;
  /** Versão do léxico usada — ver `VERSAO_DO_LEXICO`. */
  versao: number;
}

/**
 * Sobe quando o léxico muda de forma que valha reclassificar o acervo.
 *
 * Sem este número, corrigir um falso positivo consertaria só as faixas novas e
 * deixaria a música injustamente marcada marcada para sempre.
 */
export const VERSAO_DO_LEXICO = 1;

function textoDaLetra(corpo: {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}): string {
  if (corpo.plainLyrics && corpo.plainLyrics.trim()) return corpo.plainLyrics;
  // A versão sincronizada vem com marcação de tempo em cada linha; para
  // classificar, só o texto importa.
  return (corpo.syncedLyrics ?? '').replace(/\[\d+:\d+[.:]\d+\]/g, ' ');
}

/**
 * Busca a letra EXATA desta faixa. `null` quando não há certeza.
 *
 * Ver o cabeçalho: a ausência de letra é um resultado aceitável; a letra errada
 * não é.
 */
async function letraExata(track: {
  title?: string;
  artists?: Array<{ name?: string }>;
  durationMs?: number;
}): Promise<string | null> {
  const titulo = (track.title ?? '').trim();
  const artista = (track.artists?.[0]?.name ?? '').trim();
  if (!titulo || !artista || !track.durationMs) return null;

  const url = new URL(LRCLIB);
  url.searchParams.set('track_name', titulo);
  url.searchParams.set('artist_name', artista);
  url.searchParams.set('duration', String(Math.round(track.durationMs / 1000)));

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Aurial (classificacao de conteudo)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null; // 404 = a LRCLIB não tem certeza. Nós também não.
  const corpo = (await res.json()) as { plainLyrics?: string; syncedLyrics?: string };
  const texto = textoDaLetra(corpo).trim();
  return texto.length > 0 ? texto : null;
}

/**
 * Faixas ainda sem veredito, ou classificadas por um léxico velho.
 *
 * SQL cru porque o filtro é dentro do JSON. As mais recentes primeiro: é o que
 * alguém tem mais chance de ouvir hoje.
 */
async function semVeredicto(limite: number): Promise<FaixaDoAcervo[]> {
  const linhas = await prisma.$queryRaw<Array<{ id: string; data: unknown }>>`
    SELECT id, data FROM "CatalogTrack"
    WHERE COALESCE((data->'conteudo'->>'versao')::int, 0) < ${VERSAO_DO_LEXICO}
    ORDER BY "updatedAt" DESC
    LIMIT ${limite}
  `;
  return linhas.map((l) => ({ id: l.id, data: l.data as CatalogEntry }));
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Uma passada. Exportada para poder ser exercitada sem esperar a batida. */
export async function classificarUmaRodada(): Promise<{
  classificadas: number;
  explicitas: number;
  desconhecidas: number;
}> {
  const fila = await semVeredicto(POR_RODADA);
  let classificadas = 0;
  let explicitas = 0;
  let desconhecidas = 0;

  for (const faixa of fila) {
    const track = (faixa.data as { track?: Record<string, unknown> }).track ?? {};
    let letra: string | null = null;
    try {
      letra = await letraExata(track as Parameters<typeof letraExata>[0]);
    } catch {
      // Rede instável não é veredito: deixa para a próxima rodada em vez de
      // gravar `desconhecido` e nunca mais olhar.
      await esperar(RESPIRO_MS);
      continue;
    }

    const analise = classificarFaixa({ titulo: String(track.title ?? ''), letra });
    const conteudo: ConteudoDaFaixa = {
      ...analise,
      em: new Date().toISOString(),
      versao: VERSAO_DO_LEXICO,
    };

    await upsertCatalogTrack(faixa.id, {
      ...faixa.data,
      conteudo,
      // `explicit` continua sendo o campo que a interface lê. Só é `true`
      // quando temos CERTEZA — `desconhecido` não vira `true` nem `false` aqui,
      // e quem precisa de garantia consulta `conteudo.veredicto`.
      track: { ...track, explicit: analise.veredicto === 'explicito' },
    } as CatalogEntry);

    classificadas += 1;
    if (analise.veredicto === 'explicito') explicitas += 1;
    if (analise.veredicto === 'desconhecido') desconhecidas += 1;
    await esperar(RESPIRO_MS);
  }

  if (classificadas > 0) {
    logger.info(
      { classificadas, explicitas, desconhecidas, fila: fila.length },
      'conteúdo do acervo classificado',
    );
  }
  return { classificadas, explicitas, desconhecidas };
}

export function startConteudoDaFaixaWorker(): () => void {
  if (env.CLASSIFICAR_CONTEUDO === false) {
    logger.info({}, 'classificação de conteúdo desligada por configuração');
    return () => undefined;
  }
  let parado = false;
  let rodando = false;
  const timer = setInterval(() => {
    if (parado || rodando) return;
    rodando = true;
    void classificarUmaRodada()
      .catch((err) => logger.error({ err }, 'classificação de conteúdo falhou'))
      .finally(() => {
        rodando = false;
      });
  }, BATIDA_MS);
  timer.unref?.();

  return () => {
    parado = true;
    clearInterval(timer);
  };
}
