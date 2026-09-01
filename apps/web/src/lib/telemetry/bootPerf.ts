/**
 * Quanto tempo até a música aparecer na tela — medido, não deduzido.
 *
 * Existe pelo mesmo motivo do `playbackDiagnosis`: "está lento" é um sintoma
 * com uma dúzia de causas possíveis (bundle, parse, Firestore, curadoria de
 * fundo, aquecimento de rotas), e escolher a mais provável é chute com cara de
 * diagnóstico. Aqui cada etapa do boot marca a hora em que aconteceu, e
 * `radinhoPerf()` no console imprime a linha do tempo inteira.
 *
 * Custo: um `performance.now()` por etapa. Fica ligado em produção de propósito
 * — a próxima vez que o boot ficar lento, a evidência já está lá.
 */

/** Etapas do boot, na ordem em que devem acontecer. */
export type EtapaBoot =
  /** O módulo de entrada começou a executar (fim do download+parse do bundle). */
  | 'bundle'
  /** React montou o App pela primeira vez. */
  | 'app-montado'
  /** A biblioteca local (localStorage) foi lida e emitida — primeira lista na tela. */
  | 'biblioteca-local'
  /** O SDK do Firebase terminou de carregar. */
  | 'firebase-pronto'
  /** O primeiro snapshot da nuvem chegou (daqui vêm as músicas novas). */
  | 'nuvem-primeiro-snapshot'
  /** A varredura de curadoria em segundo plano começou. */
  | 'curadoria-inicio';

const marcas = new Map<EtapaBoot, number>();

/**
 * QUANTO O APARELHO FICOU TRAVADO — e por que tempo de etapa não responde isso.
 *
 * As marcas acima dizem QUANDO cada etapa aconteceu. Não dizem se, entre elas, a
 * thread principal ficou presa: um boot de 3s em que nada bloqueia é fluido, e
 * um de 1,5s com meio segundo de tarefa longa TRAVA — o dedo não responde, a
 * rolagem engasga, e é isso que a pessoa chama de "estrangulou o aparelho".
 *
 * `longtask` é a medida certa porque é a definição do sintoma: toda tarefa acima
 * de 50ms na thread principal, que é o limiar em que o toque deixa de responder.
 * O que se soma aqui é o EXCEDENTE de cada uma (o que passou dos 50ms) — o
 * mesmo cálculo do Total Blocking Time.
 *
 * Guarda as piores com o atributo de origem quando o navegador conta, para a
 * resposta não parar em "algo travou 800ms" e chegar em QUEM travou.
 */
interface TarefaLonga {
  inicioMs: number;
  duracaoMs: number;
  origem: string;
}

const tarefasLongas: TarefaLonga[] = [];
/** Teto de amostras: um boot ruim não pode virar vazamento de memória. */
const MAX_TAREFAS = 50;
let bloqueioTotalMs = 0;
let observador: PerformanceObserver | null = null;

/** Acima disto uma tarefa deixa o toque sem resposta (definição de long task). */
const LIMIAR_TRAVA_MS = 50;

function observarTarefasLongas(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    observador = new PerformanceObserver((lista) => {
      for (const entrada of lista.getEntries()) {
        bloqueioTotalMs += Math.max(0, entrada.duration - LIMIAR_TRAVA_MS);
        if (tarefasLongas.length < MAX_TAREFAS) {
          const atribuicao = (entrada as PerformanceEntry & { attribution?: { name?: string }[] })
            .attribution?.[0];
          tarefasLongas.push({
            inicioMs: Math.round(entrada.startTime),
            duracaoMs: Math.round(entrada.duration),
            origem: atribuicao?.name ?? entrada.name ?? 'desconhecida',
          });
        }
      }
    });
    // `buffered` recupera as tarefas longas que aconteceram ANTES desta linha —
    // sem isso o boot mais caro (parse do bundle, primeira montagem) ficaria
    // justamente fora da medida.
    observador.observe({ type: 'longtask', buffered: true });
  } catch {
    /* Safari/Firefox ainda não expõem longtask — o resto do relatório vale */
  }
}

/**
 * Cronometra um trecho do boot e devolve o que ele devolveu.
 *
 * Serve para o custo de cada subsistema de fundo aparecer separado. Sem isto, o
 * relatório mostra um bloco só chamado "boot" e a pergunta "qual deles?" fica
 * sem resposta — que é como este app já perdeu tempo consertando o palpite.
 */
const custos = new Map<string, number>();

export async function medirEtapa<T>(nome: string, fn: () => T | Promise<T>): Promise<T> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return await fn();
  } finally {
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    custos.set(nome, Math.round((custos.get(nome) ?? 0) + (t1 - t0)));
  }
}

