/**
 * O DIÁRIO DE BORDO — tudo o que acontece dentro do app, em ordem, com hora.
 *
 * A telemetria dizia QUANTO (segundos de uso, cliques, erros contados) e o
 * `aoVivo` dizia O QUE sobrou (memória, travamentos, as últimas latências de
 * play). Nenhum dos dois dizia a SEQUÊNCIA: "a faixa trocou, o motor carregou,
 * o play foi recusado, a pessoa tocou, saiu som 9 s depois". É essa sequência
 * que aponta onde quebrou — um "tempo passa e não toca" relatado pelo usuário
 * só vira conserto quando dá para ler, linha a linha, o que o aparelho dele
 * fez antes e depois.
 *
 * Este módulo é o CADERNO: `anotar(canal, evento, detalhe)` escreve uma linha
 * curta; quem decide o que anotar são as SONDAS (`diarioSondas.ts`), que
 * ouvem a store do player, o motor de áudio, a saída de som, os downloads, a
 * rede e os erros globais. O caderno não conhece nenhum deles — é por isso que
 * qualquer módulo pode importá-lo sem criar ciclo.
 *
 * Como vive:
 *  • em memória, as últimas `MAX_MEMORIA` linhas (ler no console: `radinhoDiario()`);
 *  • no aparelho (`localStorage`), as últimas `MAX_DISCO` — a aba pode morrer
 *    em segundo plano e a memória ir junto; o diário da sessão anterior
 *    continua lá para o próximo flush;
 *  • na telemetria, as últimas `MAX_ENVIO` + um resumo dos SINTOMAS (erros,
 *    silêncio, travamento, play recusado), para o painel mostrar sem ler tudo.
 *
 * Linhas iguais seguidas (o mesmo 'waiting' dez vezes) viram UMA com contador:
 * um laço que repete não pode empurrar para fora as linhas que importam.
 * Diagnóstico nunca atrapalha o uso: toda escrita é best-effort.
 */
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';

/** De onde a linha veio. Curto: vai em cada linha do documento. */
export type Canal =
  /** Ciclo de vida da página: boot, rota, aba oculta/visível, rede on/off. */
  | 'app'
  /** A store do player: faixa, play/pausa, fila, fase de carga, convite. */
  | 'player'
  /** O motor de áudio: carregou, acabou, erro, buffering, interrupção. */
  | 'motor'
  /** A saída de som de verdade: silêncio com o tempo andando, contexto. */
  | 'audio'
  /** Downloads para ouvir offline. */
  | 'download'
  /** Chamadas de rede que falharam ou demoraram. */
  | 'rede'
  /** Erros de JavaScript e promessas rejeitadas sem dono. */
  | 'erro';

export interface Linha {
  /** Hora local HH:MM:SS. */
  em: string;
  /** Milissegundos desde o boot da página: ordena e mede intervalos. */
  ms: number;
  c: Canal;
  /** Nome curto do evento ('faixa', 'play', 'erro', 'silencio'…). */
  e: string;
  /** Detalhe curto, legível (título da faixa, mensagem, estado). */
  d?: string;
  /** A página estava oculta quando aconteceu? Só vai quando `true`. */
  oculta?: true;
  /** Quantas vezes seguidas a mesma linha se repetiu (ausente = 1). */
  n?: number;
}

/** Eventos que são SINTOMA: o painel os destaca e o resumo os conta. */
export const SINTOMAS: ReadonlySet<string> = new Set([
  'erro',
  'rejeicao',
  'silencio',
  'travou',
  'recusado',
  'interrompido',
  'falhou',
  'mudo',
  'morte',
]);

export interface ResumoDoDiario {
  /** Quantas linhas-sintoma há no diário (não só nas enviadas). */
  sintomas: number;
  /** Contagem por evento-sintoma ('erro': 3, 'silencio': 1…). */
  porSintoma: Record<string, number>;
  /** O último sintoma, para o painel dizer de cara. */
  ultimoSintoma?: { em: string; e: string; d?: string };
  /** Quanto tempo a página está aberta (s). */
  abertaHaS: number;
}

const CHAVE = 'aurial:diario';
const MAX_MEMORIA = 400;
const MAX_DISCO = 150;
const MAX_ENVIO = 70;
const MAX_DETALHE = 90;
/** Teto do que vai para o `localStorage` (o cofre recusa acima disto). */
const TETO_DISCO_BYTES = 40_000;

let linhas: Linha[] = carregar();
let ouvintes: Array<(linha: Linha) => void> = [];
let gravacao: ReturnType<typeof setTimeout> | null = null;
/** `performance.now()` de quando este módulo nasceu — "desde o boot". */
const inicio = typeof performance !== 'undefined' ? performance.now() : 0;

function carregar(): Linha[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const bruto = localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    if (!Array.isArray(lido)) return [];
    // As linhas de antes marcam de onde vieram: a sessão anterior.
    const anteriores = (lido as Linha[]).slice(-MAX_DISCO);
    if (anteriores.length > 0) {
      anteriores.push({
        em: hora(),
        ms: 0,
        c: 'app',
        e: 'boot',
        d: 'nova sessão (acima: a anterior)',
      });
    }
    return anteriores;
  } catch {
    return [];
  }
}

