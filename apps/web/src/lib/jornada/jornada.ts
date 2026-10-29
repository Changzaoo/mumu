/**
 * A JORNADA — a sequência de dias (o "foguinho"), o XP, o nível e as
 * conquistas de quem ouve. Pedido do dono (29/10/2026), a partir do reel
 * sobre o Duolingo (instagram.com/p/DemaGxdCtFh): o número que mais mexe no
 * total de gente por dia é a chance de QUEM JÁ OUVE voltar amanhã. Tudo aqui
 * existe para isso:
 *
 *  - META DO DIA: um dia conta quando a pessoa ouve `metaMin` minutos (15 por
 *    padrão). É o "estudou hoje" do Duolingo.
 *  - SEQUÊNCIA: dias seguidos com a meta batida. Hoje ainda não batido não
 *    quebra nada — a chama só apaga quando um dia INTEIRO passa sem música.
 *  - PROTETOR: a cada 7 dias seguidos ganha-se um (máximo 2). Um dia perdido
 *    gasta um protetor sozinho, e a sequência continua.
 *  - XP: 1 por minuto ouvido, +20 ao bater a meta, + o XP de cada conquista.
 *    A soma da semana é o que conta na LIGA (servidor, ver `servidor.ts`).
 *
 * Mora no aparelho (funciona sem conta e sem rede) e é contada pelo próprio
 * player: um relógio de 10 s soma o tempo enquanto `isPlaying` é verdade.
 */
import { trackArtistNames } from '@/lib/utils';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { usePlayerStore } from '@/stores/playerStore';
import { CONQUISTAS, type Conquista } from './conquistas';
import { chaveDoDia, diasEntre, semanaIso, somarDias } from './datas';

export interface EstadoJornada {
  v: 1;
  /** Segundos ouvidos por dia (`YYYY-MM-DD`). */
  dias: Record<string, number>;
  metaMin: number;
  protetores: number;
  /** Dias salvos por protetor. */
  protegidos: string[];
  sequencia: number;
  recorde: number;
  xp: number;
  /** Segundos que ainda não viraram 1 XP. */
  sobra: number;
  semana: string;
  xpSemana: number;
  /** Conquista → quando foi ganha (ms). */
  conquistas: Record<string, number>;
  faixas: number;
  artistas: string[];
  generos: string[];
  madrugada: boolean;
  cedo: boolean;
  voltas: number;
  /** Último dia em que o app foi aberto (para "O retorno" e o aviso de volta). */
  ultimoDia: string | null;
  /** Até que dia as faltas já foram acertadas (protetor ou chama apagada). */
  acertadoAte: string | null;
  /** Do servidor (só com conta): amigos indicados e liga. */
  amigos: number;
  liga: number;
  /** A sequência que apagou, para o aviso da volta (some depois de dito). */
  apagou: number;
}

export const META_PADRAO_MIN = 15;
const MAX_PROTETORES = 2;
const XP_DA_META = 20;
const CHAVE = 'radinho:jornada';
/** Uma faixa conta como ouvida depois de 30 s. */
const FAIXA_CONTA_S = 30;
/** Teto de um passo do relógio: aba congelada não vira horas de música. */
const PASSO_MAXIMO_S = 75;
const LIMITE_DA_LISTA = 600;

function novo(): EstadoJornada {
  return {
    v: 1,
    dias: {},
    metaMin: META_PADRAO_MIN,
    protetores: 0,
    protegidos: [],
    sequencia: 0,
    recorde: 0,
    xp: 0,
    sobra: 0,
    semana: semanaIso(),
    xpSemana: 0,
    conquistas: {},
    faixas: 0,
    artistas: [],
    generos: [],
    madrugada: false,
    cedo: false,
    voltas: 0,
    ultimoDia: null,
    acertadoAte: null,
    amigos: 0,
    liga: 0,
    apagou: 0,
  };
}

function ler(): EstadoJornada {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (bruto) return { ...novo(), ...(JSON.parse(bruto) as Partial<EstadoJornada>) };
  } catch {
    /* sem armazenamento: começa do zero, como uma pessoa nova */
  }
  return novo();
}

