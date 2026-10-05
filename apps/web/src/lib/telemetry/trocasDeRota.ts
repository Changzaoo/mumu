/**
 * QUANTO DEMORA CADA TROCA DE TELA — medido NO APARELHO, não na bancada.
 *
 * A bancada (`pnpm perf:g34`) dizia que "aba → Início" levava 50–140 ms. O dono,
 * no Moto G34 de verdade, sentia a Home lenta ao voltar: 26 cliques em "Início"
 * numa sessão, tarefas longas de 350–636 ms vindas do IndexedDB e de um render
 * grande. A diferença é a biblioteca REAL, o heap alto e o coletor de lixo — que
 * a bancada não tem. Sem medir lá, o próximo conserto seria palpite de novo.
 *
 * O que se registra, por troca de rota:
 *   de → para   rotas normalizadas ('/artista/Ice Cube' vira '/artista/*')
 *   ms          do clique/navegação até o conteúdo da rota nova PINTADO
 *   longaMs     a maior tarefa longa que caiu dentro desse intervalo
 *
 * "Conteúdo pintado" = o `<main>` mudou de verdade depois da navegação, não há
 * mais esqueleto nele e passaram dois quadros (rAF duplo). É o mesmo critério da
 * bancada (`esperarDePe` em e2e/g34.interacao.spec.ts), para os dois números
 * poderem ser postos lado a lado.
 *
 * COMO LER (aba "Ao vivo" da telemetria, campo `trocas`):
 *   ultimas   as ~20 últimas trocas, da mais velha para a mais nova;
 *   resumo    por rota de DESTINO: n, mediana e p95 em ms (últimas 40 amostras);
 *   boot      do início da navegação até o primeiro conteúdo pintado da rota
 *             de entrada ({ rota: '/', ms: 1400 } = "boot até a Home com conteúdo").
 * No console: `radinhoTrocas()`.
 *
 * Troca acima de 800 ms também ganha uma linha no diário ('app', 'troca-lenta').
 *
 * Custo: um MutationObserver (só `childList`, sem atributos), um observador de
 * `longtask` e dois monkey-patches de `history`. O observador de DOM só fica de
 * pé ENQUANTO uma troca está em andamento (e até o boot terminar).
 */

import { anotar } from '@/lib/telemetry/diario';

export interface Troca {
  de: string;
  para: string;
  /** Do clique/navegação até o conteúdo pintado (ms). */
  ms: number;
  /** Maior tarefa longa dentro do intervalo (ms; 0 = nenhuma). */
  longaMs: number;
  /** Hora local HH:MM:SS em que a troca terminou. */
  em: string;
}

export interface ResumoDaRota {
  n: number;
  medianaMs: number;
  p95Ms: number;
}

export interface DadosDeTrocas {
  ultimas: Troca[];
  resumo: Record<string, ResumoDaRota>;
  boot: { rota: string; ms: number } | null;
}

/** Quantas trocas ficam guardadas (o payload da telemetria não pode inflar). */
export const MAX_TROCAS = 20;
/** Amostras por rota de destino que alimentam mediana/p95. */
export const MAX_AMOSTRAS_POR_ROTA = 40;
/** Rotas de destino distintas no resumo (rotas raras não empurram as comuns). */
export const MAX_ROTAS_NO_RESUMO = 14;
/** Acima disto a troca ganha uma linha no diário de bordo. */
const TROCA_LENTA_MS = 800;
/** Acima disto a troca é dada por perdida (aba em segundo plano, rede morta). */
const TETO_DA_TROCA_MS = 15_000;

const ultimas: Troca[] = [];
const amostras = new Map<string, number[]>();
let boot: { rota: string; ms: number } | null = null;

const hora = (): string => new Date().toISOString().slice(11, 19);

/**
 * A rota sem os parâmetros: o resumo é por TELA, não por artista.
 * '/artista/Ice%20Cube' → '/artista/*'; '/search?q=x' → '/search'; '/' → '/'.
 */