if (typeof window !== 'undefined') {
  // Prioridade baixa de descarte: é diagnóstico; a biblioteca vem antes.
  registrarDescartavel(CHAVE, 12, () => {
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      /* nada */
    }
  });
}

function hora(): string {
  return new Date().toTimeString().slice(0, 8);
}

function agoraMs(): number {
  return typeof performance !== 'undefined' ? Math.round(performance.now() - inicio) : 0;
}

function gravar(): void {
  if (gravacao !== null) return;
  // Agrupa as escritas: uma rajada de linhas vira uma gravação só.
  gravacao = setTimeout(() => {
    gravacao = null;
    try {
      gravarCache(CHAVE, JSON.stringify(linhas.slice(-MAX_DISCO)), TETO_DISCO_BYTES);
    } catch {
      /* diagnóstico nunca atrapalha o uso */
    }
  }, 500);
}

/** Encurta e achata qualquer detalhe numa linha só, legível. */
export function resumir(detalhe: unknown): string | undefined {
  if (detalhe === undefined || detalhe === null || detalhe === '') return undefined;
  let texto: string;
  if (typeof detalhe === 'string') texto = detalhe;
  else if (detalhe instanceof Error) texto = detalhe.message || detalhe.name;
  else if (typeof detalhe === 'object') {
    texto = Object.entries(detalhe as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' ');
  } else texto = String(detalhe);
  texto = texto.replace(/\s+/g, ' ').trim();
  if (!texto) return undefined;
  return texto.length > MAX_DETALHE ? `${texto.slice(0, MAX_DETALHE - 1)}…` : texto;
}

/**
 * Escreve uma linha. `detalhe` pode ser texto, erro ou objeto raso — vira
 * texto curto. Linha igual à anterior (mesmo canal, evento e detalhe) só
 * incrementa o contador dela.
 */
export function anotar(canal: Canal, evento: string, detalhe?: unknown): void {
  const d = resumir(detalhe);
  const ultima = linhas[linhas.length - 1];
  if (ultima && ultima.c === canal && ultima.e === evento && ultima.d === d) {
    ultima.n = (ultima.n ?? 1) + 1;
    ultima.em = hora();
    ultima.ms = agoraMs();
    gravar();
    return;
  }
  const linha: Linha = { em: hora(), ms: agoraMs(), c: canal, e: evento };
  if (d !== undefined) linha.d = d;
  if (typeof document !== 'undefined' && document.hidden) linha.oculta = true;
  linhas.push(linha);
  if (linhas.length > MAX_MEMORIA) linhas = linhas.slice(-MAX_MEMORIA);
  gravar();
  for (const ouvinte of ouvintes) {
    try {
      ouvinte(linha);
    } catch {
      /* um ouvinte quebrado não derruba o diário */
    }
  }
}

/** As últimas `limite` linhas, da mais antiga para a mais nova. */
export function lerDiario(limite = MAX_MEMORIA): Linha[] {
  return linhas.slice(-limite);
}

/** Avisa a cada linha nova (painel ao vivo, console). Devolve o cancelamento. */
export function ouvirDiario(ouvinte: (linha: Linha) => void): () => void {
  ouvintes.push(ouvinte);
  return () => {
    ouvintes = ouvintes.filter((o) => o !== ouvinte);
  };
}

export function resumoDoDiario(): ResumoDoDiario {
  const porSintoma: Record<string, number> = {};
  let sintomas = 0;
  let ultimoSintoma: ResumoDoDiario['ultimoSintoma'];
  for (const l of linhas) {
    if (!SINTOMAS.has(l.e)) continue;
    const vezes = l.n ?? 1;
    sintomas += vezes;
    porSintoma[l.e] = (porSintoma[l.e] ?? 0) + vezes;
    ultimoSintoma = { em: l.em, e: l.e, ...(l.d ? { d: l.d } : {}) };
  }
  return {
    sintomas,
    porSintoma,
    ...(ultimoSintoma ? { ultimoSintoma } : {}),
    abertaHaS: Math.round(agoraMs() / 1000),
  };
}

/** O que vai na telemetria: as últimas linhas e o resumo dos sintomas. */
export function coletarDiario(): { linhas: Linha[]; resumo: ResumoDoDiario } {
  return { linhas: linhas.slice(-MAX_ENVIO), resumo: resumoDoDiario() };
}

/** Só para teste. */
export function zerarDiario(): void {
  linhas = [];
  ouvintes = [];
  if (gravacao !== null) clearTimeout(gravacao);
  gravacao = null;
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* ignora */
  }
}

/**
 * `radinhoDiario()` no console: a sequência inteira, legível, com os sintomas
 * marcados. `radinhoDiario('player')` filtra por canal.
 */
export function instalarConsoleDoDiario(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { radinhoDiario: (canal?: Canal) => Linha[] }).radinhoDiario = (
    canal?: Canal,
  ): Linha[] => {
    const lista = linhas.filter((l) => !canal || l.c === canal);
    // eslint-disable-next-line no-console
    console.table(
      lista.map((l) => ({
        hora: l.em,
        canal: l.c,
        evento: SINTOMAS.has(l.e) ? `⚠ ${l.e}` : l.e,
        detalhe: l.d ?? '',
        vezes: l.n ?? 1,
        oculta: l.oculta ? 'sim' : '',
      })),
    );
    return lista;
  };
}
