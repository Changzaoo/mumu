/**
 * QUANDO ESTE APARELHO PODE SERVIR MÚSICA PARA OUTRO.
 *
 * O compartilhamento entre aparelhos é ligado por padrão: quem usa o app não
 * paga nada, e devolver um pouco de banda é a contrapartida. Mas "ligado por
 * padrão" não pode virar "gasta o que quiser" — o custo cai no plano de dados e
 * na bateria de alguém que não pediu para bancar isso.
 *
 * Este módulo é o único lugar que decide. As regras são conservadoras de
 * propósito: no Wi-Fi ele serve à vontade; nos dados móveis serve pouco e para
 * cedo; com bateria baixa ou economia de dados ligada, não serve nada. Errar
 * para o lado de servir de menos custa uma reprodução mais lenta para um
 * estranho; errar para o outro custa a franquia de quem emprestou.
 */
import { getDeviceId } from '@/lib/devices/presence';

/** Teto de envio por dia quando o aparelho está em dados móveis. */
export const TETO_DIARIO_MOVEL_BYTES = 200 * 1024 * 1024; // 200 MB
/** Abaixo disto a bateria é do dono, não da rede. */
export const BATERIA_MINIMA = 0.3;
/** Enquanto carregando, a bateria deixa de ser o limite. */
export const BATERIA_MINIMA_CARREGANDO = 0.15;

const CHAVE_GASTO = 'aurial:p2pGastoMovel';

interface GastoDoDia {
  dia: string;
  bytes: number;
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Quanto este aparelho já enviou hoje em dados móveis. */
export function gastoMovelHoje(): number {
  try {
    const bruto: unknown = JSON.parse(window.localStorage.getItem(CHAVE_GASTO) ?? 'null');
    const g = bruto as GastoDoDia | null;
    return g && g.dia === hoje() ? g.bytes : 0;
  } catch {
    return 0;
  }
}

/** Soma bytes enviados no contador do dia (só chame quando em rede móvel). */
export function registrarEnvioMovel(bytes: number): void {
  try {
    const atual = gastoMovelHoje();
    const g: GastoDoDia = { dia: hoje(), bytes: atual + bytes };
    window.localStorage.setItem(CHAVE_GASTO, JSON.stringify(g));
  } catch {
    /* modo privado — o teto só não persiste entre sessões */
  }
}

interface Conexao {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
}

function conexao(): Conexao | null {
  const nav = navigator as Navigator & { connection?: Conexao };
  return nav.connection ?? null;
}

/**
 * Rede móvel? Devolve `null` quando o navegador não conta.
 *
 * O `type` é o dado bom, mas só o Chrome no Android o entrega. Quando não vem,
 * o `effectiveType` ('2g'/'3g') serve de pista: rede lenta é quase sempre
 * celular, e tratar como móvel na dúvida é o lado seguro do erro.
 */
export function emDadosMoveis(): boolean | null {
  const c = conexao();
  if (!c) return null;
  if (c.type) return c.type === 'cellular';
  if (c.effectiveType === '2g' || c.effectiveType === 'slow-2g' || c.effectiveType === '3g') {
    return true;
  }
  return null;
}

interface Bateria {
  level: number;
  charging: boolean;
}

async function bateria(): Promise<Bateria | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<Bateria> };
  if (!nav.getBattery) return null;
  return nav.getBattery().catch(() => null);
}

export interface Veredito {
  pode: boolean;
  /** Por que não — some no log e na tela de diagnóstico, nunca num toast. */
  motivo?: 'desligado' | 'economia-de-dados' | 'bateria' | 'teto-movel' | 'offline';
  /** Quanto ainda cabe hoje; `Infinity` no Wi-Fi. */
  restanteBytes: number;
}

const CHAVE_LIGADO = 'aurial:p2pLigado';

/** O interruptor das configurações. Ligado até alguém desligar. */
export function ligado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_LIGADO) !== 'false';
  } catch {
    return true;
  }
}

export function definirLigado(valor: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_LIGADO, String(valor));
  } catch {
    /* modo privado */
  }
}

/**
 * A decisão. Chamada antes de aceitar servir uma faixa a outro aparelho.
 *
 * A ORDEM IMPORTA: o desligamento explícito vence tudo, depois a economia de
 * dados (o usuário já disse que a conexão dele é cara), depois a bateria, e só
 * então o teto de tráfego. Assim o motivo relatado é sempre o mais forte, e não
 * o primeiro que a função topou.
 */
export async function podeServir(): Promise<Veredito> {
  if (!ligado()) return { pode: false, motivo: 'desligado', restanteBytes: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pode: false, motivo: 'offline', restanteBytes: 0 };
  }

  // `saveData` é o usuário dizendo ao navegador "minha internet é cara". Servir
  // arquivo de dezenas de MB por cima disso seria ignorar um pedido explícito.
  if (conexao()?.saveData) {
    return { pode: false, motivo: 'economia-de-dados', restanteBytes: 0 };
  }

  const bat = await bateria();
  if (bat) {
    const minimo = bat.charging ? BATERIA_MINIMA_CARREGANDO : BATERIA_MINIMA;
    if (bat.level < minimo) return { pode: false, motivo: 'bateria', restanteBytes: 0 };
  }

  // Wi-Fi (ou rede desconhecida em aparelho de mesa): sem teto de tráfego.
  if (emDadosMoveis() !== true) return { pode: true, restanteBytes: Number.POSITIVE_INFINITY };

  const restante = TETO_DIARIO_MOVEL_BYTES - gastoMovelHoje();
  if (restante <= 0) return { pode: false, motivo: 'teto-movel', restanteBytes: 0 };
  return { pode: true, restanteBytes: restante };
}

/**
 * O identificador que este aparelho anuncia na rede.
 *
 * É o id local do aparelho, que não carrega nome, e-mail nem conta. Quem está do
 * outro lado precisa saber COM QUEM está falando para montar a conexão; não
 * precisa saber QUEM é.
 */
export function apelidoNaRede(): string {
  return `d:${getDeviceId().slice(0, 12)}`;
}
