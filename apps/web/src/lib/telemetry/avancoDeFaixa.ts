/**
 * O DIÁRIO DO AVANÇO DE FAIXA — o instrumento que faltava para o segundo plano.
 *
 * "Em segundo plano a música não passa para a próxima, nem no iPhone com a tela
 * ligada." O player tem TRÊS pernas para avançar sem a página à vista (o
 * 'ended' do elemento, o relógio de fim e a troca antecipada), e nada dizia
 * qual delas disparou, se alguma disparou, nem o que aconteceu depois. Cada
 * conserto seria palpite — e palpite em áudio de segundo plano já custou caro
 * aqui.
 *
 * Cada avanço vira uma linha: por onde veio, se a página estava oculta, de que
 * faixa para qual, e o DESFECHO — o som saiu (e em quanto tempo), o play foi
 * recusado, deu erro, ou ficou mudo. "Mudo" não fecha a linha: se o som só sair
 * quando a pessoa voltar ao app, o tempo até o som fica registrado, e é
 * exatamente essa a assinatura do defeito.
 *
 * Guardado no aparelho (o iPhone pode matar a aba em segundo plano, e a memória
 * iria junto) e enviado no `aoVivo` da telemetria. Pequeno de propósito.
 */

export type ViaDeAvanco = 'ended' | 'relogioDeFim' | 'trocaAntecipada' | 'fimSintetico';

export type Desfecho = 'tocou' | 'mudo' | 'recusado' | 'erro';

export interface Avanco {
  /** Hora local, HH:MM:SS — o painel já mostra a data do flush. */
  em: string;
  via: ViaDeAvanco;
  /** `document.hidden` no instante do avanço. */
  oculta: boolean;
  de: string | null;
  para: string | null;
  desfecho?: Desfecho;
  /** Do avanço até o primeiro som da faixa nova. */
  msAteSom?: number;
  /** A página ainda estava oculta quando o som saiu? */
  somComOculta?: boolean;
}

const CHAVE = 'aurial:avancos';
const MAX = 30;
/** Sem som depois disto, a linha ganha "mudo" (e continua aberta). */
const PRAZO_MUDO_MS = 10_000;

let diario: Avanco[] = carregar();
let pendente: { indice: number; faixaId: string | null; desde: number } | null = null;
let prazo: ReturnType<typeof setTimeout> | null = null;

function carregar(): Avanco[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lido) ? (lido as Avanco[]).slice(-MAX) : [];
  } catch {
    return [];
  }
}

function gravar(): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(diario));
  } catch {
    /* diagnóstico nunca atrapalha o uso */
  }
}

const oculta = (): boolean => typeof document !== 'undefined' && document.hidden;
const curto = (titulo: string | null | undefined): string | null =>
  titulo ? titulo.slice(0, 60) : null;

/** Um avanço começou. A linha fica aberta até o som sair (ou falhar). */
export function anotarAvanco(
  via: ViaDeAvanco,
  de: { title: string } | null | undefined,
  para: { id: string; title: string } | null | undefined,
): void {
  diario.push({
    em: new Date().toTimeString().slice(0, 8),
    via,
    oculta: oculta(),
    de: curto(de?.title),
    para: curto(para?.title),
  });
  if (diario.length > MAX) diario = diario.slice(-MAX);
  pendente = { indice: diario.length - 1, faixaId: para?.id ?? null, desde: Date.now() };
  gravar();

  if (prazo !== null) clearTimeout(prazo);
  // Temporizador único: em segundo plano ele pode atrasar — e tudo bem, o que
  // ele marca é só "até aqui não saiu som". O tempo real vem de `somSaiu`.
  prazo = setTimeout(() => {
    prazo = null;
    const linha = pendente ? diario[pendente.indice] : undefined;
    if (linha && !linha.desfecho) {
      linha.desfecho = 'mudo';
      gravar();
    }
  }, PRAZO_MUDO_MS);
}

/** Saiu som (posição > 0) na faixa `faixaId`. Fecha a linha aberta, se for dela. */
export function somSaiu(faixaId: string | undefined): void {
  if (!pendente || (pendente.faixaId && pendente.faixaId !== faixaId)) return;
  const linha = diario[pendente.indice];
  if (linha) {
    linha.desfecho = 'tocou';
    linha.msAteSom = Date.now() - pendente.desde;
    linha.somComOculta = oculta();
    gravar();
  }
  pendente = null;
  if (prazo !== null) clearTimeout(prazo);
  prazo = null;
}

/** O motor recusou o play (autoplay) ou a fonte falhou depois de um avanço. */
export function avancoFalhou(tipo: 'recusado' | 'erro'): void {
  if (!pendente) return;
  const linha = diario[pendente.indice];
  if (linha && linha.desfecho !== 'tocou') {
    linha.desfecho = tipo;
    gravar();
  }
  // Não fecha: se um fallback de fonte fizer o som sair depois, `somSaiu`
  // ainda registra o tempo real — a falha fica visível pelo tempo longo.
}

/** Para a telemetria: as últimas linhas, da mais antiga para a mais nova. */
export function lerAvancos(): Avanco[] {
  return diario.slice();
}
