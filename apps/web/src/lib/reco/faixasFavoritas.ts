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
 * A RÉGUA DO PLAY NÃO É DAQUI. Ela mora em `lib/reco/perfilDeGosto` e é a
 * mesma que ordena os gêneros e as ramificações da Home — inclusive a parte que
 * este arquivo não tinha: quanto da faixa foi de fato ouvido. Uma régua para a
 * prateleira e outra para o gênero acima dela dariam duas ordens para a mesma
 * pergunta na mesma tela.
 *
 * Pura e testável: recebe os dados, não lê store nem relógio fora do `now`.
 */
import type { TrackDto } from '@radinho/shared';
import { PESO_CURTIDA, pesoDoPlay } from './perfilDeGosto';

export interface PlayDaFaixa {
  track: TrackDto;
  playedAt?: string;
  /** Quanto da faixa foi ouvido — grava o player, pesa o `pesoDoPlay`. */
  playedMs?: number;
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
    peso.set(id, (peso.get(id) ?? 0) + pesoDoPlay(entrada, agora));
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
