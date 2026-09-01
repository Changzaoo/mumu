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
 * ── IDENTIFICAÇÃO, NUNCA SEMELHANÇA ──
 *
 * Classificar uma faixa com a letra de OUTRA música é precisamente o erro que
 * este sistema existe para impedir. Uma letra de funk atribuída a um louvor
 * marcaria o louvor como explícito; pior, o inverso marcaria o funk como limpo
 * e o liberaria para a fila de quem não quer isso.
 *
 * A primeira tentativa é `/api/get`, que exige artista, título e duração e
 * responde 404 quando não tem certeza. Só que ele exige casamento LITERAL, e na
 * primeira rodada real 93 de 120 faixas ficaram sem veredito por causa disso —
 * grafia de artista, sufixo no título, um segundo de diferença. Um sistema que
 * não sabe de 77% do acervo não protege ninguém.
 *
 * Então há uma segunda tentativa pela busca — e ela NÃO aceita "o mais
 * parecido". O resultado passa por `mesmaGravacao`: mesmo artista, mesmo título
 * (sem os sufixos de versão) e duração dentro de três segundos. As três juntas
 * identificam a gravação; qualquer uma faltando, a faixa continua
 * `desconhecido` — que é uma resposta legítima do sistema, não uma falha dele.
 */
import { classificarFaixa, type AnaliseDeConteudo } from '@radinho/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';

const LRCLIB_EXATO = 'https://lrclib.net/api/get';
const LRCLIB_BUSCA = 'https://lrclib.net/api/search';

/**
 * Quanto a duração pode divergir e ainda ser a MESMA gravação.
 *
 * Três segundos cobrem diferença de corte e de arredondamento entre fontes, e
 * são apertados o bastante para separar uma faixa de outra do mesmo artista com
 * o mesmo nome (ao vivo, remix) — que teria letra diferente.
 */
const TOLERANCIA_DE_DURACAO_S = 3;

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
 * Sobe quando o léxico OU a forma de achar a letra muda a ponto de valer
 * reclassificar o acervo.
 *
 * Sem este número, corrigir um falso positivo consertaria só as faixas novas e
 * deixaria a música injustamente marcada assim para sempre.
 *
 * 2: entrou a busca verificada.
 * 3: a duração deixou de ser obrigatória. As versões 1 e 2 desistiam ANTES de
 *    consultar qualquer coisa quando a faixa não tinha duração — e 1.677 das
 *    5.058 não têm. Era essa, e não o casamento, a causa dos 77% sem veredito.
 */
export const VERSAO_DO_LEXICO = 3;

function textoDaLetra(corpo: {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}): string {
  if (corpo.plainLyrics && corpo.plainLyrics.trim()) return corpo.plainLyrics;
  // A versão sincronizada vem com marcação de tempo em cada linha; para
  // classificar, só o texto importa.
  return (corpo.syncedLyrics ?? '').replace(/\[\d+:\d+[.:]\d+\]/g, ' ');
}

/** Compara nomes ignorando acento, caixa e pontuação. */
function chave(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Tira os sufixos de versão do título.
 *
 * "Nome (Ao Vivo)", "Nome - Remaster 2011", "Nome [Clipe Oficial]" são a mesma
 * canção e têm a mesma letra. Sem isto, cada uma dessas grafias vira uma faixa
 * que o sistema não consegue identificar — e não saber é o que trava o filtro.
 */
function tituloBase(titulo: string): string {
  return chave(titulo.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s-\s.*$/, ' '));
}

/**
 * O QUANTO TEMOS CERTEZA DE QUE A LETRA É DESTA FAIXA.
 *
 * `certa`: artista, título e duração conferem — é a gravação.
 * `fraca`: só artista e título, porque NÓS não sabemos a duração (1.677 faixas
 *          do acervo estão sem ela). Quase sempre é a mesma canção, mas pode
 *          ser um remix com verso convidado.
 *
 * A assimetria que isso obriga está em `veredictoDe`: identificação fraca pode
 * CONDENAR, nunca ABSOLVER.
 */
export type Confianca = 'certa' | 'fraca';

export interface IdentidadeDaFaixa {
  titulo: string;
  artista: string;
  duracaoS: number;
}

/**
 * É A MESMA GRAVAÇÃO? — a porta que separa identificação de palpite.
 *
 * Exige as três: artista, título-base e duração. Duas não bastam — o mesmo
 * artista com o mesmo nome de música existe (estúdio e ao vivo), e essas
 * versões podem ter letra diferente. Pura para poder ser testada, porque é aqui
 * que um erro vira "letra de funk atribuída a um louvor".
 */
/** Mesmo artista e mesmo título-base, sem olhar duração. Ver `Confianca`. */
export function mesmoNomeEArtista(alvo: IdentidadeDaFaixa, candidata: IdentidadeDaFaixa): boolean {
  if (chave(alvo.artista) !== chave(candidata.artista)) return false;
  return tituloBase(alvo.titulo) === tituloBase(candidata.titulo);
}

