/**
 * O FILTRO DURO ANTES DE QUALQUER PRATELEIRA.
 *
 * A regra mora no shared (`podeRecomendar`, com a tabela de famílias vizinhas
 * e opostas). Aqui ela encontra o perfil de gosto do aparelho e a biblioteca:
 * o que sai daqui é a ÚNICA biblioteca que as prateleiras de recomendação da
 * Home enxergam — gênero-tronco, ramificações, "Feito para você", álbuns,
 * agentes, mixes semânticos. Nenhuma delas pode ranquear o que não passou.
 *
 * Duas regras numa passada só, porque as duas são "o que esta pessoa pode
 * receber": a idade (`podeOuvir`, a regra única de conteúdo) e o gosto.
 */
import {
  familiasFortes,
  podeRecomendar,
  type FamiliaDoGosto,
  type TrackDto,
  type VeredictoDeConteudo,
} from '@radinho/shared';
import { podeOuvir } from '@/lib/conteudo/faixaEtaria';
import type { PerfilDeGosto } from './perfilDeGosto';

/** As famílias do perfil com a fatia de cada uma — o que `podeRecomendar` lê. */
export function familiasDoPerfil(perfil: Pick<PerfilDeGosto, 'porFamilia'>): FamiliaDoGosto[] {
  let total = 0;
  for (const v of perfil.porFamilia.values()) total += Math.max(0, v);
  if (total <= 0) return [];
  return [...perfil.porFamilia]
    .filter(([, v]) => v > 0)
    .map(([familia, v]) => ({ familia, fatia: v / total }))
    .sort((a, b) => b.fatia - a.fatia);
}

export interface EntradaCandidata {
  track: TrackDto;
  /** Veredito que a listagem do acervo entrega (ausente = desconhecido). */
  conteudoVeredicto?: VeredictoDeConteudo;
}

/**
 * A biblioteca que pode ser recomendada a quem tem este gosto. Sem gosto
 * medido, só a idade filtra.
 */
export function bibliotecaCoerente<T extends EntradaCandidata>(
  entries: readonly T[],
  gosto: readonly FamiliaDoGosto[],
  podeOuvirFaixa: (track: TrackDto) => boolean = podeOuvir,
): T[] {
  const temGosto = familiasFortes(gosto).length > 0;
  return entries.filter(
    (e) =>
      podeOuvirFaixa(e.track) &&
      (!temGosto ||
        podeRecomendar(gosto, {
          genero: e.track.genre ?? null,
          conteudo: e.conteudoVeredicto ?? null,
        })),
  );
}