/** Registra a etapa (a primeira marcação vence — reentrância não desloca). */
export function marcarBoot(etapa: EtapaBoot): void {
  if (marcas.has(etapa)) return;
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  marcas.set(etapa, Math.round(t));
  try {
    performance.mark?.(`radinho:${etapa}`);
  } catch {
    /* User Timing indisponível — as marcas em memória bastam */
  }
}

export interface RelatorioBoot {
  /** Etapa → ms desde o início da navegação. */
  etapas: Record<string, number>;
  /** Quanto o usuário esperou até ver a biblioteca dele. */
  ateBibliotecaMs: number | null;
  /** Quanto até as músicas vindas da nuvem chegarem. */
  ateNuvemMs: number | null;
  /**
   * Soma do que passou de 50ms em cada tarefa longa — o tempo em que o aparelho
   * ficou SEM RESPONDER ao dedo. É este número que representa "estrangulou",
   * não o tempo total do boot.
   */
  bloqueioTotalMs: number;
  /** As piores tarefas longas, da mais cara para a mais barata. */
  piores: TarefaLonga[];
  /** Custo medido de cada subsistema de fundo (ver `medirEtapa`). */
  custoPorSubsistema: Record<string, number>;
}

export function relatorioBoot(): RelatorioBoot {
  const etapas: Record<string, number> = {};
  for (const [etapa, ms] of marcas) etapas[etapa] = ms;
  const custoPorSubsistema: Record<string, number> = {};
  for (const [nome, ms] of custos) custoPorSubsistema[nome] = ms;
  return {
    etapas,
    ateBibliotecaMs: marcas.get('biblioteca-local') ?? null,
    ateNuvemMs: marcas.get('nuvem-primeiro-snapshot') ?? null,
    bloqueioTotalMs: Math.round(bloqueioTotalMs),
    piores: [...tarefasLongas].sort((a, b) => b.duracaoMs - a.duracaoMs).slice(0, 10),
    custoPorSubsistema,
  };
}

/**
 * `radinhoPerf()` no console: linha do tempo do boot + peso do que foi baixado.
 *
 * O segundo bloco responde a pergunta que o primeiro não responde — "esperei
 * 3s, mas esperei baixando o quê?" — somando os recursos por tipo a partir da
 * Resource Timing API.
 */
export function instalarBootPerf(): void {
  if (typeof window === 'undefined') return;
  observarTarefasLongas();
  // O MESMO RELATÓRIO, LEGÍVEL POR MÁQUINA.
  //
  // `radinhoPerf()` imprime para gente ler. Isso não serve para o arnês de
  // desempenho (`e2e/desempenho.spec.ts`), que precisa dos números como dado
  // para comparar aparelho rápido com aparelho lento e falhar quando piorar.
  // Sem esta linha, medir regressão de boot dependeria de raspar `console.table`.
  (window as unknown as { radinhoPerfDados: () => RelatorioBoot }).radinhoPerfDados = relatorioBoot;
  (window as unknown as { radinhoPerf: () => void }).radinhoPerf = (): void => {
    const r = relatorioBoot();
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.table(
      Object.entries(r.etapas).map(([etapa, ms]) => ({ etapa, 'ms desde o início': ms })),
    );

    // O NÚMERO QUE RESPONDE "TRAVOU?". Vem antes do peso dos downloads porque é
    // ele que decide se o aparelho ficou sem responder — rede lenta atrasa, mas
    // não estrangula; tarefa longa estrangula.
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.log(
      `travamento: ${r.bloqueioTotalMs}ms sem responder ao toque (soma do que passou de ${LIMIAR_TRAVA_MS}ms por tarefa)` +
        (r.piores.length === 0 ? ' — nenhuma tarefa longa registrada' : ''),
    );
    if (r.piores.length > 0) {
      // eslint-disable-next-line no-console -- ferramenta de console, é a saída
      console.table(
        r.piores.map((t) => ({
          'ms desde o início': t.inicioMs,
          'durou (ms)': t.duracaoMs,
          origem: t.origem,
        })),
      );
    }
    if (Object.keys(r.custoPorSubsistema).length > 0) {
      // eslint-disable-next-line no-console -- ferramenta de console, é a saída
      console.table(
        Object.entries(r.custoPorSubsistema)
          .sort((a, b) => b[1] - a[1])
          .map(([subsistema, ms]) => ({ subsistema, 'custou (ms)': ms })),
      );
    }

    const porTipo = new Map<string, { arquivos: number; kB: number }>();
    try {
      const recursos = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      for (const rec of recursos) {
        const tipo = rec.initiatorType || 'outro';
        const atual = porTipo.get(tipo) ?? { arquivos: 0, kB: 0 };
        atual.arquivos += 1;
        atual.kB += Math.round((rec.encodedBodySize || 0) / 1024);
        porTipo.set(tipo, atual);
      }
    } catch {
      /* sem Resource Timing */
    }
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.table([...porTipo].map(([tipo, v]) => ({ tipo, ...v })));
  };
}
