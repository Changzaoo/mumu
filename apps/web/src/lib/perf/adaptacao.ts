/**
 * O APP SE SERVE CONFORME O APARELHO E A REDE.
 *
 * `dispositivo.ts` descobre o que o aparelho aguenta; aqui mora o que muda por
 * causa disso fora do CSS — hoje, o áudio:
 *
 * - QUALIDADE: com "automática" ligada, a escolha da pessoa vira TETO, e a rede
 *   decide abaixo dele. 320 kbps num 3G é música parando para carregar; 96 kbps
 *   com `saveData` é a pessoa pedindo para não gastar o plano.
 * - PRÉ-CARGA: rede lenta pede a próxima faixa mais cedo, para ela chegar antes
 *   da atual acabar.
 *
 * Tudo é consultado na hora do uso (nunca no carregamento do módulo): a rede
 * muda no meio da sessão e o monitor de quadros pode rebaixar o perfil.
 */
import type { AudioQuality } from '@radinho/shared';
import {
  perfilAtual,
  qualidadeDaRede,
  type PerfilDoAparelho,
  type QualidadeDaRede,
} from './dispositivo';

const ORDEM: readonly AudioQuality[] = ['low', 'normal', 'high', 'lossless'];

export function qualidadeRecomendada(
  perfil: PerfilDoAparelho,
  rede: QualidadeDaRede,
): AudioQuality {
  if (rede === 'lenta') return 'low';
  // Aparelho de entrada quase sempre anda em plano pré-pago: 160 kbps soa
  // igual no alto-falante dele e custa metade dos dados.
  if (rede === 'media' || perfil === 'baixo') return 'normal';
  return 'high';
}

/** A qualidade a pedir agora: a escolha da pessoa, limitada pela recomendação. */
export function qualidadeEfetiva(
  escolha: AudioQuality,
  automatica: boolean,
  perfil: PerfilDoAparelho = perfilAtual(),
  rede: QualidadeDaRede = qualidadeDaRede(),
): AudioQuality {
  if (!automatica) return escolha;
  const rec = qualidadeRecomendada(perfil, rede);
  return ORDEM.indexOf(rec) < ORDEM.indexOf(escolha) ? rec : escolha;
}

/** Segundos antes do fim em que a próxima faixa começa a carregar. */
export function antecedenciaDoPreload(rede: QualidadeDaRede = qualidadeDaRede()): number {
  if (rede === 'lenta') return 30;
  if (rede === 'media') return 20;
  return 12;
}
