/**
 * O MUNDO DA MÚSICA — agenda, prêmios, lançamentos e transmissões, 24/7.
 *
 * Em 27/10/2026 o app deixou de ser só um tocador: quem quer passar de hobby
 * a conhecer música precisa saber quem está em turnê, quem ganhou o Grammy,
 * o que acabou de sair. Este agente mantém isso em cache no Postgres, por
 * artista do acervo, lido de fontes públicas (ver `mundo.fontes.ts`). A
 * página do artista e a Home leem daqui; nenhuma delas chama fonte nenhuma.
 *
 * O QUE ELE FAZ, a cada batida:
 *   1. FICHAS — garante uma `FichaDoArtista` para cada artista do acervo
 *      (nomes das faixas em `CatalogTrack`) e para cada artista seguido
 *      (`UserCollectionItem`, coleção `artistas`), pela MESMA chave de
 *      identidade que o app usa. Prioridade = quem segue × 1000 + faixas;
 *   2. ESCOLHE — as fichas nunca lidas ou vencidas, da maior prioridade para
 *      a menor (quem alguém segue é atualizado todo dia; o resto, por semana);
 *   3. LÊ — MusicBrainz (âncora), Wikidata, Bandsintown/Ticketmaster (com
 *      chave), YouTube; funde shows repetidos; confere o embed;
 *   4. GRAVA — substitui os eventos daquela fonte para aquele artista (show
 *      cancelado some), carimba a ficha com data, erro e chamadas gastas.
 *
 * FREIOS: teto diário de chamadas externas (`MUNDO_MAX_CHAMADAS_DIA`, contado
 * em `WorkerState` para sobreviver a reinício), poucos artistas por batida,
 * fila serial de 1 req/s na MusicBrainz. Fonte que falha não derruba a
 * batida: a ficha registra o erro e volta à fila na próxima vencida.
 */
import { chaveDeIdentidadeDoArtista, ehSelo } from '@radinho/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import {
  FonteIndisponivel,
  Orcamento,
  buscarArtistaMB,
  canalDoYoutube,
  canalPorHandle,
  eventosMB,
  fundirShows,
  idDoWikidata,
  lancamentosMB,
  lerLinksMB,
  premiosWikidata,
  showsBandsintown,
  showsTicketmaster,
  transmissoesYoutube,
  type EventoLido,
  type LinksDoArtista,
} from './mundo.fontes.js';

const log = logger.child({ worker: 'mundo' });

const CHAVE_DO_ORCAMENTO = 'mundo.orcamento';
const CHAVE_DAS_FICHAS = 'mundo.fichasEm';
/** As fichas são reconciliadas com o acervo de hora em hora, não por batida. */
const RECONCILIAR_FICHAS_MS = 60 * 60_000;
/** Artista que ninguém segue é relido com esta folga a mais. */
const FOLGA_SEM_SEGUIDOR = 7;
/** Eventos passados além disto não interessam à agenda (prêmios ficam). */
export const JANELA_PASSADA_DIAS = 60;

interface NomeNoAcervo {
  nome: string;
  faixas: number;
}

/**
 * NOME → FICHA. Puro: escolhe a grafia mais frequente por chave e descarta o
 * que não é artista (selo, "Desconhecido", vazio, nome absurdo).
 */
export function fichasDosNomes(
  nomes: NomeNoAcervo[],
  seguidores: ReadonlyMap<string, number>,
): Array<{ chave: string; nome: string; prioridade: number }> {
  const porChave = new Map<string, { nome: string; faixas: number; total: number }>();
  for (const { nome, faixas } of nomes) {
    const limpo = nome.trim();
    if (!limpo || limpo.length > 120 || limpo === 'Desconhecido' || ehSelo(limpo)) continue;
    const chave = chaveDeIdentidadeDoArtista(limpo);
    if (chave.length < 2) continue;
    const atual = porChave.get(chave);
    if (!atual) porChave.set(chave, { nome: limpo, faixas, total: faixas });
    else {
      atual.total += faixas;
      if (faixas > atual.faixas) {
        atual.nome = limpo;
        atual.faixas = faixas;
      }
    }
  }
  // Quem é seguido e não está no acervo também ganha ficha: a pessoa quer
  // saber do artista mesmo sem ter faixa dele ainda.
  for (const chave of seguidores.keys()) {
    if (!porChave.has(chave)) porChave.set(chave, { nome: chave, faixas: 0, total: 0 });
  }
  return [...porChave.entries()].map(([chave, f]) => ({
    chave,
    nome: f.nome,
    prioridade: (seguidores.get(chave) ?? 0) * 1000 + f.total,
  }));
}

