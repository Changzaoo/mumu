/**
 * O CONTEÚDO DA FAIXA, BUSCADO NO CLIQUE — e assimilado antes dele, quando dá.
 *
 * A listagem do acervo passou a entregar só o que a TELA desenha: título,
 * capa, artista, álbum, duração e um bit dizendo se a faixa toca. O endereço de
 * onde sai o som, o link de origem e o hash saíram de lá porque eles servem a
 * UMA faixa de cada vez e desciam multiplicados por 5.054 — cerca de 1,5 MB de
 * texto e mais 25 mil propriedades no heap de um celular, para que se usassem,
 * no máximo, algumas dezenas por sessão. Quem ouvia vinte músicas carregava
 * cinco mil endereços.
 *
 * Este módulo é a outra ponta disso: `GET /catalogo/:id`, uma faixa por vez.
 *
 * ── A HIDRATAÇÃO NO LUGAR, QUE É O QUE MANTÉM O RESTO DO APP INTACTO ──
 *
 * O detalhe não vira um objeto paralelo que todo mundo precisaria aprender a
 * consultar. Ele é escrito DE VOLTA na própria entrada da biblioteca
 * (`hidratarEntrada`), então `ensurePlayableSource`, o guardião do offline, o
 * reparador e o diagnóstico continuam lendo `entry.remoteUrl` como sempre
 * leram. A diferença é só QUANDO o campo existe.
 *
 * ── O SCRIPT QUE VAI ASSIMILANDO ──
 *
 * Buscar só no clique deixaria uma espera de rede entre apertar play e sair
 * som — pequena, mas exatamente no pior lugar. Por isso existe o assimilador:
 * um plantão que hidrata em segundo plano o que está PRESTES a tocar (a fila) e
 * o que a pessoa provavelmente vai abrir, uma por vez, com respiro.
 *
 * Ele nunca corre atrás do acervo inteiro. Isso desfaria o ganho: voltaríamos a
 * ter cinco mil entradas gordas na memória, só que devagar. O teto é o que
 * garante que "sob demanda" continue sendo sob demanda.
 */
import { API_BASE_URL } from '@/lib/apiBase';
import { modoLeve } from '@/lib/perf/dispositivo';
import { hidratarEntrada, list, type LibraryEntry } from '@/lib/local/localLibrary';

/**
 * Quantas faixas o assimilador mantém hidratadas à frente.
 *
 * 30 cobre com folga a próxima meia hora de escuta e custa ~9 kB de campos —
 * três ordens de grandeza abaixo do que a listagem gorda custava. Subir muito
 * este número é reintroduzir o problema em câmera lenta.
 */
const ADIANTE = 30;
/**
 * O mesmo adiantamento num aparelho que já provou que trava.
 *
 * Assimilar é ENFEITE: adianta a busca do conteúdo para o play não esperar a
 * rede. Num celular de entrada esse enfeite compete com a rolagem pela mesma
 * thread, e o que a pessoa sente não é "o play demorou menos" — é a lista
 * engasgando. Oito faixas ainda cobrem a próxima meia dúzia de músicas, que é
 * onde o adiantamento realmente paga.
 */
const ADIANTE_LEVE = 8;
/** Respiro entre buscas: assimilar é enfeite, ouvir é o serviço. */
const RESPIRO_MS = 400;
/** Em modo leve o respiro é o triplo — o enfeite cede a vez ao dedo. */
const RESPIRO_LEVE_MS = 1_200;
/** De quanto em quanto tempo o plantão reavalia a fila. */
const BATIDA_MS = 20_000;
/** Batida no modo leve: três vezes mais espaçada. */
const BATIDA_LEVE_MS = 60_000;

/**
 * As três medidas do plantão, decididas A CADA RODADA.
 *
 * Lidas na hora, e não no carregamento do módulo, porque o rebaixamento pode
 * chegar DEPOIS: o monitor de quadros (ver `lib/perf/dispositivo`) rebaixa no
 * meio da sessão quando vê o travamento acontecer de verdade — e essa é a
 * evidência mais confiável que existe, melhor que a heurística de núcleos. Um
 * valor congelado no import ignoraria justamente ela.
 */
