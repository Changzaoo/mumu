/**
 * Insights heurísticos por usuário para o painel /telemetria.
 *
 * IMPORTANTE: nada aqui é machine learning — são REGRAS transparentes e
 * determinísticas sobre os dados já coletados pela telemetria. Cada fórmula
 * está documentada no próprio código para o admin auditar. A UI deve deixar
 * claro que os números são ESTIMATIVAS heurísticas.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Subconjunto do TelemetryDoc que os insights consomem — mantido estrutural
 * (sem importar da página) para a lib não depender da camada de UI. Todos os
 * campos são opcionais: docs antigos podem não ter nada disso.
 */
export interface InsightSource {
  lastSeenAt?: string;
  totalSeconds?: number;
  sessions?: number;
  totalPlays?: number;
  likedCount?: number;
  libraryCount?: number;
  jsErrors?: number;
  pwaInstalled?: boolean;
  netDownMbps?: number | null;
  hourHistogram?: Record<string, number>;
  recentSessions?: Array<{ startedAt: string; durationSec: number }>;
}

export type ChurnRisk = 'baixo' | 'médio' | 'alto';

export interface UserInsights {
  /** Engajamento 0–100 (tempo + plays + sessões + recência). */
  engagement: number;
  /** Risco de abandono pela recência + queda de frequência de sessões. */
  churnRisk: ChurnRisk;
  /** Chance estimada (0–100%) de o usuário voltar amanhã. */
  returnTomorrowPct: number;
  /** Score 0–100 de "heavy user" (volume absoluto de uso). */
  heavyUserScore: number;
  /** Hora do dia (0–23) com mais uso — melhor janela para notificar. */
  bestNotifyHour: number | null;
  /** Sugestões de retenção em texto, geradas por regras. */
  suggestions: string[];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Dias (fração) desde o último acesso; Infinity quando nunca visto. */
function daysSinceLastSeen(doc: InsightSource): number {
  if (!doc.lastSeenAt) return Infinity;
  const ms = Date.now() - new Date(doc.lastSeenAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / DAY_MS) : Infinity;
}

/** Sessões iniciadas dentro da janela [de, até) dias atrás. */
function sessionsInWindow(doc: InsightSource, fromDaysAgo: number, toDaysAgo: number): number {
  const now = Date.now();
  return (doc.recentSessions ?? []).filter((s) => {
    const t = new Date(s.startedAt).getTime();
    if (!Number.isFinite(t)) return false;
    const daysAgo = (now - t) / DAY_MS;
    return daysAgo >= fromDaysAgo && daysAgo < toDaysAgo;
  }).length;
}

/** Dias de calendário distintos com sessão nos últimos `windowDays` dias. */
function activeDays(doc: InsightSource, windowDays: number): number {
  const now = Date.now();
  const days = new Set<string>();
  for (const s of doc.recentSessions ?? []) {
    const t = new Date(s.startedAt).getTime();
    if (!Number.isFinite(t)) continue;
    if ((now - t) / DAY_MS >= windowDays) continue;
    days.add(new Date(t).toDateString());
  }
  return days.size;
}

/**
 * Engajamento 0–100 — soma ponderada de quatro sinais normalizados:
 *   30 pts · tempo total no app   (satura em 20h)
 *   25 pts · total de plays       (satura em 200 plays)
 *   20 pts · número de sessões    (satura em 30 sessões)
 *   25 pts · recência             (linear: 25 se visto agora → 0 se há 14+ dias)
 */
function computeEngagement(doc: InsightSource, daysSince: number): number {
  const hours = (doc.totalSeconds ?? 0) / 3600;
  const timeScore = 30 * clamp01(hours / 20);
  const playScore = 25 * clamp01((doc.totalPlays ?? 0) / 200);
  const sessionScore = 20 * clamp01((doc.sessions ?? 0) / 30);
  const recencyScore = 25 * clamp01(1 - daysSince / 14);
  return Math.round(timeScore + playScore + sessionScore + recencyScore);
}

/**
 * Risco de abandono — recência + queda de uso:
 *   base: visto há ≤3 dias → baixo; ≤7 dias → médio; >7 dias → alto.
 *   agravante: se as sessões dos últimos 7 dias caíram para menos da METADE
 *   das sessões dos 7 dias anteriores (com pelo menos 2 antes), sobe um nível.
 */
function computeChurnRisk(doc: InsightSource, daysSince: number): ChurnRisk {
  let risk: ChurnRisk = daysSince <= 3 ? 'baixo' : daysSince <= 7 ? 'médio' : 'alto';
  const last7 = sessionsInWindow(doc, 0, 7);
  const prev7 = sessionsInWindow(doc, 7, 14);
  if (prev7 >= 2 && last7 < prev7 / 2) {
    risk = risk === 'baixo' ? 'médio' : 'alto';
  }
  return risk;
}

/**
 * Chance de voltar amanhã (0–100%) — frequência de dias ativos:
 *   base = (dias distintos com sessão nos últimos 14 dias) / 14;
 *   +15 pontos percentuais se foi visto nas últimas 24h;
 *   teto de 10% quando está sumido há mais de 7 dias.
 *   Sem log de sessões (doc antigo), cai num fallback só por recência:
 *   visto hoje → 40%, na última semana → 15%, além disso → 5%.
 */
function computeReturnTomorrow(doc: InsightSource, daysSince: number): number {
  let p: number;
  if ((doc.recentSessions?.length ?? 0) > 0) {
    p = activeDays(doc, 14) / 14;
    if (daysSince < 1) p += 0.15;
  } else {
    p = daysSince < 1 ? 0.4 : daysSince < 7 ? 0.15 : 0.05;
  }
  if (daysSince > 7) p = Math.min(p, 0.1);
  return Math.round(clamp01(p) * 100);
}

/**
 * Heavy-user score 0–100 — volume absoluto, independente de recência:
 *   40 pts · horas no app     (satura em 25h)
 *   35 pts · total de plays   (satura em 250 plays)
 *   25 pts · biblioteca       (satura em 500 faixas)
 */
function computeHeavyUser(doc: InsightSource): number {
  const hours = (doc.totalSeconds ?? 0) / 3600;
  return Math.round(
    40 * clamp01(hours / 25) +
      35 * clamp01((doc.totalPlays ?? 0) / 250) +
      25 * clamp01((doc.libraryCount ?? 0) / 500),
  );
}

/** Hora (0–23) com mais segundos acumulados no hourHistogram. */
function computeBestNotifyHour(doc: InsightSource): number | null {
  let best: [number, number] | null = null;
  for (const [key, seconds] of Object.entries(doc.hourHistogram ?? {})) {
    const h = Number(key.replace(/^h/, ''));
    if (!Number.isFinite(h) || h < 0 || h > 23) continue;
    if (!best || seconds > best[1]) best = [h, seconds];
  }
  return best ? best[0] : null;
}

/** Sugestões de retenção por regras simples e legíveis. */
function computeSuggestions(
  doc: InsightSource,
  daysSince: number,
  engagement: number,
  risk: ChurnRisk,
): string[] {
  const out: string[] = [];
  if (daysSince > 7 && Number.isFinite(daysSince)) {
    out.push(`Inativo há ${Math.floor(daysSince)} dias — reengajar por e-mail ou push.`);
  } else if (risk === 'médio') {
    out.push('Frequência caindo — vale um lembrete leve (nova música, mix da semana).');
  }
  if ((doc.jsErrors ?? 0) > 0) {
    out.push(`Teve ${doc.jsErrors} erro(s) de JS — priorizar correção de bugs para este perfil.`);
  }
  if (!doc.pwaInstalled && engagement >= 50) {
    out.push('Engajado mas sem o app instalado — sugerir instalação do PWA.');
  }
  if ((doc.totalPlays ?? 0) >= 20 && (doc.likedCount ?? 0) === 0) {
    out.push('Ouve bastante mas nunca curtiu uma faixa — destacar o botão de curtir.');
  }
  if (doc.netDownMbps != null && doc.netDownMbps < 5) {
    out.push('Conexão lenta (<5 Mbps) — priorizar cache offline e qualidade adaptativa.');
  }
  if (engagement >= 70 && risk === 'baixo') {
    out.push('Usuário fiel — bom candidato a beta tester e pedidos de feedback.');
  }
  return out;
}

/** Calcula todos os insights heurísticos de um usuário a partir do doc. */
export function computeInsights(doc: InsightSource): UserInsights {
  const daysSince = daysSinceLastSeen(doc);
  const engagement = computeEngagement(doc, daysSince);
  const churnRisk = computeChurnRisk(doc, daysSince);
  return {
    engagement,
    churnRisk,
    returnTomorrowPct: computeReturnTomorrow(doc, daysSince),
    heavyUserScore: computeHeavyUser(doc),
    bestNotifyHour: computeBestNotifyHour(doc),
    suggestions: computeSuggestions(doc, daysSince, engagement, churnRisk),
  };
}
