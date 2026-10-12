/**
 * O CLIPE SEGUE O ÁUDIO — nunca o contrário.
 *
 * O som continua saindo do player do app (cofre, cache, offline, crossfade):
 * o vídeo do YouTube entra MUDO, só como imagem. Assim abrir ou fechar o clipe
 * não encosta na música, e a única pergunta que sobra é "o quadro bate com o
 * que se ouve?".
 *
 * Bate por construção: o áudio do cofre foi baixado DESTE vídeo (é o
 * `sourceUrl` da faixa), então o segundo 42 do áudio é o segundo 42 do clipe.
 * Não há deslocamento a descobrir — só o atraso de quem segue o outro.
 *
 * ── DOIS JEITOS DE CORRIGIR ──
 *
 * Erro GRANDE (a pessoa arrastou a barra, a faixa trocou, o vídeo travou):
 * salta. Mas `seekTo(t)` não põe o vídeo em `t` — ele leva umas centenas de
 * milissegundos para voltar a tocar, e nesse tempo o som andou. Por isso cada
 * salto é AFERIDO: o erro que sobra depois dele vira correção do próximo
 * (`compensacao`), e em um ou dois saltos o vídeo passa a cair em cima.
 *
 * Erro PEQUENO (o resto que todo salto deixa, a deriva lenta): salto aqui
 * seria pior que o erro — cada um é um engasgo visível. O vídeo acelera ou
 * freia um pouco (o YouTube aceita passos de 0,05×) até encostar no som, sem
 * nenhum corte na imagem.
 *
 * A decisão olha a MEDIANA das últimas medidas, não uma só: o relógio do
 * vídeo chega por mensagem do iframe e oscila; uma leitura torta não pode
 * disparar salto.
 */

/**
 * O que se OUVE está à frente do `currentTime` do <audio> (buffer de saída,
 * Bluetooth) — o mesmo motivo do `LEAD_MS` da letra. O quadro mira o ouvido.
 */
export const ADIANTO_DO_OUVIDO_S = 0.1;
/** Erro tão grande que não precisa de confirmação: salta na hora. */
export const SALTO_IMEDIATO_S = 1;
/** Erro (mediano) acima disto não se corrige acelerando: salta. */
export const LIMITE_S = 0.35;
/** Abaixo disto o vídeo está no tempo — nem acelera nem freia. */
export const NO_TEMPO_S = 0.04;
/** Até aqui o vídeo já pode aparecer; o ajuste fino termina com ele à vista. */
export const APARECER_S = 0.3;
/** Depois de um salto, espera o vídeo assentar antes de medir de novo. */
export const ASSENTAR_MS = 900;
/** Teto da correção aprendida — mais que isto é rede ruim, não atraso de salto. */
export const COMPENSACAO_MAX_S = 1.5;
/** Palpite inicial: o primeiro salto já mira um pouco adiante. */
export const COMPENSACAO_INICIAL_S = 0.2;
/** Quantas medidas entram na mediana. */
const JANELA = 5;
/** Medidas mínimas antes de corrigir pelo miúdo. */
const MINIMO = 3;

export interface EstadoDaSincronia {
  /** Quanto além do alvo o salto deve mirar, aprendido salto a salto. */
  compensacao: number;
  /** `performance.now()` do último salto (0 = nunca saltou). */
  ultimoSalto: number;
  /** A próxima mediana é a primeira depois de um salto — ela calibra. */
  aferir: boolean;
  /** Últimos erros (vídeo − alvo), em segundos. */
  amostras: number[];
}

export function estadoInicial(compensacao = COMPENSACAO_INICIAL_S): EstadoDaSincronia {
  return { compensacao, ultimoSalto: 0, aferir: false, amostras: [] };
}

export interface Decisao {
  /** Para onde levar o vídeo agora, ou `null` se não é caso de salto. */
  saltarPara: number | null;
  /** Multiplicador da velocidade do vídeo (1 = a do som). */
  ritmo: number;
  /** O vídeo está perto o bastante do som — pode aparecer. */
  casado: boolean;
  estado: EstadoDaSincronia;
}

function mediana(xs: readonly number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? (o[m] as number) : ((o[m - 1] as number) + (o[m] as number)) / 2;
}

/**
 * Uma medida: onde o vídeo está, onde o som está, e o que fazer.
 * Pura — o componente lê os relógios, esta função só decide.
 */
export function decidir(
  e: EstadoDaSincronia,
  m: { video: number; audio: number; agora: number },
): Decisao {
  const alvo = m.audio + ADIANTO_DO_OUVIDO_S;
  const erro = m.video - alvo;
  const saltar = (estado: EstadoDaSincronia): Decisao => ({
    saltarPara: alvo + estado.compensacao,
    ritmo: 1,
    casado: false,
    estado: { ...estado, ultimoSalto: m.agora, aferir: true, amostras: [] },
  });

  // Logo depois de um salto o relógio do vídeo ainda mente (está carregando o
  // trecho novo). Medir agora aprenderia lixo.
  if (e.ultimoSalto && m.agora - e.ultimoSalto < ASSENTAR_MS) {
    return { saltarPara: null, ritmo: 1, casado: false, estado: e };
  }
  if (Math.abs(erro) > SALTO_IMEDIATO_S) return saltar(e);

  const amostras = [...e.amostras, erro].slice(-JANELA);
  let estado: EstadoDaSincronia = { ...e, amostras };
  if (amostras.length < MINIMO) {
    return { saltarPara: null, ritmo: 1, casado: Math.abs(erro) <= APARECER_S, estado };
  }

  const tipico = mediana(amostras);
  if (estado.aferir) {
    // Vídeo atrás (tipico < 0) → o salto precisa mirar mais longe; à frente → menos.
    const compensacao = Math.min(COMPENSACAO_MAX_S, Math.max(0, estado.compensacao - tipico));
    estado = { ...estado, compensacao, aferir: false };
  }
  if (Math.abs(tipico) > LIMITE_S) return saltar(estado);

  // Vídeo atrás → acelera; à frente → freia. Mais forte quando longe.
  let ritmo = 1;
  if (Math.abs(tipico) > NO_TEMPO_S) {
    const passo = Math.abs(tipico) > 0.15 ? 0.1 : 0.05;
    ritmo = tipico < 0 ? 1 + passo : 1 - passo;
  }
  return { saltarPara: null, ritmo, casado: Math.abs(tipico) <= APARECER_S, estado };
}

const YT_ID = /^[\w-]{11}$/;

/** O id do vídeo do YouTube num link de origem, ou `null` se não for YouTube. */
export function idDoVideo(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const partes = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return YT_ID.test(partes[0] ?? '') ? (partes[0] as string) : null;
  if (!/^youtube(-nocookie)?\.com$/.test(host)) return null;
  const v = u.searchParams.get('v');
  if (v && YT_ID.test(v)) return v;
  if (['shorts', 'embed', 'live', 'v'].includes(partes[0] ?? '') && YT_ID.test(partes[1] ?? '')) {
    return partes[1] as string;
  }
  return null;
}