/** Nomes de artista do acervo (todas as posições de `artists[]`), com contagem. */
async function nomesDoAcervo(): Promise<NomeNoAcervo[]> {
  const linhas = await prisma.$queryRaw<Array<{ nome: string | null; faixas: bigint | number }>>`
    SELECT a->>'name' AS nome, count(*) AS faixas
    FROM "CatalogTrack" t, jsonb_array_elements(t.data->'track'->'artists') AS a
    GROUP BY a->>'name'
  `;
  return linhas
    .filter((l): l is { nome: string; faixas: bigint | number } => typeof l.nome === 'string')
    .map((l) => ({ nome: l.nome, faixas: Number(l.faixas) }));
}

/** Chave do artista → quantas pessoas o seguem; e a grafia que elas veem. */
async function seguidoresPorChave(): Promise<{
  contagem: Map<string, number>;
  nomes: Map<string, string>;
}> {
  const linhas = await prisma.$queryRaw<
    Array<{ itemId: string; nome: string | null; n: bigint | number }>
  >`
    SELECT "itemId", max(data->>'nome') AS nome, count(*) AS n
    FROM "UserCollectionItem"
    WHERE collection = 'artistas' AND deleted = false
    GROUP BY "itemId"
  `;
  const contagem = new Map<string, number>();
  const nomes = new Map<string, string>();
  for (const l of linhas) {
    contagem.set(l.itemId, Number(l.n));
    if (l.nome) nomes.set(l.itemId, l.nome);
  }
  return { contagem, nomes };
}

/**
 * Reconcilia as fichas com o acervo e com quem segue. Cria as que faltam e
 * atualiza prioridade e grafia das que existem. Sem rede.
 */
export async function reconciliarFichas(): Promise<{ criadas: number; total: number }> {
  const [nomes, seguidores] = await Promise.all([nomesDoAcervo(), seguidoresPorChave()]);
  const fichas = fichasDosNomes(nomes, seguidores.contagem).map((f) => ({
    ...f,
    // Um seguido sem faixa no acervo ganha a grafia que a pessoa viu ao seguir.
    nome: f.nome === f.chave ? (seguidores.nomes.get(f.chave) ?? f.nome) : f.nome,
  }));
  const existentes = new Map(
    (
      await prisma.fichaDoArtista.findMany({
        select: { chave: true, prioridade: true, nome: true },
      })
    ).map((f) => [f.chave, f]),
  );
  const novas = fichas.filter((f) => !existentes.has(f.chave));
  if (novas.length > 0) {
    await prisma.fichaDoArtista.createMany({ data: novas, skipDuplicates: true });
  }
  for (const f of fichas) {
    const atual = existentes.get(f.chave);
    if (atual && (atual.prioridade !== f.prioridade || atual.nome !== f.nome)) {
      await prisma.fichaDoArtista.update({
        where: { chave: f.chave },
        data: { prioridade: f.prioridade, nome: f.nome },
      });
    }
  }
  return { criadas: novas.length, total: fichas.length };
}

async function fichasVencidas(agora: Date, quantas: number) {
  const horas = env.MUNDO_REFRESH_HORAS;
  const limiteSeguido = new Date(agora.getTime() - horas * 3600_000);
  const limiteSolto = new Date(agora.getTime() - horas * FOLGA_SEM_SEGUIDOR * 3600_000);
  return prisma.fichaDoArtista.findMany({
    where: {
      OR: [
        { agendaEm: null },
        { prioridade: { gte: 1000 }, agendaEm: { lt: limiteSeguido } },
        { prioridade: { lt: 1000 }, agendaEm: { lt: limiteSolto } },
      ],
    },
    orderBy: [{ prioridade: 'desc' }, { agendaEm: 'asc' }],
    take: quantas,
  });
}

