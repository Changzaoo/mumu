/**
 * Regras puras da Jornada — sem banco, para dar para testar sem Postgres.
 */
import { LIGA_MAXIMA } from '@radinho/shared';

const FUSO = 'America/Sao_Paulo';

/** Semana ISO ('YYYY-Www') do instante dado, vista no fuso de São Paulo. */
export function semanaIso(quando: Date = new Date()): string {
  // Data de CALENDÁRIO em São Paulo (en-CA devolve AAAA-MM-DD).
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(quando)
    .split('-')
    .map(Number) as [number, number, number];

  // A quinta-feira da semana decide o ano ISO.
  const dia = new Date(Date.UTC(a, m - 1, d));
  const diaDaSemana = dia.getUTCDay() || 7; // segunda=1 … domingo=7
  dia.setUTCDate(dia.getUTCDate() + 4 - diaDaSemana);
  const inicioDoAno = Date.UTC(dia.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((dia.getTime() - inicioDoAno) / 86_400_000 + 1) / 7);
  return `${dia.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export interface EntradaVirada {
  liga: number;
  /** XP que a pessoa fez na semana que acabou. */
  xpAntigo: number;
  /** 1-based, no grupo da semana que acabou. */
  posicao: number;
  /** Quantas pessoas havia nesse grupo. */
  tamanho: number;
}

/**
 * Liga nova depois da virada de semana.
 *
 *  - sobe (máx. Diamante) quem fez XP e ficou entre os 10 primeiros;
 *  - desce (mín. Bronze) quem não fez XP, ou ficou entre os 5 últimos de um
 *    grupo de pelo menos 10. Quem sobe nunca desce na mesma virada.
 */
export function ligaAposVirada(e: EntradaVirada): { liga: number; mudou?: 'subiu' | 'desceu' } {
  const merecePromocao = e.xpAntigo > 0 && e.posicao <= 10;
  if (merecePromocao) {
    return e.liga < LIGA_MAXIMA ? { liga: e.liga + 1, mudou: 'subiu' } : { liga: e.liga };
  }
  const nosUltimos = e.tamanho >= 10 && e.posicao > e.tamanho - 5;
  if (e.liga > 0 && (e.xpAntigo === 0 || nosUltimos)) {
    return { liga: e.liga - 1, mudou: 'desceu' };
  }
  return { liga: e.liga };
}
