/**
 * A MÁQUINA DE ESTADOS DA NÉVOA — pura: estado anterior + sinais + dt → novo
 * estado (e, nele, os parâmetros que o desenho usa). Não toca em DOM, canvas,
 * relógio nem ruído: é por isso que dá para testar cada transição.
 *
 * ESTADOS (a `fase` é só o rótulo; quem manda são os valores contínuos):
 *  • reunindo   — a faixa foi pedida e o som ainda não saiu: a névoa nasce
 *                 espalhada e é SUGADA para o botão (`suga` 0→1: velocidade
 *                 radial para dentro, anel que se contrai, densidade que se
 *                 acumula na borda).
 *  • girando    — o primeiro som saiu: a sucção vira giro. `suga` desce e `giro`
 *                 sobe no MESMO intervalo (~0,75 s), então a velocidade radial
 *                 vira velocidade angular sem salto; o ângulo é o do guia (o CD).
 *  • assentando — pausou: o giro e a forma desaceleram até o repouso.
 *  • repouso    — assentada; nada mais muda, o laço dorme.
 *  • dissipando — trocou a faixa: a atual some (0,5 s), troca-se a semente com a
 *                 névoa invisível e a nova é reunida (volta a `reunindo`).
 *  • estatica   — sem movimento pedido: parâmetros fixos, nada anda.
 *
 * TODA grandeza que o olho vê passa por uma mola criticamente amortecida
 * (`molaCritica`): valor E velocidade contínuos, nada salta entre quadros.
 */

import { hashDeTexto, sequencia } from './ruido';

export type FaseDaNevoa =
  'estatica' | 'dissipando' | 'reunindo' | 'girando' | 'assentando' | 'repouso';

export interface SinaisDaNevoa {
  /** O usuário pediu som (a store diz `isPlaying`). */
  tocando: boolean;
  /** A faixa foi pedida e o som ainda não saiu (baixando / bufferizando). */
  carregando: boolean;
  /** Sem movimento pedido (reduced-motion): tudo parado. */
  semMovimento: boolean;
  /** Id da faixa — a semente do desenho. '' = ainda não há. */
  faixa: string;
  /** Posição da música (s) quando conhecida: o guia trava nela, em todo aparelho. */
  posicao: number | null;
  /** Rajada de vento 0..1 (o desenho a tira do ruído; só remexe a forma). */
  rajada: number;
}

export interface ParametrosDaNevoa {
  /** 0..1 — quão cheia/acumulada está a névoa na borda do botão. */
  densidade: number;
  /** Beira do anel (fração do raio da caixa): contrai quando sugada. */
  raio: number;
  /** Unidades do ruído por segundo; NEGATIVA = para dentro do botão. */
  velRadial: number;
  /** rad/s, sentido horário na tela. */
  velAngular: number;
  /** 0..1 — opacidade geral. */
  opacidade: number;
}

export interface EstadoDaNevoa extends ParametrosDaNevoa {
  fase: FaseDaNevoa;
  /** Faixa cuja semente está desenhada agora. */
  faixa: string;
  suga: number;
  sugaV: number;
  giro: number;
  giroV: number;
  viva: number;
  vivaV: number;
  reuniao: number;
  reuniaoV: number;
  /** Visibilidade da troca de faixa: 1 normal, 0 invisível. */
  vis: number;
  visV: number;
  /** Segundos que ainda faltam da reunião obrigatória após uma troca de faixa. */
  segura: number;
  /** Acumulados — só andam para a frente (ou, o `fluxo`, para dentro quando sugada). */
  ang: number;
  fluxo: number;
  t: number;
}

/** Uma volta a cada 1,8 s: 33⅓ rpm, a do CD (o guia). */
export const VEL_CD = (Math.PI * 2) / 1.8;
/** O redemoinho enquanto suga: uma volta a cada 2,4 s. */
export const VEL_REDEMOINHO = (Math.PI * 2) / 2.4;
/** Quanto as línguas correm para dentro por segundo, sugadas. */
export const VEL_SUCAO = 1.7;
/** Escorrer para fora, tocando (devagar: a névoa acumulada fica em volta e GIRA). */
export const VEL_FLUXO = 0.3;
/** Tempo de suavização (s) de cada grandeza. Sucção → giro: ~0,75 s (600–900 ms). */
export const TEMPO = {
  sugaSobe: 0.8,
  sugaDesce: 0.75,
  giroSobe: 0.75,
  giroDesce: 1.1,
  vivaSobe: 0.9,
  vivaDesce: 1.6,
  reuniaoSobe: 1.8,
  reuniaoDesce: 2.5,
  surge: 0.6,
} as const;
/** Duração (s) em que a névoa antiga some numa troca de faixa. */
export const DISSIPA = 0.5;
/** Reunião mínima (s) depois de uma troca de faixa, mesmo sem carga. */
export const REUNIAO_MINIMA = 1;
/** Correções de fase do guia: no máximo isto a mais/menos de velocidade. */
const SLEW_ANGULO = 1.2;
const SLEW_T = 0.15;
const SLEW_FLUXO = 0.5;
export const DT_MAX = 0.05;

