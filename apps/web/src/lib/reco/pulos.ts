/**
 * O PULO — o sinal que faltava (ver `SINAL_QUE_FALTA` em perfilDeGosto).
 *
 * Até aqui o motor só sabia o que a pessoa OUVIU; o que ela pulou não deixava
 * rastro, e a rádio podia oferecer a mesma música dez vezes seguidas para quem
 * pulava todas. Agora o pulo fica anotado no aparelho.
 *
 * ── PULAR NÃO É NÃO GOSTAR ──
 *
 * O pedido veio com a ressalva exata: "às vezes ele gosta da música, porém só
 * não está no momento de ouvir ela". Então o pulo é um sinal FRACO e que PASSA:
 *
 *  - ele REBAIXA, nunca exclui. O fator mínimo é 0,3: a faixa pulada cai para
 *    o fim da fila de recomendação, mas continua lá, e volta com o tempo;
 *  - ele ESQUECE: meia-vida de 5 dias para a faixa. Pulada hoje, pesa inteira;
 *    daqui a uma semana, menos da metade; em um mês, quase nada;
 *  - ele é GRADUADO: pular nos primeiros segundos diz muito, pular a um minuto
 *    do fim diz quase nada — a pessoa já ouviu a música;
 *  - ouvir de novo PERDOA: se a faixa pulada tocar até contar como play, o
 *    pulo dela é apagado. "Não era a hora" virou "agora era".
 *
 * O artista também sente, bem mais de leve: pular várias músicas do mesmo
 * artista na mesma semana diz algo sobre o artista naquela semana, não só
 * sobre cada faixa. Mas o peso dele é um quarto do da faixa — pular uma música
 * de alguém não pode enterrar a discografia inteira.
 *
 * Tudo no aparelho, como o resto do motor: nada disto sai daqui.
 */
import type { TrackDto } from '@radinho/shared';
import { artistIdentityKey } from '@/lib/local/artistIdentity';
import { gravarLocal } from '@/lib/local/cofreLocal';

export interface Pulo {
  id: string;
  /** Identidade do artista principal (ver `artistIdentity`). */
  artista: string;
  /** `Date.now()` do pulo. */
  em: number;
  /** Quanto da faixa tinha tocado (0..1). */
  fracao: number;
}

const CHAVE = 'aurial:pulos';
const MAX = 400;
const DIA = 24 * 60 * 60 * 1000;
/** Pulo com mais de 60 dias já não pesa nada — nem vale guardar. */
const VIDA_MAXIMA = 60 * DIA;
const MEIA_VIDA_FAIXA = 5 * DIA;
const MEIA_VIDA_ARTISTA = 10 * DIA;
/** Quanto um pulo de faixa derruba, e quanto um do mesmo artista derruba. */
const FORCA_FAIXA = 0.9;
const FORCA_ARTISTA = 0.22;
/** Rebaixa, nunca exclui. */
export const FATOR_MINIMO = 0.3;

/** Pular cedo diz muito; pular perto do fim, quase nada. */
export function pesoDoPulo(fracao: number): number {
  if (fracao < 0.25) return 1;
  if (fracao < 0.5) return 0.6;
  if (fracao < 0.75) return 0.3;
  return 0.1;
}

const decaimento = (idadeMs: number, meiaVida: number): number =>
  Math.pow(0.5, Math.max(0, idadeMs) / meiaVida);

/**
 * O multiplicador de relevância da faixa agora, em [FATOR_MINIMO, 1].
 * 1 = nenhum pulo pesando. Puro: recebe os pulos e a hora.
 */
export function fatorDePulo(track: TrackDto, pulos: readonly Pulo[], agora: number): number {
  const artista = artistIdentityKey(track.artists[0]?.name ?? '');
  let daFaixa = 0;
  let doArtista = 0;
  for (const p of pulos) {
    const idade = agora - p.em;
    if (idade > VIDA_MAXIMA) continue;
    const peso = pesoDoPulo(p.fracao);
    if (p.id === track.id) daFaixa += peso * decaimento(idade, MEIA_VIDA_FAIXA);
    else if (artista && p.artista === artista) {
      doArtista += peso * decaimento(idade, MEIA_VIDA_ARTISTA);
    }
  }
  const fator = 1 / (1 + FORCA_FAIXA * daFaixa + FORCA_ARTISTA * doArtista);
  return Math.max(FATOR_MINIMO, fator);
}

// ── armazenamento no aparelho ───────────────────────────────────

let cache: Pulo[] | null = null;

export function lerPulos(): Pulo[] {
  if (cache) return cache;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    cache = Array.isArray(lido) ? (lido as Pulo[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function gravar(pulos: Pulo[]): void {
  const agora = Date.now();
  // Poda na escrita: o que já não pesa sai, e a lista nunca passa do teto.
  cache = pulos.filter((p) => agora - p.em <= VIDA_MAXIMA).slice(-MAX);
  try {
    gravarLocal(CHAVE, JSON.stringify(cache));
  } catch {
    /* sem espaço: perde-se o pulo, nunca a música */
  }
}

/**
 * A pessoa pulou `track` depois de `segundos` tocando. Só conta pulo de faixa
 * que CHEGOU A SOAR: faixa morta que o player pulou sozinho não é escolha de
 * ninguém, e anotá-la puniria a música pela falha do servidor.
 */
export function registrarPulo(
  track: TrackDto,
  segundos: number,
  duracao: number,
  agora = Date.now(),
): void {
  if (!(segundos >= 1)) return;
  const fracao = duracao > 0 ? Math.min(1, segundos / duracao) : 0;
  // Pulou no finzinho: é o mesmo que ter ouvido.
  if (fracao >= 0.9) return;
  gravar([
    ...lerPulos(),
    {
      id: track.id,
      artista: artistIdentityKey(track.artists[0]?.name ?? ''),
      em: agora,
      fracao,
    },
  ]);
}

/** Tocou até contar como play: "não era a hora" virou "agora era". */
export function perdoarPulos(trackId: string): void {
  const pulos = lerPulos();
  if (!pulos.some((p) => p.id === trackId)) return;
  gravar(pulos.filter((p) => p.id !== trackId));
}