export interface LeituraDoArtista {
  mbid: string | null;
  wikidataId: string | null;
  youtubeCanal: string | null;
  links: LinksDoArtista;
  eventos: EventoLido[];
  /** Fontes consultadas nesta leitura: só delas os eventos são substituídos. */
  fontes: string[];
  erros: string[];
  /** A âncora (MusicBrainz) estava fora do ar: a leitura não vale como feita. */
  indisponivel: boolean;
}

/** Com a fonte fora do ar, a ficha volta à fila depois disto (não em dias). */
const RETENTATIVA_MS = 60 * 60_000;

/**
 * Lê todas as fontes para um artista. Nunca lança: cada fonte que falha vira
 * uma linha em `erros`, e o resto segue.
 */
export async function lerArtista(
  nome: string,
  orc: Orcamento,
  conhecido: { mbid?: string | null; youtubeCanal?: string | null } = {},
): Promise<LeituraDoArtista> {
  const leitura: LeituraDoArtista = {
    mbid: conhecido.mbid ?? null,
    wikidataId: null,
    youtubeCanal: conhecido.youtubeCanal ?? null,
    links: {},
    eventos: [],
    fontes: [],
    erros: [],
    indisponivel: false,
  };
  const tentar = async (fonte: string, fn: () => Promise<EventoLido[] | null>): Promise<void> => {
    try {
      const lidos = await fn();
      if (lidos === null) return; // fonte muda (sem chave) ou sem orçamento
      leitura.fontes.push(fonte);
      leitura.eventos.push(...lidos);
    } catch (err) {
      leitura.erros.push(`${fonte}: ${String(err).slice(0, 120)}`);
      // A âncora no limite de taxa no meio da leitura: a ficha volta em uma
      // hora, não em dias (ver `gravarLeitura`).
      if (err instanceof FonteIndisponivel) leitura.indisponivel = true;
    }
  };

  // 1) MusicBrainz — a âncora. Fora do ar não é "não existe": a leitura é
  // marcada indisponível e a ficha volta à fila em uma hora.
  if (!leitura.mbid) {
    try {
      const artista = await buscarArtistaMB(nome, orc);
      leitura.mbid = artista?.id ?? null;
    } catch (err) {
      leitura.erros.push(String(err).slice(0, 120));
      leitura.indisponivel = err instanceof FonteIndisponivel;
      return leitura;
    }
  }
  if (leitura.mbid) {
    const rels = await lerLinksMB(leitura.mbid, orc).catch(() => null);
    if (rels) {
      leitura.links = rels.links;
      leitura.wikidataId = idDoWikidata(rels.links.wikidata);
      const canal = canalDoYoutube(rels.links.youtube);
      if (canal) leitura.youtubeCanal = canal;
      else if (rels.links.youtube && !leitura.youtubeCanal) {
        leitura.youtubeCanal = await canalPorHandle(rels.links.youtube, orc).catch(() => null);
      }
    }
    await tentar('musicbrainz', async () => [
      ...(await lancamentosMB(leitura.mbid as string, orc)),
      ...(await eventosMB(leitura.mbid as string, orc)),
    ]);
    // 2) Wikidata — só pelo id que o MusicBrainz apontou.
    if (leitura.wikidataId) {
      await tentar('wikidata', () => premiosWikidata(leitura.wikidataId as string, orc));
    }
  } else {
    leitura.erros.push('musicbrainz: artista não identificado com certeza');
  }

  // 3) Shows com ingresso (fontes com chave; mudas sem ela).
  const shows: EventoLido[] = [];
  await tentar('bandsintown', async () => {
    const lidos = await showsBandsintown(nome, orc);
    if (lidos) shows.push(...lidos);
    return lidos === null ? null : [];
  });
  await tentar('ticketmaster', async () => {
    const lidos = await showsTicketmaster(nome, orc);
    if (lidos) shows.push(...lidos);
    return lidos === null ? null : [];
  });
  leitura.eventos.push(...fundirShows(shows));

  // 4) YouTube — canal oficial, transmissões, embed conferido.
  if (leitura.youtubeCanal) {
    await tentar('youtube', () => transmissoesYoutube(leitura.youtubeCanal as string, orc));
  }
  return leitura;
}

