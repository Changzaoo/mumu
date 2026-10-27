/**
 * O MÉDICO — lê o diário de bordo, reconhece a doença, trata e dá alta.
 *
 * O diário (`diario.ts`) já dizia O QUE aconteceu: "falhou GET
 * importer.radinho.online/letra/outras-fontes" quarenta vezes, "http 429 GET
 * lrclib.net/api/search" trinta. Mas cada linha ficava vermelha para sempre e
 * ninguém fazia nada com ela — o app seguia batendo na porta fechada, e a
 * rajada piorava a doença (a Cloudflare bloqueia o celular que insiste).
 *
 * Este módulo é quem faz algo. Ele ouve o diário e trata DUAS doenças:
 *
 *  1. IMPORTADOR FORA — duas ou mais falhas de rede ao importador em 30 s.
 *     Tratamento: abre o disjuntor (`saudeDoImportador.ts`), e as chamadas
 *     secundárias param de sair; sonda `/health` com intervalo crescente
 *     (5 s → 60 s), só com a tela ligada. A sonda distingue "sem alcance"
 *     (rede do aparelho, túnel) de "alcança mas é bloqueado" (desafio ou
 *     limite da Cloudflare) — é o que diz onde consertar. Quando `/health`
 *     responde, fecha o disjuntor, avisa quem quiser tentar de novo e DÁ ALTA.
 *
 *  2. LRCLIB LOTADO — o portão (`portaoDoLrclib.ts`) avisa quando entrou em
 *     pausa por 429/5xx e quando a primeira resposta boa voltou. O médico só
 *     registra o tratamento e dá a alta: o tratamento em si mora no portão.
 *
 * DAR ALTA é marcar no próprio diário (`curar`) as linhas daquela doença como
 * `ok`: o painel as mostra em VERDE, e elas saem da contagem de sintomas em
 * aberto. A linha não é apagada — o que aconteceu, aconteceu; o que muda é
 * que agora se sabe que passou e quanto durou.
 *
 * O médico nunca atrapalha o uso: tudo é best-effort, e nenhum erro dele
 * sobe para quem está ouvindo música.
 */
import { anotar, curar, ouvirDiario, relogioDoDiario, type Linha } from './diario';
import { helperUrl } from '@/lib/local/importerHelper';
import { abrirCircuito, fecharCircuito } from '@/lib/local/saudeDoImportador';
import { ouvirLrclib, type EventoDoLrclib } from '@/lib/lyrics/portaoDoLrclib';

/** Duas falhas nesta janela é doença, não soluço. */
export const JANELA_DE_FALHAS_MS = 30_000;
export const FALHAS_PARA_TRATAR = 2;
/** Intervalos entre sondas em `/health`; o último repete até a alta. */
export const SONDAS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 60_000];
/** Depois disto o médico registra que não conseguiu, mas continua sondando. */
export const DESISTE_APOS_MS = 10 * 60_000;
const PRAZO_DA_SONDA_MS = 8_000;
/** Falhas um pouco ANTES do diagnóstico também são da mesma doença. */
const MARGEM_DE_CURA_MS = 60_000;
/** Evento na `window` quando uma doença passa: quem quiser tenta de novo. */
export const EVENTO_DE_ALTA = 'radinho:medico-curou';

export type Diagnostico = 'ok' | 'bloqueado' | 'sem-alcance' | `http ${number}`;

interface Caso {
  /** Relógio do diário (ms desde o boot) na primeira falha do episódio. */
  inicioMs: number;
  /** O host que adoeceu: a alta cura as queixas contra ELE, mesmo que o
   *  endereço configurado mude no meio do tratamento. */
  host: string;
  abertoEm: number;
  falhas: number;
  sondas: number;
  timer: ReturnType<typeof setTimeout> | null;
  sondando: boolean;
  desistiu: boolean;
}

let instalado = false;
let cancelar: Array<() => void> = [];
let falhasRecentes: number[] = [];
let caso: Caso | null = null;
let casoLrclib: { inicioMs: number } | null = null;

// ── Reconhecer ────────────────────────────────────────────────────────