function ritmo(): { adiante: number; respiroMs: number; batidaMs: number } {
  return modoLeve()
    ? { adiante: ADIANTE_LEVE, respiroMs: RESPIRO_LEVE_MS, batidaMs: BATIDA_LEVE_MS }
    : { adiante: ADIANTE, respiroMs: RESPIRO_MS, batidaMs: BATIDA_MS };
}

/** Ids já hidratados nesta sessão — não se pede duas vezes a mesma coisa. */
const prontos = new Set<string>();
/** Buscas em voo, por id: dois cliques rápidos na mesma faixa são UMA busca. */
const emVoo = new Map<string, Promise<boolean>>();

/** A entrada já tem o que é preciso para tocar? */
function jaTemConteudo(e: LibraryEntry | undefined): boolean {
  if (!e) return false;
  return Boolean(e.remoteUrl ?? e.track.streamUrl ?? e.sourceUrl);
}

function entradaDe(id: string): LibraryEntry | undefined {
  return list().find((e) => e.track.id === id);
}

async function buscar(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/catalogo/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const corpo = (await res.json()) as { data?: Partial<LibraryEntry> } | Partial<LibraryEntry>;
  // A API responde `{ data: ... }`; aceitar as duas formas evita que uma
  // mudança de envelope quebre a reprodução em silêncio.
  const detalhe =
    (corpo as { data?: Partial<LibraryEntry> }).data ?? (corpo as Partial<LibraryEntry>);
  if (!detalhe || typeof detalhe !== 'object') return false;
  hidratarEntrada(id, detalhe);
  prontos.add(id);
  return true;
}

/**
 * Garante que esta faixa tenha o conteúdo. Devolve `true` quando dá para tocar.
 *
 * Chamada no caminho do play, então ela é curta de propósito: se a entrada já
 * tem fonte, volta na hora, sem tocar na rede.
 */
export async function garantirDetalhe(id: string): Promise<boolean> {
  if (jaTemConteudo(entradaDe(id))) return true;
  const voando = emVoo.get(id);
  if (voando) return voando;
  const p = buscar(id)
    .catch(() => false)
    .finally(() => {
      emVoo.delete(id);
    });
  emVoo.set(id, p);
  return p;
}

/** Já foi hidratada (ou já nasceu completa)? Usado pelo assimilador. */
export function temDetalhe(id: string): boolean {
  return prontos.has(id) || jaTemConteudo(entradaDe(id));
}

/**
 * Uma rodada de assimilação sobre a lista dada, na ordem em que ela vem.
 *
 * Pura o bastante para ser testada: recebe os ids, não lê o player.
 */
export async function assimilar(ids: readonly string[], teto = ritmo().adiante): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const { respiroMs } = ritmo();
  let feitas = 0;
  for (const id of ids.slice(0, teto)) {
    if (temDetalhe(id)) continue;
    const ok = await garantirDetalhe(id);
    if (ok) feitas++;
    await new Promise((r) => setTimeout(r, respiroMs));
  }
  return feitas;
}

// ── plantão ────────────────────────────────────────────────────────────────

let proximos: string[] = [];

/**
 * O player conta o que vem a seguir. Mesma ideia do guardião do offline, e de
 * propósito: quem sabe a ordem da fila é o player, e adivinhar aqui daria uma
 * segunda fonte de verdade para divergir da primeira.
 */
export function informarFila(ids: readonly string[]): void {
  proximos = [...ids];
}

export function iniciarAssimilador(): () => void {
  let parado = false;
  let rodando = false;

  const bater = async (): Promise<void> => {
    if (parado || rodando) return;
    rodando = true;
    try {
      await assimilar(proximos);
    } catch {
      // Assimilar é adiantamento: falhar aqui só significa que a busca
      // acontece no clique, que é o comportamento base.
    } finally {
      rodando = false;
    }
  };

  // AGENDA A PRÓPRIA PRÓXIMA BATIDA em vez de `setInterval`. Um intervalo fixo
  // congela a cadência do primeiro instante, e é exatamente aí que ela ainda
  // não se sabe: o rebaixamento por travamento medido chega segundos depois.
  // Reagendando, a primeira batida após o rebaixamento já vem no ritmo leve.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const agendar = (): void => {
    if (parado) return;
    timer = setTimeout(() => {
      void bater().finally(agendar);
    }, ritmo().batidaMs);
  };
  agendar();

  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
