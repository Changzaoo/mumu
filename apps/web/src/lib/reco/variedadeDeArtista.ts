/**
 * VARIEDADE DE ARTISTA — nunca uma sequência longa do mesmo artista numa fila
 * de "parecidas".
 *
 * Nasceu dentro de `lib/offline/continuidadeOffline.ts` e foi extraído para cá
 * porque o rádio de parecidas (`lib/reco/radio.ts`, o que estende a fila
 * quando um álbum ou uma faixa solta termina) precisa exatamente da mesma
 * regra. Duas cópias divergiriam com o tempo — uma ganharia um ajuste que a
 * outra não veria, e "quantas seguidas é demais" passaria a ter duas respostas
 * dependendo de estar online ou não.
 */
import type { TrackDto } from '@radinho/shared';
import { artistIdentityKey } from '@/lib/local/artistIdentity';

/** Não mais que isto do MESMO artista em sequência — vira "álbum", não "rádio". */
export const MAX_POR_ARTISTA_SEGUIDO = 2;

function nomeArtista(t: TrackDto): string {
  return t.artists?.[0]?.name ?? '';
}

/**
 * Round-robin de variedade: sem isto o artista líder do ranking ocupa a fila
 * inteira (a pontuação dele nunca cai o bastante para intercalar sozinha).
 * Preserva a ordem de pontuação ao máximo — só pula um candidato na frente
 * quando os últimos `maxSeguido` já são do mesmo artista dele.
 */
export function comVariedade(
  ordenadas: readonly TrackDto[],
  limite: number,
  maxSeguido = MAX_POR_ARTISTA_SEGUIDO,
): TrackDto[] {
  const fila = [...ordenadas];
  const out: TrackDto[] = [];
  while (fila.length > 0 && out.length < limite) {
    const ultimos = out.slice(-maxSeguido).map((t) => artistIdentityKey(nomeArtista(t)));
    let idx = fila.findIndex((t) => {
      const chave = artistIdentityKey(nomeArtista(t));
      if (!chave || ultimos.length < maxSeguido) return true;
      return !ultimos.every((k) => k === chave);
    });
    if (idx === -1) idx = 0; // biblioteca de um artista só: não tem como variar
    out.push(fila[idx]!);
    fila.splice(idx, 1);
  }
  return out;
}