function hostDoImportador(): string {
  try {
    return new URL(helperUrl()).host;
  } catch {
    return 'importer.radinho.online';
  }
}

function mencionaHost(d: string | undefined, host: string): boolean {
  if (!d) return false;
  const escapado = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escapado}(/|\\s|$)`).test(d);
}

/** Linha do diário que é queixa contra o importador: rede caída ou borda 5xx. */
export function ehQueixaDoImportador(l: Linha, host: string = hostDoImportador()): boolean {
  if (l.c !== 'rede') return false;
  if (l.e === 'falhou') return mencionaHost(l.d, host);
  if (l.e === 'http') return /^50[234] /.test(l.d ?? '') && mencionaHost(l.d, host);
  return false;
}

/** Linha do diário que é queixa contra o LRCLIB: lotado ou fora. */
export function ehQueixaDoLrclib(l: Linha): boolean {
  if (l.c !== 'rede') return false;
  if (l.e === 'http') return /^(429|50[234]) [A-Z]+ lrclib\.net(\/|\s|$)/.test(l.d ?? '');
  if (l.e === 'falhou') return / lrclib\.net(\/|\s|$)/.test(l.d ?? '');
  return false;
}

// ── Sondar ────────────────────────────────────────────────────────────

async function comPrazo<T>(executar: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), PRAZO_DA_SONDA_MS);
  try {
    return await executar(controle.signal);
  } finally {
    clearTimeout(prazo);
  }
}

/**
 * Bate em `/health`. Quando o pedido normal falha, tenta sem CORS: uma
 * resposta opaca prova que a borda respondeu algo (bloqueio), e uma falha
 * também aí prova que nem a borda foi alcançada (rede, túnel).
 */
export async function sondarImportador(): Promise<Diagnostico> {
  const url = `${helperUrl()}/health`;
  try {
    const r = await comPrazo((signal) => fetch(url, { cache: 'no-store', signal }));
    return r.ok ? 'ok' : `http ${r.status}`;
  } catch {
    try {
      await comPrazo((signal) => fetch(url, { mode: 'no-cors', cache: 'no-store', signal }));
      return 'bloqueado';
    } catch {
      return 'sem-alcance';
    }
  }
}

function descrever(diag: Diagnostico): string {
  if (diag === 'bloqueado')
    return 'alcança a borda, mas a resposta é bloqueada (desafio ou limite da Cloudflare)';
  if (diag === 'sem-alcance') return 'sem alcance (rede do aparelho ou túnel fora)';
  if (diag === 'ok') return 'responde';
  return `responde ${diag.slice(5)} no /health`;
}

// ── Tratar o importador ───────────────────────────────────────────────

function telaLigada(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}

function agendarSonda(ms: number): void {
  if (!caso) return;
  if (caso.timer !== null) clearTimeout(caso.timer);
  caso.timer = null;
  // Tela apagada: nada de relógio. A volta à tela retoma de onde parou.
  if (!telaLigada()) return;
  caso.timer = setTimeout(() => {
    if (caso) caso.timer = null;
    void sondar();
  }, ms);
}

async function sondar(): Promise<void> {
  if (!caso || caso.sondando) return;
  caso.sondando = true;
  const diag = await sondarImportador();
  if (!caso) return;
  caso.sondando = false;
  caso.sondas += 1;
  if (diag === 'ok') {
    darAltaAoImportador();
    return;
  }
  // Segue fora: re-arma o disjuntor (a válvula de 15 min é só para o caso de o
  // médico morrer; enquanto ele sonda, quem manda é a sonda).
  abrirCircuito();
  anotar('medico', 'sondando', `importador ${descrever(diag)}`);
  if (!caso.desistiu && Date.now() - caso.abertoEm >= DESISTE_APOS_MS) {
    caso.desistiu = true;
    const min = Math.round((Date.now() - caso.abertoEm) / 60_000);
    anotar('medico', 'desistiu', `importador fora há ${min} min (${descrever(diag)}); sigo sondando a cada 60 s`);
  }
  agendarSonda(SONDAS_MS[Math.min(caso.sondas, SONDAS_MS.length - 1)] ?? 60_000);
}

function abrirCaso(inicioMs: number, falhas: number): void {
  caso = {
    inicioMs,
    host: hostDoImportador(),
    abertoEm: Date.now(),
    falhas,
    sondas: 0,
    timer: null,
    sondando: false,
    desistiu: false,
  };
  abrirCircuito();
  anotar(
    'medico',
    'tratando',
    `importador não responde (${falhas} falhas em ${JANELA_DE_FALHAS_MS / 1000}s): chamadas secundárias pausadas, sondando /health`,
  );
  agendarSonda(SONDAS_MS[0] ?? 5_000);
}

function darAltaAoImportador(): void {
  if (!caso) return;
  const { inicioMs, host, abertoEm, timer } = caso;
  if (timer !== null) clearTimeout(timer);
  caso = null;
  falhasRecentes = [];
  fecharCircuito();
  const curadas = curar(
    (l) =>
      l.ms >= inicioMs - MARGEM_DE_CURA_MS &&
      (ehQueixaDoImportador(l, host) || (l.c === 'medico' && l.e === 'desistiu')),
  );
  const segundos = Math.max(1, Math.round((Date.now() - abertoEm) / 1000));
  anotar('medico', 'curou', `importador voltou depois de ${segundos}s: ${curadas} falha(s) curada(s)`);
  avisarAlta('importador');
}

function aoAnotar(l: Linha): void {
  if (!ehQueixaDoImportador(l)) return;
  const vezes = l.n ?? 1;
  if (caso) {
    caso.falhas += vezes;
    return;
  }
  for (let i = 0; i < vezes; i++) falhasRecentes.push(l.ms);
  falhasRecentes = falhasRecentes.filter((ms) => ms >= l.ms - JANELA_DE_FALHAS_MS);
  if (falhasRecentes.length >= FALHAS_PARA_TRATAR) {
    abrirCaso(falhasRecentes[0] ?? l.ms, falhasRecentes.length);
  }
}

function aoMudarVisibilidade(): void {
  if (!telaLigada() || !caso || caso.timer !== null || caso.sondando) return;
  agendarSonda(0);
}

// ── Registrar o LRCLIB ────────────────────────────────────────────────

function aoEventoDoLrclib(evento: EventoDoLrclib): void {
  if (evento.tipo === 'lotado') {
    casoLrclib ??= { inicioMs: relogioDoDiario() };
    anotar(
      'medico',
      'tratando',
      `LRCLIB lotado (${evento.status}): buscas de letra pausadas por ${Math.round(evento.esperaMs / 1000)}s e espaçadas depois`,
    );
    return;
  }
  if (!casoLrclib) return;
  const { inicioMs } = casoLrclib;
  casoLrclib = null;
  const curadas = curar((l) => l.ms >= inicioMs - MARGEM_DE_CURA_MS && ehQueixaDoLrclib(l));
  anotar('medico', 'curou', `LRCLIB respondeu de novo: ${curadas} pedido(s) curado(s)`);
  avisarAlta('lrclib');
}

function avisarAlta(doenca: 'importador' | 'lrclib'): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_DE_ALTA, { detail: { doenca } }));
  } catch {
    /* nada */
  }
}

// ── Ligar e desligar ──────────────────────────────────────────────────

/** Liga o médico, uma vez. Chamado pela telemetria no boot. */
export function instalarMedico(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  cancelar.push(ouvirDiario(aoAnotar));
  cancelar.push(ouvirLrclib(aoEventoDoLrclib));
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  cancelar.push(() => document.removeEventListener('visibilitychange', aoMudarVisibilidade));
}

/** Só para teste: desliga e esquece tudo. */
export function desinstalarMedico(): void {
  for (const c of cancelar) c();
  cancelar = [];
  if (caso?.timer) clearTimeout(caso.timer);
  caso = null;
  casoLrclib = null;
  falhasRecentes = [];
  instalado = false;
}

/** Só para diagnóstico/teste. */
export function casoAberto(): { falhas: number; sondas: number; desistiu: boolean } | null {
  return caso ? { falhas: caso.falhas, sondas: caso.sondas, desistiu: caso.desistiu } : null;
}
