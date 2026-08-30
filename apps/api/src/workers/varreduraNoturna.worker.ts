/**
 * A VARREDURA DE MADRUGADA — o acervo se conserta sozinho enquanto ninguém ouve.
 *
 * O QUE ELA RESOLVE. Medido no acervo em 2026-08-30: de 5.054 faixas, 1.199 não
 * têm cópia nenhuma para tocar. Dessas, 1.123 guardam o `sourceUrl` — ou seja,
 * o caminho de volta existe e ninguém o percorria. O reparo do lado do app
 * (`lib/local/reparador.ts`) conserta o que a pessoa esbarra, o que é o certo
 * para quem está ouvindo agora, mas deixa o resto quebrado indefinidamente:
 * faixa que ninguém tenta tocar nunca é reparada, e como ela não toca, ninguém
 * tenta. Este worker quebra esse círculo.
 *
 * POR QUE DE MADRUGADA. Reimportar é a coisa mais cara que esta máquina faz —
 * um yt-dlp por faixa, baixando da internet, na MESMA máquina que serve o áudio
 * de quem está ouvindo. De dia, consertar faixa que ninguém pediu agora
 * competiria com a música que alguém pediu agora. A janela é configurável
 * (`VARREDURA_HORA_*`), em hora local do servidor.
 *
 * ── A TRAVA QUE IMPORTA MAIS QUE O RESTO: FOLGA NO COFRE ──
 *
 * O cofre é MENOR que o acervo — 18 GB de teto para cerca de 42 GB de música —
 * e podar é regime normal, não acidente. Isso tem uma consequência que parece
 * detalhe e não é: num cofre cheio, cada faixa que a varredura traz de volta
 * EXPULSA outra pelo LRU. Mil reparos numa noite produziriam mil faixas
 * quebradas novas, e a manhã seguinte seria idêntica à anterior, tendo gastado
 * uma noite de banda e de CPU para andar em círculos.
 *
 * Por isso a varredura confere a folga ANTES de trabalhar e desiste quando não
 * há, dizendo no log por quê. Um agente parado que explica o motivo é honesto;
 * um agente ocupado que não progride é pior que agente nenhum, porque parece
 * progresso. Enquanto o cofre não crescer, esperar é a resposta certa.
 *
 * ── O QUE ELA NUNCA FAZ ──
 *
 *  • Não toca em faixa que já tem cópia. O alvo é só quem não tem NADA.
 *  • Não apaga nem reescreve `sourceUrl`. Ele é o caminho de volta.
 *  • Não insiste em erro permanente. O importador distingue falha transitória
 *    (rede, YouTube pedindo verificação) de definitiva (vídeo removido); a
 *    segunda vira uma anotação e a faixa sai da fila, senão a varredura passaria
 *    todas as noites tentando baixar o mesmo vídeo que não existe mais.
 */
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';

/** De quanto em quanto tempo o worker acorda para ver se está na janela. */
const BATIDA_MS = 10 * 60_000;
/** Teto de espera por faixa: um yt-dlp travado não pode segurar a noite. */
const TIMEOUT_POR_FAIXA_MS = 5 * 60_000;
/** Intervalo entre consultas ao andamento de um download. */
const POLL_MS = 3_000;
/**
 * Descanso entre faixas. O importador roda yt-dlp contra o YouTube, que recua
 * quando vê rajada ("not a bot"). Uma pausa curta entre faixas custa alguns
 * minutos por noite e evita perder a noite inteira num bloqueio.
 */
const PAUSA_ENTRE_FAIXAS_MS = 5_000;

/**
 * De quantas em quantas faixas a varredura diz onde está.
 *
 * O resumo final só sai quando a fila inteira acaba — com teto de milhares de
 * faixas, isso são horas de silêncio total, indistinguíveis de um agente
 * travado. Este passo é o batimento cardíaco: barato, e a única forma de
 * acompanhar uma reconstrução longa enquanto ela acontece.
 */
const PASSO_DO_PROGRESSO = 25;

/**
 * Quantas faixas seguidas podem falhar antes de a varredura desistir da noite.
 *
 * Falha isolada é faixa morta; falha em sequência é o MUNDO fora do ar — fonte
 * bloqueando por excesso de pedidos, rede caída, importador doente. A diferença
 * importa porque a varredura carimba `reparoImpossivel`, e esse carimbo é para
 * sempre: insistir durante um bloqueio global converte centenas de faixas vivas
 * em faixas oficialmente mortas.
 *
 * Foi assim que se perdeu terreno em 2026-08-30: o YouTube limitou a sessão e
 * respondeu "Video unavailable" para tudo. Sem esta trava, uma hora ruim
 * queimaria a fila inteira.
 */
