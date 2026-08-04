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
}

export function relatorioBoot(): RelatorioBoot {
  const etapas: Record<string, number> = {};
  for (const [etapa, ms] of marcas) etapas[etapa] = ms;
  return {
    etapas,
    ateBibliotecaMs: marcas.get('biblioteca-local') ?? null,
    ateNuvemMs: marcas.get('nuvem-primeiro-snapshot') ?? null,
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
  (window as unknown as { radinhoPerf: () => void }).radinhoPerf = (): void => {
    const r = relatorioBoot();
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.table(
      Object.entries(r.etapas).map(([etapa, ms]) => ({ etapa, 'ms desde o início': ms })),
    );

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
