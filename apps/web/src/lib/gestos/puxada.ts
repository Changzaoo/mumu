/**
 * PUXAR PARA RECARREGAR — as regras do gesto, sem DOM.
 *
 * No toque o documento é fixo (globals.css) e o <main> tem
 * `overscroll-behavior: none`, então o "puxar para atualizar" do navegador não
 * existe no app — e instalado como PWA ele nunca existiu. Este gesto o devolve,
 * mas só quando não há dúvida de que é ele que a pessoa quer:
 *
 *  - COMEÇA NO ALTO: o dedo pousa nos 20% de cima da tela. Puxar para baixo no
 *    meio de uma lista é quase sempre o embalo de voltar para cima, nunca um
 *    pedido de recarga.
 *  - COM A PÁGINA NO TOPO: com qualquer rolagem, puxar para baixo é rolar.
 *  - UM DEDO SÓ: dois dedos é pinça, não puxada.
 *  - PARA BAIXO E NA VERTICAL: o eixo é decidido nos primeiros pixels. Se o
 *    dedo sai de lado, é carrossel (prateleiras da Home) e o gesto desiste de
 *    vez; se sai para cima, é rolagem comum e também desiste.
 *  - SÓ DISPARA ALÉM DO LIMIAR: soltar antes de `LIMIAR_PX` é desistir — dá
 *    para começar a puxar, mudar de ideia e voltar sem consequência.
 *
 * O indicador anda MENOS que o dedo (`RESISTENCIA`), como em todo app nativo:
 * a sensação de elástico é o que avisa que se está puxando algo, não rolando.
 */

/** Distância do INDICADOR (já com resistência) que dispara a recarga. */
export const LIMIAR_PX = 70;
/** O indicador não desce além disto, por mais que o dedo desça. */
export const MAXIMO_PX = 110;
/** Fatia de cima da tela onde o gesto pode começar. */
export const ZONA_DE_INICIO = 0.2;
/** Quanto do movimento do dedo vira movimento do indicador. */
export const RESISTENCIA = 0.5;
/** Pixels de dedo antes de decidir o eixo — abaixo disso é tremida. */
export const TRAVA_DE_EIXO_PX = 8;

export interface InicioDoToque {
  /** Y do dedo na tela (clientY). */
  y: number;
  alturaDaTela: number;
  /** scrollTop do contêiner de rolagem. */
  scrollTop: number;
  /** Quantos dedos na tela. */
  toques: number;
}

/** O toque pode virar uma puxada? (decidido no `touchstart`) */
export function podeComecar({ y, alturaDaTela, scrollTop, toques }: InicioDoToque): boolean {
  if (toques !== 1) return false;
  // Meio pixel de folga: o iOS às vezes deixa o topo em 0.33 depois do quique.
  if (scrollTop > 0.5) return false;
  if (!(alturaDaTela > 0)) return false;
  return y >= 0 && y <= alturaDaTela * ZONA_DE_INICIO;
}

export type DecisaoDeEixo = 'espera' | 'puxar' | 'desistir';

/**
 * Qual gesto é este, pelo deslocamento desde o início. Decidido uma vez: quem
 * chama guarda o primeiro 'puxar'/'desistir' e não pergunta de novo.
 */
export function decidirEixo(dx: number, dy: number): DecisaoDeEixo {
  if (Math.hypot(dx, dy) < TRAVA_DE_EIXO_PX) return 'espera';
  // Na dúvida (45°), é carrossel: perder uma recarga custa menos que roubar
  // o arrasto de uma prateleira.
  if (Math.abs(dx) >= Math.abs(dy)) return 'desistir';
  return dy > 0 ? 'puxar' : 'desistir';
}

/** Distância do indicador para um deslocamento de dedo `dy`. */
export function distanciaDaPuxada(dy: number): number {
  if (!(dy > 0)) return 0;
  return Math.min(MAXIMO_PX, dy * RESISTENCIA);
}

/** Soltar aqui recarrega? */
export function disparou(distancia: number): boolean {
  return distancia >= LIMIAR_PX;
}

/** Progresso até o limiar, em [0,1] — o quanto do círculo está desenhado. */
export function progresso(distancia: number): number {
  return Math.min(1, Math.max(0, distancia / LIMIAR_PX));
}