let estado: EstadoJornada = typeof window === 'undefined' ? novo() : ler();
const ouvintes = new Set<() => void>();

function gravar(): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(estado));
  } catch {
    /* cota cheia: segue na memória */
  }
}

function mudar(proximo: EstadoJornada): void {
  estado = proximo;
  gravar();
  for (const o of ouvintes) o();
}

export function subscribe(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
export const snapshot = (): EstadoJornada => estado;

// ── regras puras (testadas em __tests__/jornada.test.ts) ─────────────────────

export function diaFeito(e: EstadoJornada, dia: string): boolean {
  return (e.dias[dia] ?? 0) >= e.metaMin * 60 || e.protegidos.includes(dia);
}

/** A sequência vista de `hoje`: hoje feito conta; hoje pendente não quebra. */
export function calcularSequencia(e: EstadoJornada, hoje: string): number {
  let dia = diaFeito(e, hoje) ? hoje : somarDias(hoje, -1);
  let n = 0;
  while (diaFeito(e, dia)) {
    n++;
    dia = somarDias(dia, -1);
  }
  return n;
}

export type Acerto =
  { tipo: 'nada' } | { tipo: 'protegeu'; dias: number } | { tipo: 'apagou'; tinha: number };

/**
 * Acerta as faltas entre o último dia feito e ontem: protetor cobre se der
 * para cobrir TODAS; senão a chama apaga. Roda uma vez por dia.
 */
export function acertarFaltas(e: EstadoJornada, hoje: string): [EstadoJornada, Acerto] {
  const ontem = somarDias(hoje, -1);
  if (e.acertadoAte && e.acertadoAte >= ontem) return [e, { tipo: 'nada' }];
  const marcado = { ...e, acertadoAte: ontem };
  // O último dia feito antes de hoje.
  let ultimo: string | null = null;
  for (let d = ontem, i = 0; i < 400; i++, d = somarDias(d, -1)) {
    if (diaFeito(e, d)) {
      ultimo = d;
      break;
    }
  }
  if (!ultimo || ultimo === ontem) return [marcado, { tipo: 'nada' }];
  const faltas = diasEntre(ultimo, hoje) - 1;
  const tinha = calcularSequencia(e, somarDias(ultimo, 1));
  if (tinha === 0) return [marcado, { tipo: 'nada' }];
  if (faltas <= e.protetores) {
    const cobertos = Array.from({ length: faltas }, (_, i) => somarDias(ultimo, i + 1));
    return [
      { ...marcado, protetores: e.protetores - faltas, protegidos: [...e.protegidos, ...cobertos] },
      { tipo: 'protegeu', dias: faltas },
    ];
  }
  return [
    { ...marcado, apagou: tinha },
    { tipo: 'apagou', tinha },
  ];
}

/** Nível pelo XP total: cada nível pede um pouco mais que o anterior. */
export function nivelDoXp(xp: number): { nivel: number; base: number; proximo: number } {
  const nivel = Math.floor(Math.sqrt(xp / 60)) + 1;
  return { nivel, base: 60 * (nivel - 1) ** 2, proximo: 60 * nivel ** 2 };
}

const TITULOS = [
  'Ouvinte',
  'Frequente',
  'Fiel',
  'DJ de quarto',
  'Curador',
  'Discotecário',
  'Maestro',
  'Lenda do radinho',
];
export function tituloDoNivel(nivel: number): string {
  return TITULOS[Math.min(TITULOS.length - 1, Math.floor((nivel - 1) / 3))]!;
}

// ── conquistas ──────────────────────────────────────────────────────────────

const fila: Conquista[] = [];
const ouvintesDaFila = new Set<() => void>();
export function subscribeFila(o: () => void): () => void {
  ouvintesDaFila.add(o);
  return () => ouvintesDaFila.delete(o);
}
/** A próxima conquista a saltar no player (ou null). */
export function proximaDaFila(): Conquista | null {
  return fila[0] ?? null;
}
export function tirarDaFila(): void {
  fila.shift();
  for (const o of ouvintesDaFila) o();
}

export function contexto(e: EstadoJornada = estado) {
  let curtidas = 0;
  let playlists = 0;
  try {
    curtidas = localLikes.count();
    playlists = localPlaylists.list().length;
  } catch {
    /* sem biblioteca local */
  }
  return { estado: e, curtidas, playlists };
}

/** Ganha o que já foi alcançado; cada nova vai para a fila do player. */
function conferirConquistas(e: EstadoJornada): EstadoJornada {
  const ctx = contexto(e);
  let proximo = e;
  for (const q of CONQUISTAS) {
    if (proximo.conquistas[q.id]) continue;
    const [tem, alvo] = q.progresso(ctx);
    if (tem < alvo) continue;
    proximo = {
      ...proximo,
      conquistas: { ...proximo.conquistas, [q.id]: Date.now() },
      xp: proximo.xp + q.xp,
      xpSemana: proximo.xpSemana + q.xp,
    };
    fila.push(q);
  }
  if (proximo !== e) for (const o of ouvintesDaFila) o();
  return proximo;
}

// ── eventos ─────────────────────────────────────────────────────────────────

type Evento =
  | { tipo: 'meta'; sequencia: number }
  | { tipo: 'protetor-ganho' }
  | Exclude<Acerto, { tipo: 'nada' }>;
const ouvintesDeEvento = new Set<(e: Evento) => void>();
export function aoAcontecer(o: (e: Evento) => void): () => void {
  ouvintesDeEvento.add(o);
  return () => ouvintesDeEvento.delete(o);
}
const emitir = (ev: Evento): void => ouvintesDeEvento.forEach((o) => o(ev));

/** Vira a semana da liga quando ela muda. */
function semanaEmDia(e: EstadoJornada): EstadoJornada {
  const s = semanaIso();
  return e.semana === s ? e : { ...e, semana: s, xpSemana: 0 };
}

/** A abertura do app: acerta faltas, conta a volta e devolve o que dizer. */
export function abrirODia(): Acerto & { primeiraVez: boolean; diasFora: number } {
  const hoje = chaveDoDia();
  const primeiraVez = estado.ultimoDia === null;
  const diasFora = estado.ultimoDia ? diasEntre(estado.ultimoDia, hoje) : 0;
  const [acertado, acerto] = acertarFaltas(semanaEmDia(estado), hoje);
  let e = acertado;
  if (diasFora >= 7) e = { ...e, voltas: e.voltas + 1 };
  e = { ...e, ultimoDia: hoje };
  const sequencia = calcularSequencia(e, hoje);
  e = { ...e, sequencia, recorde: Math.max(e.recorde, sequencia) };
  e = conferirConquistas(e);
  mudar(e);
  if (acerto.tipo !== 'nada') emitir(acerto);
  return { ...acerto, primeiraVez, diasFora };
}

/** Soma `segundos` de música ouvida agora. */
export function somarEscuta(segundos: number, agora = new Date()): void {
  if (segundos <= 0) return;
  const hoje = chaveDoDia(agora);
  let e = semanaEmDia(estado);
  const antes = e.dias[hoje] ?? 0;
  const depois = antes + segundos;
  const meta = e.metaMin * 60;
  const total = e.sobra + segundos;
  const ganho = Math.floor(total / 60);
  e = {
    ...e,
    dias: { ...e.dias, [hoje]: depois },
    sobra: total - ganho * 60,
    xp: e.xp + ganho,
    xpSemana: e.xpSemana + ganho,
  };
  const hora = agora.getHours();
  if (hora < 5) e.madrugada = true;
  else if (hora < 7) e.cedo = true;
  if (antes < meta && depois >= meta) {
    e = { ...e, xp: e.xp + XP_DA_META, xpSemana: e.xpSemana + XP_DA_META };
    e.sequencia = calcularSequencia(e, hoje);
    e.recorde = Math.max(e.recorde, e.sequencia);
    if (e.sequencia > 0 && e.sequencia % 7 === 0 && e.protetores < MAX_PROTETORES) {
      e.protetores += 1;
      emitir({ tipo: 'protetor-ganho' });
    }
    emitir({ tipo: 'meta', sequencia: e.sequencia });
  }
  mudar(conferirConquistas(e));
}

/** Uma faixa passou de 30 s: conta a faixa, o artista e o gênero. */
function contarFaixa(artistas: string[], genero: string | null | undefined): void {
  const juntar = (lista: string[], novos: string[]): string[] => {
    const s = new Set(lista);
    for (const n of novos) if (n) s.add(n.toLowerCase());
    return [...s].slice(-LIMITE_DA_LISTA);
  };
  mudar(
    conferirConquistas({
      ...estado,
      faixas: estado.faixas + 1,
      artistas: juntar(estado.artistas, artistas),
      generos: juntar(estado.generos, genero ? [genero] : []),
    }),
  );
}

export function definirMeta(min: number): void {
  const metaMin = Math.max(5, Math.min(120, Math.round(min)));
  const e = { ...estado, metaMin };
  mudar({ ...e, sequencia: calcularSequencia(e, chaveDoDia()) });
}

/** O que veio do servidor (amigos indicados, liga). */
export function aplicarDoServidor(dados: { amigos?: number; liga?: number }): void {
  const e = { ...estado };
  if (typeof dados.amigos === 'number') e.amigos = dados.amigos;
  if (typeof dados.liga === 'number') e.liga = dados.liga;
  mudar(conferirConquistas(e));
}

export function esquecerApagada(): void {
  if (estado.apagou) mudar({ ...estado, apagou: 0 });
}

/** Re-confere (curtidas e playlists mudam fora daqui). */
export function reconferir(): void {
  const e = conferirConquistas(estado);
  if (e !== estado) mudar(e);
}

// ── o relógio ───────────────────────────────────────────────────────────────

let iniciado = false;

export function initJornada(): () => void {
  if (iniciado || typeof window === 'undefined') return () => undefined;
  iniciado = true;
  abrirODia();
  let ultimo = Date.now();
  let faixaId: string | null = null;
  let naFaixa = 0;
  let faixaContada = false;
  const passo = (): void => {
    const agora = Date.now();
    const segundos = Math.min(PASSO_MAXIMO_S, Math.max(0, (agora - ultimo) / 1000));
    ultimo = agora;
    const { isPlaying, currentTrack } = usePlayerStore.getState();
    if (!isPlaying || !currentTrack) return;
    // Virou o dia com o app aberto: acerta como numa abertura.
    if (estado.ultimoDia !== chaveDoDia()) abrirODia();
    somarEscuta(segundos);
    if (currentTrack.id !== faixaId) {
      faixaId = currentTrack.id;
      naFaixa = 0;
      faixaContada = false;
    }
    naFaixa += segundos;
    if (!faixaContada && naFaixa >= FAIXA_CONTA_S) {
      faixaContada = true;
      const nomes = trackArtistNames(currentTrack)
        .split(/,|&| e | feat\.? /i)
        .map((n) => n.trim());
      contarFaixa(nomes, currentTrack.genre);
    }
  };
  const relogio = window.setInterval(passo, 10_000);
  // Ao dar play, o relógio recomeça a contar dali (pausa não vira música).
  const parar = usePlayerStore.subscribe((s, a) => {
    if (s.isPlaying !== a.isPlaying) {
      if (s.isPlaying) ultimo = Date.now();
      else passo();
    }
  });
  const pararCurtidas = localLikes.subscribe(reconferir);
  const pararPlaylists = localPlaylists.subscribe(reconferir);
  return () => {
    window.clearInterval(relogio);
    parar();
    pararCurtidas();
    pararPlaylists();
    iniciado = false;
  };
}

/** Só para os testes. */
export function __reiniciar(e: Partial<EstadoJornada> = {}): void {
  fila.length = 0;
  estado = { ...novo(), ...e };
}