const DOIS_PI = Math.PI * 2;
const limitar = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const suave = (a: number, b: number, x: number) => {
  const t = limitar((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Mola criticamente amortecida (exata, estável para qualquer dt). Devolve
 * [valor, velocidade]. Valor e velocidade são contínuos — ao contrário de
 * "x += (alvo - x) * k", que arranca com velocidade máxima.
 */
export function molaCritica(
  x: number,
  v: number,
  alvo: number,
  tempo: number,
  dt: number,
): readonly [number, number] {
  const omega = 2 / Math.max(1e-3, tempo);
  const k = omega * dt;
  const exp = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const delta = x - alvo;
  const temp = (v + omega * delta) * dt;
  return [alvo + (delta + temp) * exp, (v - omega * temp) * exp];
}

/** Valores de partida que só dependem da faixa (cada música começa de um ponto). */
export function partidaDaFaixa(faixa: string): { t: number; fluxo: number; ang: number } {
  const r = sequencia(hashDeTexto(faixa || 'radinho') ^ 0x51ed270b);
  return { t: r() * 100, fluxo: r() * 50, ang: r() * DOIS_PI };
}

const arredonda = (x: number, alvo: number, v: number) =>
  Math.abs(x - alvo) < 0.004 && Math.abs(v) < 0.02;

/** Estado de montagem: já assentado no que os sinais pedem — salvo a sucção, que PARTE de zero. */
export function estadoInicial(s: SinaisDaNevoa): EstadoDaNevoa {
  const anda = !s.semMovimento;
  const gira = anda && s.tocando && !s.carregando ? 1 : 0;
  const p = partidaDaFaixa(s.faixa);
  const e: EstadoDaNevoa = {
    fase: 'repouso',
    faixa: s.faixa,
    suga: 0,
    sugaV: 0,
    giro: gira,
    giroV: 0,
    viva: gira,
    vivaV: 0,
    reuniao: anda && s.tocando ? 1 : 0,
    reuniaoV: 0,
    vis: 1,
    visV: 0,
    segura: 0,
    ang: p.ang,
    fluxo: p.fluxo,
    t: p.t,
    densidade: 0,
    raio: 0,
    velRadial: 0,
    velAngular: 0,
    opacidade: 0,
  };
  derivar(e, s);
  return e;
}

/** Calcula `fase` e os parâmetros a partir dos valores contínuos. */
function derivar(e: EstadoDaNevoa, s: SinaisDaNevoa): void {
  const parada = 1 - e.viva;
  const presente = Math.max(e.viva, e.suga, e.reuniao);
  e.densidade = 0.5 + 0.5 * e.reuniao;
  e.raio = 0.98 - 0.12 * e.suga;
  e.velRadial =
    -VEL_SUCAO * e.suga + (VEL_FLUXO * e.viva + (0.06 + 0.1 * s.rajada) * parada) * (1 - e.suga);
  e.velAngular = e.suga * VEL_REDEMOINHO + e.giro * VEL_CD;
  e.opacidade = e.vis * (0.62 + 0.38 * presente);
}

/** Verdadeiro quando NADA mais muda de um quadro para o outro: o laço pode dormir. */
export function emRepouso(e: EstadoDaNevoa, s: SinaisDaNevoa): boolean {
  if (s.semMovimento) return true;
  return (
    !s.tocando &&
    !s.carregando &&
    e.faixa === s.faixa &&
    e.segura <= 0 &&
    e.suga === 0 &&
    e.giro === 0 &&
    e.viva === 0 &&
    e.reuniao === 0 &&
    e.vis === 1
  );
}

/**
 * Um passo. Pura: devolve um estado novo (ou escreve em `destino`, para o laço
 * de quadros não alocar; `destino` pode ser o próprio `e`).
 */
export function avancar(
  e: EstadoDaNevoa,
  s: SinaisDaNevoa,
  dtBruto: number,
  destino: EstadoDaNevoa = { ...e },
): EstadoDaNevoa {
  const dt = limitar(dtBruto, 0, DT_MAX);
  const n = destino;
  if (n !== e) Object.assign(n, e);

  if (s.semMovimento) {
    // Quadro parado: sem velocidade nenhuma; a presença é a do repouso.
    n.fase = 'estatica';
    n.faixa = s.faixa || e.faixa;
    n.suga = n.sugaV = n.giro = n.giroV = n.viva = n.vivaV = 0;
    n.reuniao = n.reuniaoV = 0;
    n.vis = 1;
    n.visV = 0;
    n.segura = 0;
    derivar(n, s);
    return n;
  }

  // ── TROCA DE FAIXA: dissipa a atual, troca a semente invisível, reúne a nova.
  const trocando = s.faixa !== '' && s.faixa !== n.faixa;
  if (trocando && n.faixa === '') {
    // Ainda não havia faixa (a store hidratou depois de montar): só adota.
    n.faixa = s.faixa;
  } else if (trocando) {
    n.vis = Math.max(0, n.vis - dt / DISSIPA);
    n.visV = 0;
    if (n.vis <= 0) {
      const p = partidaDaFaixa(s.faixa);
      n.faixa = s.faixa;
      n.t = p.t;
      n.fluxo = p.fluxo;
      n.segura = REUNIAO_MINIMA;
    }
  } else if (n.vis < 1) {
    [n.vis, n.visV] = molaCritica(n.vis, n.visV, 1, TEMPO.surge, dt);
    n.vis = limitar(n.vis, 0, 1);
    if (arredonda(n.vis, 1, n.visV)) {
      n.vis = 1;
      n.visV = 0;
    }
  }
  const dissipando = s.faixa !== '' && s.faixa !== n.faixa;
  if (!dissipando && n.segura > 0) n.segura = Math.max(0, n.segura - dt);

  // ── ALVOS
  const reune = !dissipando && (s.carregando || n.segura > 0);
  const alvoSuga = reune ? 1 : 0;
  const alvoGiro = !dissipando && s.tocando && !reune ? 1 : 0;
  const alvoViva = !dissipando && s.tocando ? 1 : 0;
  const alvoReuniao = reune || (s.tocando && !dissipando) ? 1 : dissipando ? n.reuniao : 0;

  const molas = (
    k: 'suga' | 'giro' | 'viva' | 'reuniao',
    kv: 'sugaV' | 'giroV' | 'vivaV' | 'reuniaoV',
    alvo: number,
    sobe: number,
    desce: number,
  ) => {
    const [x, v] = molaCritica(n[k], n[kv], alvo, alvo > n[k] ? sobe : desce, dt);
    // Sem passar de 0..1: se a mola ultrapassar, trava e zera a velocidade.
    if (x < 0 || x > 1) {
      n[k] = limitar(x, 0, 1);
      n[kv] = 0;
    } else {
      n[k] = x;
      n[kv] = v;
    }
    if (arredonda(n[k], alvo, n[kv])) {
      n[k] = alvo;
      n[kv] = 0;
    }
  };
  molas('suga', 'sugaV', alvoSuga, TEMPO.sugaSobe, TEMPO.sugaDesce);
  molas('giro', 'giroV', alvoGiro, TEMPO.giroSobe, TEMPO.giroDesce);
  molas('viva', 'vivaV', alvoViva, TEMPO.vivaSobe, TEMPO.vivaDesce);
  molas('reuniao', 'reuniaoV', alvoReuniao, TEMPO.reuniaoSobe, TEMPO.reuniaoDesce);

  derivar(n, s);

  // ── ACUMULADOS (andam pelos parâmetros; nunca voltam, nunca saltam)
  const parada = 1 - n.viva;
  n.ang += dt * n.velAngular;
  n.fluxo += dt * n.velRadial;
  n.t += dt * (0.2 * n.viva + (0.035 + 0.06 * s.rajada) * parada + 0.2 * n.suga);

  // ── TRAVA NO RELÓGIO DA MÚSICA, com correção LIMITADA (rad/s a mais ou a
  // menos): o guia chega à fase de todos os aparelhos sem arrancar.
  if (s.tocando && s.posicao !== null && Number.isFinite(s.posicao) && !dissipando) {
    const trava = suave(0.7, 1, n.giro) * (1 - n.suga);
    if (trava > 0) {
      const dif = ((((s.posicao * VEL_CD - n.ang) % DOIS_PI) + 3 * Math.PI) % DOIS_PI) - Math.PI;
      n.ang += limitar(dif / 0.6, -SLEW_ANGULO, SLEW_ANGULO) * trava * dt;
      n.t += limitar(s.posicao * 0.2 + 11 - n.t, -SLEW_T, SLEW_T) * trava * dt;
      n.fluxo += limitar(s.posicao * 0.95 + 5 - n.fluxo, -SLEW_FLUXO, SLEW_FLUXO) * trava * dt;
    }
  }

  // ── FASE (rótulo)
  if (dissipando) n.fase = 'dissipando';
  else if (reune) n.fase = 'reunindo';
  else if (s.tocando) n.fase = 'girando';
  else n.fase = emRepouso(n, s) ? 'repouso' : 'assentando';
  return n;
}
