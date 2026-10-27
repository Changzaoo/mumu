/**
 * O DISJUNTOR DO IMPORTADOR — um interruptor só, sem dono.
 *
 * Quando o importador não responde, cada módulo que fala com ele descobria
 * isso por conta própria, errando de novo: a letra pedia outras fontes, a IA
 * tentava classificar, o player aquecia a próxima faixa, a telemetria media a
 * velocidade. No diário do Diego (27/10/2026) foram 40 chamadas falhadas em
 * 70 s, e a rajada é parte da doença: a Cloudflare lê isso como abuso e passa
 * a bloquear o celular inteiro, inclusive o áudio.
 *
 * Aqui mora a decisão "agora não": o MÉDICO (`telemetry/medico.ts`) abre o
 * circuito quando reconhece a queda e fecha quando a sonda em `/health`
 * responde; as chamadas SECUNDÁRIAS (IA, aquecer, outras fontes de letra,
 * velocidade) perguntam antes de sair. O que é essencial para tocar (stream,
 * cofre, fila de import, que já tem o próprio disjuntor) não passa por aqui:
 * música não espera o médico.
 *
 * Sem dependências de propósito: qualquer módulo importa sem criar ciclo.
 */

/** Válvula de segurança: se o médico morrer com o circuito aberto, ele fecha sozinho. */
export const ABERTURA_MAXIMA_MS = 15 * 60_000;

let abertoAte = 0;
let ouvintes: Array<(aberto: boolean) => void> = [];

/** O importador está dado como fora do ar neste instante? */
export function circuitoAberto(): boolean {
  return abertoAte > 0 && Date.now() < abertoAte;
}

/** Até quando (epoch ms) o circuito fica aberto; 0 quando fechado. */
export function abertoAteMs(): number {
  return circuitoAberto() ? abertoAte : 0;
}

export function abrirCircuito(porMs: number = ABERTURA_MAXIMA_MS): void {
  const estavaAberto = circuitoAberto();
  abertoAte = Date.now() + Math.max(1_000, Math.min(porMs, ABERTURA_MAXIMA_MS));
  if (!estavaAberto) avisar(true);
}

export function fecharCircuito(): void {
  const estavaAberto = circuitoAberto();
  abertoAte = 0;
  if (estavaAberto) avisar(false);
}

/** Avisa quando abre ou fecha. Devolve o cancelamento. */
export function ouvirSaudeDoImportador(ouvinte: (aberto: boolean) => void): () => void {
  ouvintes.push(ouvinte);
  return () => {
    ouvintes = ouvintes.filter((o) => o !== ouvinte);
  };
}

function avisar(aberto: boolean): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte(aberto);
    } catch {
      /* um ouvinte quebrado não derruba o disjuntor */
    }
  }
}

/** Só para teste. */
export function zerarSaudeDoImportador(): void {
  abertoAte = 0;
  ouvintes = [];
}
