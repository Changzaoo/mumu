/**
 * AS FAIXAS QUE ELA MAIS GOSTA — não as que ela tocou por último.
 *
 * A Biblioteca abria com "Baixadas no dispositivo": a ordem de chegada dos
 * arquivos. É o dado mais fácil de mostrar e o menos interessante de olhar —
 * quem tem trezentas faixas não abre a biblioteca para rever a última que
 * importou, abre para chegar no que já é dela.
 *
 * "Mais gosta" aqui é feito dos dois únicos sinais honestos que existem
 * on-device:
 *
 *   1. O QUE ELA TOCA, com decaimento no tempo — um play de hoje vale o dobro
 *      de um de trinta dias atrás. Gosto muda, e a prateleira serve para hoje.
 *   2. O QUE ELA CURTIU, como BÔNUS e não como entrada: o coração empurra para
 *      cima o que ela já ouve, mas não coloca na prateleira quem nunca tocou.
 *      Sem essa regra "Você mais ouve" viraria uma segunda prateleira de
 *      Curtidas logo acima da de Curtidas — duas cópias da mesma lista.
 *
 * UMA RESSALVA DE MEDIÇÃO. O histórico junta repetições consecutivas da mesma
 * faixa numa entrada só (ver `localHistory.record`), então quem deixou a mesma
 * música no repeat conta uma vez. É subestimação, nunca invenção: a ordem
 * continua sendo a de quem realmente volta na faixa em sessões diferentes.
 *
 * Pura e testável: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';

/** Meia-vida do play: o de um mês atrás vale metade do de hoje. */
const MEIA_VIDA_MS = 30 * 24 * 60 * 60 * 1000;
/** Uma curtida vale por vários plays — ela foi deliberada. */
const PESO_CURTIDA = 3;

export interface PlayDaFaixa {
  track: TrackDto;
  playedAt?: string;
}

/**
 * Ordena as faixas da pessoa, da mais dela para a menos. Só entram faixas com
 * pelo menos um play; curtida apenas pesa.
 */
export function faixasFavoritas(
  historico: readonly PlayDaFaixa[],
  curtidas: readonly TrackDto[],
  opts: { now?: Date; limite?: number } = {},
): TrackDto[] {
  const agora = (opts.now ?? new Date()).getTime();
  const peso = new Map<string, number>();
  const faixa = new Map<string, TrackDto>();
  const ultimoPlay = new Map<string, number>();

  for (const entrada of historico) {
    const id = entrada.track?.id;
    if (!id) continue;
    const quando = entrada.playedAt ? Date.parse(entrada.playedAt) : Number.NaN;
    // Data ilegível (ou do futuro, relógio torto) não descarta o play: ele
    // aconteceu. Só não ganha o bônus de recência.
    const idade = Number.isFinite(quando) ? Math.max(0, agora - quando) : MEIA_VIDA_MS;
    peso.set(id, (peso.get(id) ?? 0) + Math.pow(0.5, idade / MEIA_VIDA_MS));
    if (!faixa.has(id)) faixa.set(id, entrada.track);
    if (Number.isFinite(quando)) {
      ultimoPlay.set(id, Math.max(ultimoPlay.get(id) ?? 0, quando));
    }
  }

  const curtida = new Set(curtidas.map((t) => t.id));
  for (const id of curtida) {
    if (peso.has(id)) peso.set(id, (peso.get(id) ?? 0) + PESO_CURTIDA);
  }

  const ordenadas = [...peso.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // Empate (duas faixas com um play cada): a mais recente na frente.
    return (ultimoPlay.get(b[0]) ?? 0) - (ultimoPlay.get(a[0]) ?? 0);
  });

  const saida: TrackDto[] = [];
  for (const [id] of ordenadas) {
    const t = faixa.get(id);
    if (t) saida.push(t);
    if (opts.limite !== undefined && saida.length >= opts.limite) break;
  }
  return saida;
}
