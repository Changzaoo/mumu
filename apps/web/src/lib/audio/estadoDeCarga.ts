/**
 * O QUE O PLAYER ESTÁ FAZENDO ENQUANTO A MÚSICA NÃO SAI — em palavras.
 *
 * Antes, a espera era um spinner no lugar do botão (e só no computador; no
 * celular e na tela cheia, nada). Um spinner diz "espere", mas não diz POR QUÊ
 * nem QUANTO — e "está buscando a música na fonte original pela primeira vez"
 * é uma espera muito diferente de "a conexão está lenta" ou de "o servidor está
 * recuperando esta cópia, leva uns 20 segundos". Quem não sabe o que está
 * acontecendo acha que travou e começa a apertar coisas.
 *
 * O player marca a FASE (ver `carga` no playerStore) e este módulo a traduz.
 * A tradução mora aqui, pura, para que as três superfícies (barra, mini player,
 * tela cheia) digam a mesma coisa e para poder ser testada sem montar tela.
 */

export type FaseDeCarga =
  /** Escolhendo de onde tocar: aparelho, cópia do servidor ou fonte original. */
  | 'preparando'
  /** O importador está extraindo da fonte original (o lento: a 1ª vez). */
  | 'buscandoOrigem'
  /** Pedido feito, esperando os primeiros bytes. */
  | 'carregando'
  /** Já tocou e parou para esperar o resto chegar. */
  | 'esperandoRede'
  /** O cofre está refazendo a cópia (503) — há espera marcada. */
  | 'reconstruindo'
  /** Outra falha passageira — há espera marcada. */
  | 'tentandoDeNovo'
  /** Esta fonte falhou; carregando outra da mesma faixa. */
  | 'trocandoFonte';

export interface EstadoDeCarga {
  fase: FaseDeCarga;
  /** `Date.now()` de quando a fase começou — é dele que sai o "demorando". */
  desde: number;
  /** Nas novas tentativas: qual é esta e quantas cabem. */
  tentativa?: number;
  total?: number;
}

/**
 * Carga rápida não merece texto: piscar "Carregando…" por 300ms é ruído. As
 * fases de espera marcada (reconstruir, tentar de novo, trocar fonte) aparecem
 * na hora, porque ali a pessoa PRECISA saber que o app está resolvendo.
 */
const ATRASO_PARA_FALAR_MS = 1_500;
/** A partir daqui a espera já é "mais que o normal" e o texto diz isso. */
const DEMORANDO_MS = 8_000;

const DE = (e: EstadoDeCarga): string =>
  e.tentativa && e.total ? ` (tentativa ${e.tentativa} de ${e.total})` : '';

/** O texto a mostrar agora, ou `null` quando não há nada a dizer (ainda). */
export function textoDeCarga(estado: EstadoDeCarga | null, agora = Date.now()): string | null {
  if (!estado) return null;
  const passou = agora - estado.desde;
  const demorando = passou >= DEMORANDO_MS;

  switch (estado.fase) {
    case 'reconstruindo':
      return `O servidor está recuperando esta música${DE(estado)} — leva uns 20 segundos.`;
    case 'tentandoDeNovo':
      return `Não carregou — tentando de novo${DE(estado)}…`;
    case 'trocandoFonte':
      return 'Essa cópia falhou — buscando outra fonte da mesma música…';
    default:
      break;
  }

  if (passou < ATRASO_PARA_FALAR_MS) return null;

  switch (estado.fase) {
    case 'preparando':
      return demorando ? 'Ainda procurando de onde tocar esta música…' : 'Preparando a música…';
    case 'buscandoOrigem':
      return demorando
        ? 'Primeira vez desta música: baixando da fonte original. Da próxima vez começa na hora.'
        : 'Buscando a música na fonte original…';
    case 'carregando':
      return demorando
        ? 'Está demorando mais que o normal — a conexão pode estar lenta.'
        : 'Carregando a música…';
    case 'esperandoRede':
      return 'Conexão lenta — esperando o resto da música chegar…';
    default:
      return null;
  }
}

/** Há algo que pode vir a ser dito? (para a tela ligar o relógio só quando precisa) */
export function cargaEmCurso(estado: EstadoDeCarga | null): boolean {
  return estado !== null;
}