const FALHAS_SEGUIDAS_PARA_DESISTIR = 8;

interface Candidata {
  id: string;
  data: CatalogEntry;
}

interface EstadoDoCofre {
  pronto?: boolean;
  /** Espaço livre no DISCO onde o cofre mora. */
  livreBytes?: number;
  /** Teto que o cofre se impõe, independente do disco. */
  tetoBytes?: number;
  /** Quanto o cofre já ocupa desses bytes. */
  bytesEmBins?: number;
}

/**
 * A FOLGA QUE VALE É A MENOR DAS DUAS — e confundi-las é fácil.
 *
 * O cofre tem dois limites, e eles não andam juntos:
 *
 *   • o DISCO, que pode estar vazio;
 *   • o TETO que o cofre se impõe (`tetoBytes`), que é o que dispara a poda LRU.
 *
 * Medido no servidor em 2026-08-30: 3,93 GB livres no disco e apenas 92 MB de
 * folga sob o teto (19,23 de 19,33 GB ocupados). Olhar só o disco diria "pode
 * trabalhar à vontade" enquanto, na verdade, cada faixa trazida de volta
 * expulsaria outra na hora. A varredura andaria a noite inteira para deixar o
 * acervo exatamente como estava — e o log mostraria centenas de reparos.
 *
 * Por isso a folga real é o MENOR dos dois: quem estiver mais apertado é quem
 * manda. Quando um dos números não vem, ele não conta — mas se NENHUM vier, a
 * resposta é `null`, e `null` significa "não sei", que aqui vale como "não
 * trabalhe": apostar a noite num palpite é o oposto do que este guarda existe
 * para fazer.
 */
export function folgaReal(estado: EstadoDoCofre): number | null {
  const noDisco = typeof estado.livreBytes === 'number' ? estado.livreBytes : null;
  const sobOTeto =
    typeof estado.tetoBytes === 'number' && typeof estado.bytesEmBins === 'number'
      ? Math.max(0, estado.tetoBytes - estado.bytesEmBins)
      : null;
  const candidatos = [noDisco, sobOTeto].filter((v): v is number => v !== null);
  return candidatos.length === 0 ? null : Math.min(...candidatos);
}

function baseInterna(): string {
  return (env.IMPORTER_URL ?? '').replace(/\/$/, '');
}

function basePublica(): string {
  return (env.IMPORTER_PUBLIC_URL ?? env.IMPORTER_URL ?? '').replace(/\/$/, '');
}

function cabecalhos(): Record<string, string> {
  // O crachá vai no Authorization como qualquer token; o importador reconhece
  // o valor de serviço ANTES do portão do Firebase (ver `ehTokenDeServico`).
  return { Authorization: `Bearer ${env.IMPORT_SERVICE_TOKEN ?? ''}` };
}

/** `true` quando a hora local está dentro da janela — incluindo janelas que
 *  atravessam a meia-noite (22h → 5h), que é o caso natural de "madrugada". */
export function dentroDaJanela(hora: number, inicio: number, fim: number): boolean {
  if (inicio === fim) return true;
  return inicio < fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}

async function folgaDoCofre(): Promise<number | null> {
  try {
    const res = await fetch(`${baseInterna()}/cofre/estado`, { headers: cabecalhos() });
    if (!res.ok) return null;
    const estado = (await res.json()) as EstadoDoCofre;
    if (!estado.pronto) return null;
    return folgaReal(estado);
  } catch {
    return null;
  }
}

/**
 * As faixas sem NENHUMA cópia que ainda guardam o caminho de volta.
 *
 * SQL cru porque o filtro é dentro do JSON, e as três expressões abaixo foram
 * conferidas contra o acervo real antes de entrar aqui. As mais recentes
 * primeiro: uma faixa adicionada ontem tem muito mais chance de alguém querer
 * ouvir hoje do que uma de dois anos atrás.
 */
async function candidatas(limite: number): Promise<Candidata[]> {
  const linhas = await prisma.$queryRaw<Array<{ id: string; data: unknown }>>`
    SELECT id, data FROM "CatalogTrack"
    WHERE data->'track'->>'streamUrl' IS NULL
      AND data->>'remoteUrl' IS NULL
      AND data->>'sourceUrl' IS NOT NULL
      AND COALESCE(data->>'reparoImpossivel', '') = ''
    ORDER BY "updatedAt" DESC
    LIMIT ${limite}
  `;
  return linhas.map((l) => ({ id: l.id, data: l.data as CatalogEntry }));
}

