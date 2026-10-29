/**
 * DIAS E SEMANAS DA JORNADA — sempre no fuso do aparelho.
 *
 * "Dia" é o dia do calendário de quem ouve (meia-noite local vira o dia), e a
 * chave é `YYYY-MM-DD`. A semana da liga é a ISO (`YYYY-Www`, segunda a
 * domingo) — o servidor calcula a mesma coisa em America/Sao_Paulo.
 */

const dois = (n: number): string => String(n).padStart(2, '0');

export function chaveDoDia(data: Date = new Date()): string {
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

/** Chave → data ao meio-dia local (meio-dia: nenhum horário de verão a desloca). */
export function dataDaChave(chave: string): Date {
  const [a, m, d] = chave.split('-').map(Number);
  return new Date(a!, m! - 1, d!, 12);
}

export function somarDias(chave: string, n: number): string {
  const d = dataDaChave(chave);
  d.setDate(d.getDate() + n);
  return chaveDoDia(d);
}

/** Quantos dias de `a` até `b` (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((dataDaChave(b).getTime() - dataDaChave(a).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(chave: string): number {
  return dataDaChave(chave).getDay();
}

/** Semana ISO 8601: `2026-W44`. */
export function semanaIso(data: Date = new Date()): string {
  const d = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
  const diaIso = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaIso);
  const inicioDoAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioDoAno.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${dois(semana)}`;
}

/** A segunda-feira da semana de `chave`. */
export function segundaDaSemana(chave: string): string {
  const dia = diaDaSemana(chave);
  return somarDias(chave, dia === 0 ? -6 : 1 - dia);
}