/** Grava a leitura: substitui os eventos das fontes lidas e carimba a ficha. */
async function gravarLeitura(
  chave: string,
  prioridade: number,
  leitura: LeituraDoArtista,
  gastas: number,
  agora: Date,
): Promise<void> {
  const corte = new Date(agora.getTime() - JANELA_PASSADA_DIAS * 86_400_000);
  const eventos = leitura.eventos.filter(
    (e) => e.tipo === 'PREMIO' || e.tipo === 'LANCAMENTO' || !e.quando || e.quando >= corte,
  );
  const vistos = new Set<string>();
  const linhas = eventos
    .filter((e) => (vistos.has(e.id) ? false : (vistos.add(e.id), true)))
    .map((e) => ({
      id: e.id,
      chave,
      tipo: e.tipo,
      titulo: e.titulo.slice(0, 300),
      descricao: e.descricao ?? null,
      quando: e.quando ?? null,
      local: e.local ?? null,
      cidade: e.cidade ?? null,
      pais: e.pais ?? null,
      preco: e.preco ?? null,
      linkIngresso: e.linkIngresso ?? null,
      link: e.link ?? null,
      youtubeId: e.youtubeId ?? null,
      embed: e.embed ?? false,
      fonte: e.fonte,
      dados: (e.dados ?? undefined) as object | undefined,
    }));
  await prisma.$transaction(async (tx) => {
    if (leitura.fontes.length > 0) {
      await tx.eventoDoArtista.deleteMany({ where: { chave, fonte: { in: leitura.fontes } } });
    }
    if (linhas.length > 0)
      await tx.eventoDoArtista.createMany({ data: linhas, skipDuplicates: true });
    // Fonte fora do ar: carimba uma data que vence em RETENTATIVA_MS, e não
    // "agora" — senão o artista ficaria dias sem agenda por um 503 passageiro.
    const vencimentoMs =
      env.MUNDO_REFRESH_HORAS * 3600_000 * (prioridade >= 1000 ? 1 : FOLGA_SEM_SEGUIDOR);
    const agendaEm = leitura.indisponivel
      ? new Date(agora.getTime() - vencimentoMs + RETENTATIVA_MS)
      : agora;
    await tx.fichaDoArtista.update({
      where: { chave },
      data: {
        mbid: leitura.mbid ?? undefined,
        wikidataId: leitura.wikidataId ?? undefined,
        youtubeCanal: leitura.youtubeCanal ?? undefined,
        links: Object.keys(leitura.links).length > 0 ? (leitura.links as object) : undefined,
        agendaEm,
        agendaErro: leitura.erros.length > 0 ? leitura.erros.join(' | ').slice(0, 500) : null,
        chamadas: { increment: gastas },
      },
    });
  });
}

/** O orçamento do dia, lembrado no banco para sobreviver a reinício. */
async function orcamentoDoDia(agora: Date): Promise<Orcamento> {
  const dia = agora.toISOString().slice(0, 10);
  const linha = await prisma.workerState
    .findUnique({ where: { key: CHAVE_DO_ORCAMENTO } })
    .catch(() => null);
  const v = (linha?.value ?? {}) as { dia?: string; gastas?: number };
  const orc = new Orcamento(env.MUNDO_MAX_CHAMADAS_DIA);
  if (v.dia === dia && typeof v.gastas === 'number') orc.gastas = v.gastas;
  return orc;
}

async function guardarOrcamento(orc: Orcamento, agora: Date): Promise<void> {
  const value = { dia: agora.toISOString().slice(0, 10), gastas: orc.gastas, teto: orc.teto };
  await prisma.workerState
    .upsert({
      where: { key: CHAVE_DO_ORCAMENTO },
      create: { key: CHAVE_DO_ORCAMENTO, value },
      update: { value },
    })
    .catch(() => undefined);
}