async function esperar(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

interface ResultadoDoDownload {
  bytes: Buffer;
  tipo: string;
}

/** Baixa a faixa pelo importador. `null` = falhou; `permanent` = nunca mais. */
async function baixar(
  sourceUrl: string,
): Promise<{ ok: ResultadoDoDownload | null; permanente: boolean }> {
  const inicio = await fetch(`${baseInterna()}/import/start`, {
    method: 'POST',
    headers: { ...cabecalhos(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
  });
  if (!inicio.ok) {
    // 400 = link não suportado: não adianta tentar de novo amanhã.
    return { ok: null, permanente: inicio.status === 400 };
  }
  const { id } = (await inicio.json()) as { id?: string };
  if (!id) return { ok: null, permanente: false };

  const limite = Date.now() + TIMEOUT_POR_FAIXA_MS;
  while (Date.now() < limite) {
    await esperar(POLL_MS);
    const res = await fetch(`${baseInterna()}/import/job/${encodeURIComponent(id)}`, {
      headers: cabecalhos(),
    });
    if (!res.ok) return { ok: null, permanente: false };
    const job = (await res.json()) as { status?: string; permanent?: boolean };
    if (job.status === 'error') return { ok: null, permanente: Boolean(job.permanent) };
    if (job.status !== 'done') continue;

    const arquivo = await fetch(`${baseInterna()}/import/file/${encodeURIComponent(id)}`, {
      headers: cabecalhos(),
    });
    if (!arquivo.ok) return { ok: null, permanente: false };
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    if (bytes.length === 0) return { ok: null, permanente: false };
    return {
      ok: { bytes, tipo: arquivo.headers.get('content-type') ?? 'audio/mpeg' },
      permanente: false,
    };
  }
  return { ok: null, permanente: false }; // estourou o tempo: tenta outra noite
}

/** Guarda os bytes no cofre e devolve a URL pública da cópia. */
async function guardarNoCofre(
  blobId: string,
  arquivo: ResultadoDoDownload,
  sourceUrl: string,
): Promise<string | null> {
  const res = await fetch(`${baseInterna()}/blob`, {
    method: 'POST',
    headers: {
      ...cabecalhos(),
      'X-Blob-Id': blobId,
      'Content-Type': arquivo.tipo,
      // A ORIGEM VAI JUNTO. É ela que torna a poda reversível: quando o LRU
      // levar estes bytes, o cofre reextrai sob o MESMO token em vez de virar
      // 404 eterno — inclusive nos links já compartilhados.
      'X-Aurial-Source': sourceUrl,
    },
    body: new Uint8Array(arquivo.bytes),
  });
  if (!res.ok) return null;
  const dados = (await res.json()) as { token?: string };
  if (!dados.token) return null;
  return `${basePublica()}/blob/${encodeURIComponent(blobId)}?k=${encodeURIComponent(dados.token)}`;
}

/** Conserta UMA faixa. Devolve o que aconteceu, para o log e para a contagem. */
async function repararUma(c: Candidata): Promise<'reparada' | 'falhou' | 'impossivel'> {
  const sourceUrl = String((c.data as Record<string, unknown>).sourceUrl ?? '');
  if (!sourceUrl) return 'impossivel';

  const { ok, permanente } = await baixar(sourceUrl);
  if (!ok) return permanente ? 'impossivel' : 'falhou';

  const remoteUrl = await guardarNoCofre(c.id, ok, sourceUrl);
  if (!remoteUrl) return 'falhou';

  const track = { ...((c.data as { track?: Record<string, unknown> }).track ?? {}) };
  track.streamUrl = remoteUrl;
  await upsertCatalogTrack(c.id, { ...c.data, remoteUrl, track } as CatalogEntry);
  return 'reparada';
}

/**
 * Marca a faixa como sem conserto por reimportação.
 *
 * Não apaga nada: a entrada e o `sourceUrl` ficam, porque um vídeo pode voltar
 * e porque jogar fora o histórico não ajuda ninguém. A marca só tira a faixa da
 * fila desta varredura — sem ela, todas as noites seriam gastas tentando baixar
 * os mesmos vídeos que não existem mais.
 */
async function marcarImpossivel(c: Candidata): Promise<void> {
  await upsertCatalogTrack(c.id, {
    ...c.data,
    reparoImpossivel: new Date().toISOString(),
  } as CatalogEntry);
}

/** Uma passada completa. Exportada para poder ser testada sem esperar a noite. */
export async function varrerUmaVez(agora = new Date()): Promise<{
  rodou: boolean;
  motivo?: string;
  reparadas: number;
  falhas: number;
  impossiveis: number;
}> {
  const parado = (motivo: string) => ({
    rodou: false,
    motivo,
    reparadas: 0,
    falhas: 0,
    impossiveis: 0,
  });

  if (!baseInterna()) return parado('IMPORTER_URL não configurado');
  if (!env.IMPORT_SERVICE_TOKEN) return parado('IMPORT_SERVICE_TOKEN não configurado');
  if (!dentroDaJanela(agora.getHours(), env.VARREDURA_HORA_INICIO, env.VARREDURA_HORA_FIM)) {
    return parado('fora da janela');
  }

  const livre = await folgaDoCofre();
  if (livre === null) return parado('cofre não respondeu');
  if (livre < env.VARREDURA_FOLGA_MINIMA_BYTES) {
    // Ver "A TRAVA QUE IMPORTA MAIS QUE O RESTO" no topo: sem folga, reparar é
    // trocar uma faixa quebrada por outra.
    return parado(
      `cofre sem folga (${Math.round(livre / 1e6)} MB livres, ` +
        `mínimo ${Math.round(env.VARREDURA_FOLGA_MINIMA_BYTES / 1e6)} MB)`,
    );
  }

  const fila = await candidatas(env.VARREDURA_MAX_POR_NOITE);
  let reparadas = 0;
  let falhas = 0;
  let impossiveis = 0;
  let motivoDaParada: string | undefined;

  let seguidas = 0;

  for (const c of fila) {
    // A janela é conferida a CADA faixa: uma varredura que começou às 5h50 não
    // pode seguir baixando às 9h em cima de quem já está ouvindo.
    if (!dentroDaJanela(new Date().getHours(), env.VARREDURA_HORA_INICIO, env.VARREDURA_HORA_FIM)) {
      break;
    }
    let desfecho: 'reparada' | 'falhou' | 'impossivel';
    try {
      desfecho = await repararUma(c);
    } catch (err) {
      logger.warn({ trackId: c.id, err }, 'varredura: faixa falhou');
      desfecho = 'falhou';
    }
    if (desfecho === 'reparada') {
      reparadas++;
      seguidas = 0;
    } else {
      seguidas++;
      // A trava vem ANTES de carimbar: se já estamos numa sequência de falhas,
      // esta faixa provavelmente é vítima do mesmo apagão, e não uma faixa
      // morta. Melhor tentá-la amanhã do que enterrá-la hoje.
      if (seguidas >= FALHAS_SEGUIDAS_PARA_DESISTIR) {
        motivoDaParada = `${seguidas} falhas seguidas — parece apagão da fonte, não faixa morta`;
        break;
      }
      if (desfecho === 'falhou') falhas++;
      else {
        impossiveis++;
        await marcarImpossivel(c).catch(() => undefined);
      }
    }
    const feitas = reparadas + falhas + impossiveis;
    if (feitas % PASSO_DO_PROGRESSO === 0) {
      logger.info(
        { reparadas, falhas, impossiveis, feitas, fila: fila.length },
        'varredura em andamento',
      );
    }
    await esperar(PAUSA_ENTRE_FAIXAS_MS);
  }

  logger.info(
    { reparadas, falhas, impossiveis, fila: fila.length, parouPor: motivoDaParada },
    'varredura noturna concluída',
  );
  return { rodou: true, motivo: motivoDaParada, reparadas, falhas, impossiveis };
}

export function startVarreduraNoturnaWorker(): () => void {
  if (!baseInterna() || !env.IMPORT_SERVICE_TOKEN) {
    // Dizer que está DESLIGADA e por quê, em vez de simplesmente não aparecer no
    // log: um agente silencioso é indistinguível de um agente quebrado.
    logger.info(
      { importerUrl: Boolean(baseInterna()), token: Boolean(env.IMPORT_SERVICE_TOKEN) },
      'varredura noturna desligada (falta IMPORTER_URL e/ou IMPORT_SERVICE_TOKEN)',
    );
    return () => undefined;
  }

  let parado = false;
  let rodando = false;
  const timer = setInterval(() => {
    if (parado || rodando) return; // nunca duas varreduras ao mesmo tempo
    rodando = true;
    void varrerUmaVez()
      // Uma recusa silenciosa é o pior desfecho possível: o agente parece
      // trabalhar e não trabalha. Se ela declinou, o motivo vai para o log.
      .then((r) => {
        if (!r.rodou) logger.info({ motivo: r.motivo }, 'varredura declinou esta batida');
      })
      .catch((err) => logger.error({ err }, 'varredura noturna falhou'))
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