export function normalizarRota(caminho: string): string {
  const semConsulta = caminho.split(/[?#]/)[0] ?? '/';
  const partes = semConsulta.split('/').filter(Boolean);
  if (partes.length === 0) return '/';
  return partes.length === 1 ? `/${partes[0]}` : `/${partes[0]}/*`;
}

function percentil(ordenado: number[], p: number): number {
  if (ordenado.length === 0) return 0;
  const i = Math.min(ordenado.length - 1, Math.ceil(p * ordenado.length) - 1);
  return ordenado[Math.max(0, i)] ?? 0;
}

/** Guarda uma troca (limita o histórico e as amostras do resumo). */
export function registrarTroca(t: Omit<Troca, 'em'> & { em?: string }): void {
  const troca: Troca = { ...t, em: t.em ?? hora() };
  ultimas.push(troca);
  while (ultimas.length > MAX_TROCAS) ultimas.shift();

  const lista = amostras.get(troca.para) ?? [];
  lista.push(troca.ms);
  while (lista.length > MAX_AMOSTRAS_POR_ROTA) lista.shift();
  // Reinsere para manter a ordem de "mais recente por último" no Map.
  amostras.delete(troca.para);
  amostras.set(troca.para, lista);
  while (amostras.size > MAX_ROTAS_NO_RESUMO) {
    const maisAntiga = amostras.keys().next().value;
    if (maisAntiga === undefined) break;
    amostras.delete(maisAntiga);
  }
}

export function registrarBoot(rota: string, ms: number): void {
  boot ??= { rota, ms: Math.round(ms) };
}

export function dadosDeTrocas(): DadosDeTrocas {
  const resumo: Record<string, ResumoDaRota> = {};
  for (const [rota, lista] of amostras) {
    const ordenado = [...lista].sort((a, b) => a - b);
    resumo[rota] = {
      n: lista.length,
      medianaMs: percentil(ordenado, 0.5),
      p95Ms: percentil(ordenado, 0.95),
    };
  }
  return { ultimas: [...ultimas], resumo, boot };
}

/** Só para os testes: volta ao estado de fábrica. */
export function zerarTrocas(): void {
  ultimas.length = 0;
  amostras.clear();
  boot = null;
}

// ── detecção no navegador ───────────────────────────────────────────────────

interface Pendente {
  de: string;
  para: string;
  t0: number;
  /** A rota nova já mexeu no `<main>`? (Antes disso, "sem esqueleto" é a rota VELHA.) */
  mexeu: boolean;
  /** Já há um rAF duplo agendado? */
  agendado: boolean;
  teto: ReturnType<typeof setTimeout>;
}

let instalado = false;
let pendente: Pendente | null = null;
let observadorDeDom: MutationObserver | null = null;
let ultimoToque = -Infinity;
const tarefasLongas: { s: number; d: number }[] = [];

/** O conteúdo da rota está de pé: há `<main>` com algo dentro e nenhum esqueleto. */
function conteudoDePe(): boolean {
  const main = document.querySelector('main');
  if (!main) return false;
  if (main.querySelector('.skeleton, [aria-busy="true"]')) return false;
  return main.querySelector('h1, h2, h3, a[href], button') !== null;
}

function maiorTarefaLonga(de: number, ate: number): number {
  let maior = 0;
  for (const t of tarefasLongas) {
    if (t.s + t.d >= de && t.s <= ate) maior = Math.max(maior, t.d);
  }
  return Math.round(maior);
}

function quadroDuplo(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function encerrar(): void {
  if (!pendente) return;
  clearTimeout(pendente.teto);
  pendente = null;
  if (boot !== null || !bootPendente) observadorDeDom?.disconnect();
}

/** Há um boot ainda à espera do primeiro conteúdo? */
let bootPendente = false;

function tentarConcluir(): void {
  const p = pendente;
  if (!p || p.agendado || !p.mexeu || !conteudoDePe()) return;
  p.agendado = true;
  quadroDuplo(() => {
    if (pendente !== p) return;
    const fim = performance.now();
    const troca = {
      de: p.de,
      para: p.para,
      ms: Math.round(fim - p.t0),
      longaMs: maiorTarefaLonga(p.t0, fim),
    };
    registrarTroca(troca);
    // Só a troca LENTA vai para o diário: o histórico completo está em `trocas`
    // (telemetria ao vivo) e uma linha por clique empurraria o resto para fora.
    if (troca.ms >= TROCA_LENTA_MS) {
      anotar(
        'app',
        'troca-lenta',
        `${troca.de} → ${troca.para} ${troca.ms} ms (tarefa ${troca.longaMs} ms)`,
      );
    }
    encerrar();
  });
}

function aoMudarODom(mudancas: MutationRecord[]): void {
  if (bootPendente && boot === null) tentarConcluirBoot();
  const p = pendente;
  if (!p) return;
  const main = document.querySelector('main');
  // Sem `<main>` (telas fora da casca) qualquer mudança de DOM vale.
  if (!p.mexeu && (!main || mudancas.some((m) => main.contains(m.target)))) p.mexeu = true;
  if (p.mexeu) tentarConcluir();
}

function iniciar(de: string, para: string): void {
  const rotaDe = normalizarRota(de);
  const rotaPara = normalizarRota(para);
  // Mesmo "tipo" de tela (ex.: busca trocando de consulta) não é troca de rota.
  if (de.split(/[?#]/)[0] === para.split(/[?#]/)[0]) return;
  if (pendente) clearTimeout(pendente.teto);
  const agora = performance.now();
  // O clique que causou a navegação vale como começo, se foi há pouco: é o que
  // a pessoa sente (o toque), e não o `pushState`, que vem depois do handler.
  const t0 = agora - ultimoToque < 1_000 ? ultimoToque : agora;
  const p: Pendente = {
    de: rotaDe,
    para: rotaPara,
    t0,
    mexeu: false,
    agendado: false,
    teto: setTimeout(() => {
      if (pendente === p) encerrar(); // perdida: não entra no resumo
    }, TETO_DA_TROCA_MS),
  };
  pendente = p;
  observadorDeDom?.observe(document.body, { childList: true, subtree: true });
  // A rota nova pode já estar montada (cache) e não mexer em nada além do
  // próprio commit — que acontece logo depois deste patch. Se nada mudar em
  // 3 quadros, confere do mesmo jeito.
  quadroDuplo(() => {
    if (pendente !== p) return;
    quadroDuplo(() => {
      if (pendente !== p) return;
      if (!p.mexeu && document.querySelector('main')?.childElementCount) p.mexeu = true;
      tentarConcluir();
    });
  });
}

function tentarConcluirBoot(): void {
  if (boot !== null || !conteudoDePe()) return;
  const rota = normalizarRota(location.pathname);
  quadroDuplo(() => {
    registrarBoot(rota, performance.now());
    bootPendente = false;
    if (!pendente) observadorDeDom?.disconnect();
  });
}

/** Liga a sonda (idempotente). Chamado pelo `aoVivo` junto com as outras. */
export function instalarSondaDeRotas(): void {
  if (instalado || typeof window === 'undefined' || typeof document === 'undefined') return;
  instalado = true;

  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) tarefasLongas.push({ s: e.startTime, d: e.duration });
      // Só o que ainda pode cair numa troca: os últimos 30 s.
      const corte = performance.now() - 30_000;
      while (tarefasLongas.length > 0 && tarefasLongas[0]!.s + tarefasLongas[0]!.d < corte) {
        tarefasLongas.shift();
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* sem longtask: longaMs fica 0 */
  }

  // O toque é o começo de verdade da troca (o `pushState` só vem depois).
  window.addEventListener('pointerdown', (e) => (ultimoToque = e.timeStamp), {
    capture: true,
    passive: true,
  });

  observadorDeDom = new MutationObserver(aoMudarODom);

  // BOOT: do início da navegação até o primeiro conteúdo pintado da rota de entrada.
  bootPendente = true;
  const arrancar = (): void => {
    observadorDeDom?.observe(document.body, { childList: true, subtree: true });
    tentarConcluirBoot();
  };
  if (document.body) arrancar();
  else document.addEventListener('DOMContentLoaded', arrancar, { once: true });

  // A rota corrente fica guardada aqui porque `popstate` não diz de onde veio.
  let rotaAtual = location.pathname + location.search;
  const aoNavegar = (): void => {
    const de = rotaAtual;
    const para = location.pathname + location.search;
    rotaAtual = para;
    if (de !== para) iniciar(de, para);
  };
  for (const metodo of ['pushState', 'replaceState'] as const) {
    const original = history[metodo].bind(history);
    history[metodo] = (...args: Parameters<History['pushState']>): void => {
      original(...args);
      try {
        aoNavegar();
      } catch {
        /* a sonda nunca atrapalha a navegação */
      }
    };
  }
  window.addEventListener('popstate', () => {
    try {
      aoNavegar();
    } catch {
      /* idem */
    }
  });

  (window as unknown as { radinhoTrocas: () => DadosDeTrocas }).radinhoTrocas = dadosDeTrocas;
}