/**
 * O VEREDITO, DADA A CONFIANÇA NA IDENTIFICAÇÃO.
 *
 * A regra: identificação fraca pode CONDENAR, nunca ABSOLVER.
 *
 * É a mesma assimetria do título no classificador, e pelo mesmo motivo. Se a
 * letra que achamos tem palavrão, a faixa é suspeita o bastante para ficar fora
 * de uma fila sensível — errar aqui custa uma música a menos. Se a letra está
 * limpa mas pode não ser desta gravação, chamar a faixa de `limpo` a libera
 * para o rádio de louvor com base num palpite — e errar ali custa a pessoa.
 */
export function veredictoDe(analise: AnaliseDeConteudo, confianca: Confianca): AnaliseDeConteudo {
  if (confianca === 'certa') return analise;
  if (analise.veredicto === 'explicito') return analise;
  return { veredicto: 'desconhecido', categorias: [], achados: [] };
}

export function mesmaGravacao(alvo: IdentidadeDaFaixa, candidata: IdentidadeDaFaixa): boolean {
  if (chave(alvo.artista) !== chave(candidata.artista)) return false;
  if (tituloBase(alvo.titulo) !== tituloBase(candidata.titulo)) return false;
  return Math.abs(alvo.duracaoS - candidata.duracaoS) <= TOLERANCIA_DE_DURACAO_S;
}

interface LinhaDaLrclib {
  trackName?: string;
  artistName?: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/**
 * Busca a letra desta faixa. `null` quando não há CERTEZA de que é ela.
 *
 * Ver o cabeçalho: a ausência de letra é um resultado aceitável; a letra errada
 * não é.
 */
async function letraDaFaixa(track: {
  title?: string;
  artists?: Array<{ name?: string }>;
  durationMs?: number;
}): Promise<{ texto: string; confianca: Confianca } | null> {
  const titulo = (track.title ?? '').trim();
  const artista = (track.artists?.[0]?.name ?? '').trim();
  if (!titulo || !artista) return null;
  // 1.677 das 5.058 faixas do acervo estão sem duração, e a exigência dela
  // fazia o agente devolver `null` ANTES de qualquer consulta — foi o que
  // manteve 77% do acervo sem veredito mesmo depois de a busca ficar boa.
  const duracaoS = track.durationMs ? Math.round(track.durationMs / 1000) : null;
  const alvo: IdentidadeDaFaixa = { titulo, artista, duracaoS: duracaoS ?? 0 };

  const cabecalhos = { 'User-Agent': 'radinho.online (classificacao de conteudo)' };

  // 1) Casamento literal. Quando responde, é ele mesmo — sem verificação.
  if (duracaoS !== null) {
    const exata = new URL(LRCLIB_EXATO);
    exata.searchParams.set('track_name', titulo);
    exata.searchParams.set('artist_name', artista);
    exata.searchParams.set('duration', String(duracaoS));
    const res = await fetch(exata, { headers: cabecalhos, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const texto = textoDaLetra((await res.json()) as LinhaDaLrclib).trim();
      if (texto) return { texto, confianca: 'certa' };
    }
  }

  // 2) Busca — e aqui NADA é aceito sem passar por `mesmaGravacao`.
  const busca = new URL(LRCLIB_BUSCA);
  busca.searchParams.set('track_name', titulo);
  busca.searchParams.set('artist_name', artista);
  const resBusca = await fetch(busca, { headers: cabecalhos, signal: AbortSignal.timeout(15_000) });
  if (!resBusca.ok) return null;
  const linhas = (await resBusca.json()) as LinhaDaLrclib[];
  if (!Array.isArray(linhas)) return null;

  for (const linha of linhas) {
    const identidade: IdentidadeDaFaixa = {
      titulo: linha.trackName ?? '',
      artista: linha.artistName ?? '',
      duracaoS: Math.round(linha.duration ?? -1),
    };
    // Sem duração nossa, `mesmaGravacao` não pode conferir a terceira exigência.
    // Artista e título iguais são identificação FRACA: quase sempre é a mesma
    // canção, mas pode ser um remix com verso convidado — e essa diferença é
    // justamente palavrão a mais.
    const confere =
      duracaoS !== null ? mesmaGravacao(alvo, identidade) : mesmoNomeEArtista(alvo, identidade);
    if (!confere) continue;
    const texto = textoDaLetra(linha).trim();
    if (texto) return { texto, confianca: duracaoS !== null ? 'certa' : 'fraca' };
  }
  return null;
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
    let letra: { texto: string; confianca: Confianca } | null = null;
    try {
      letra = await letraDaFaixa(track as Parameters<typeof letraDaFaixa>[0]);
    } catch {
      // Rede instável não é veredito: deixa para a próxima rodada em vez de
      // gravar `desconhecido` e nunca mais olhar.
      await esperar(RESPIRO_MS);
      continue;
    }

    const analise = veredictoDe(
      classificarFaixa({ titulo: String(track.title ?? ''), letra: letra?.texto ?? null }),
      letra?.confianca ?? 'certa',
    );
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
