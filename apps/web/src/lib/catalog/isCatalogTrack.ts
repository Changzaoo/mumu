/**
 * Quem é "do catálogo" e quem é "do usuário".
 *
 * O catálogo grátis (Audius `audius:<id>`, prévias iTunes `apple:<id>`) existe
 * para navegar/buscar/descobrir — não para virar acervo pessoal. Quando uma
 * faixa dessas era persistida na biblioteca/listas do aparelho, o usuário
 * terminava com uma "biblioteca" que ele nunca montou e que some no dia em que
 * a fonte sai do ar. Este é o único lugar que decide essa fronteira, para que
 * biblioteca, listas locais, curtidas e histórico concordem entre si.
 */
import type { TrackDto } from '@aurial/shared';

/** Prefixos de id que identificam faixas vindas do catálogo grátis. */
const CATALOG_ID_PREFIXES = ['audius:', 'apple:'] as const;

/** True quando o id pertence ao catálogo grátis (sem precisar do DTO inteiro). */
export function isCatalogId(id: string | null | undefined): boolean {
  if (!id) return false;
  return CATALOG_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * True para qualquer faixa que não é do usuário: catálogo grátis por id ou
 * qualquer prévia de 30s (`previewOnly`), que não é uma música de verdade.
 */
export function isCatalogTrack(track: Pick<TrackDto, 'id'> & { previewOnly?: boolean }): boolean {
  return isCatalogId(track.id) || track.previewOnly === true;
}

/** True para faixa que o usuário realmente possui (arquivo/import no aparelho). */
export function isOwnTrack(track: Pick<TrackDto, 'id'> & { previewOnly?: boolean }): boolean {
  return !isCatalogTrack(track);
}