async function precisaReconciliar(agora: Date): Promise<boolean> {
  const linha = await prisma.workerState
    .findUnique({ where: { key: CHAVE_DAS_FICHAS } })
    .catch(() => null);
  const em = (linha?.value as { em?: string } | null)?.em;
  return !em || agora.getTime() - new Date(em).getTime() > RECONCILIAR_FICHAS_MS;
}

/** Uma batida. Exportada para rodar sem esperar o relógio. */
export async function mundoUmaVez(agora = new Date()): Promise<{
  rodou: boolean;
  motivo?: string;
  artistas: number;
  eventos: number;
  chamadas: number;
}> {
  if (await precisaReconciliar(agora)) {
    const r = await reconciliarFichas();
    const value = { em: agora.toISOString(), ...r };
    await prisma.workerState
      .upsert({
        where: { key: CHAVE_DAS_FICHAS },
        create: { key: CHAVE_DAS_FICHAS, value },
        update: { value },
      })
      .catch(() => undefined);
    if (r.criadas > 0) log.info(r, 'fichas de artista reconciliadas com o acervo');
  }

  const orc = await orcamentoDoDia(agora);
  if (orc.esgotado)
    return {
      rodou: false,
      motivo: 'teto de chamadas do dia alcançado',
      artistas: 0,
      eventos: 0,
      chamadas: 0,
    };

  const fila = await fichasVencidas(agora, env.MUNDO_ARTISTAS_POR_BATIDA);
  if (fila.length === 0)
    return { rodou: false, motivo: 'nenhuma ficha vencida', artistas: 0, eventos: 0, chamadas: 0 };

  let artistas = 0;
  let eventos = 0;
  const antes = orc.gastas;
  for (const ficha of fila) {
    if (orc.esgotado) break;
    const gastasAntes = orc.gastas;
    const leitura = await lerArtista(ficha.nome, orc, {
      mbid: ficha.mbid,
      youtubeCanal: ficha.youtubeCanal,
    });
    const gastas = orc.gastas - gastasAntes;
    try {
      await gravarLeitura(ficha.chave, ficha.prioridade, leitura, gastas, agora);
      artistas += 1;
      eventos += leitura.eventos.length;
      log.info(
        {
          artista: ficha.nome,
          mbid: leitura.mbid,
          eventos: leitura.eventos.length,
          fontes: leitura.fontes,
          chamadas: gastas,
          erros: leitura.erros,
        },
        'agenda do artista atualizada',
      );
    } catch (err) {
      log.warn({ artista: ficha.nome, err: String(err) }, 'não deu para gravar a agenda');
    }
    await guardarOrcamento(orc, agora);
  }
  return { rodou: true, artistas, eventos, chamadas: orc.gastas - antes };
}

export function startMundoWorker(): () => void {
  if (!env.MUNDO_ENABLED) {
    log.info({}, 'mundo da música desligado por configuração');
    return () => undefined;
  }
  let parado = false;
  let rodando = false;
  const bater = (): void => {
    if (parado || rodando) return;
    rodando = true;
    void mundoUmaVez()
      .then((r) => {
        if (!r.rodou) log.info({ motivo: r.motivo }, 'mundo declinou esta batida');
        else
          log.info(
            { artistas: r.artistas, eventos: r.eventos, chamadas: r.chamadas },
            'mundo terminou a batida',
          );
      })
      .catch((err) => log.error({ err }, 'mundo falhou'))
      .finally(() => {
        rodando = false;
      });
  };
  const primeira = setTimeout(bater, 90_000);
  const timer = setInterval(bater, env.MUNDO_BATIDA_MIN * 60_000);
  primeira.unref?.();
  timer.unref?.();
  log.info(
    {
      batidaMin: env.MUNDO_BATIDA_MIN,
      porBatida: env.MUNDO_ARTISTAS_POR_BATIDA,
      tetoDia: env.MUNDO_MAX_CHAMADAS_DIA,
      bandsintown: Boolean(env.BANDSINTOWN_APP_ID),
      ticketmaster: Boolean(env.TICKETMASTER_API_KEY),
      youtubeApi: Boolean(env.YOUTUBE_API_KEY),
    },
    'mundo da música 24/7 iniciado',
  );
  return () => {
    parado = true;
    clearTimeout(primeira);
    clearInterval(timer);
  };
}
