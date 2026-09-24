/**
 * PARA ONDE O NOME DO ARTISTA (OU DO ÁLBUM) LEVA.
 *
 * `/artist/:id` e `/album/:id` consultam a API central, que NÃO está no ar:
 * clicar no nome do artista de uma faixa da biblioteca caía numa tela de erro.
 * Faixa da biblioteca vai para as páginas LOCAIS, que têm dados de verdade; só
 * o catálogo usa as rotas por id.
 *
 * Isto morava dentro do `TrackRow`, e foi por isso que o defeito sobreviveu: a
 * lista de faixas fazia certo enquanto a BARRA DO PLAYER, com a mesma faixa na
 * tela, continuava mandando todo mundo para a página que erra. Regra de
 * navegação que vale para a faixa não pode morar num componente só.
 */
import type { TrackDto } from '@radinho/shared';

/** A faixa é da biblioteca deste aparelho (não do catálogo central)? */
export function ehFaixaLocal(trackId: string | null | undefined): boolean {
  return Boolean(trackId?.startsWith('local:'));
}

export function artistHref(
  trackId: string | null | undefined,
  artist: { id?: string; name: string },
): string | null {
  if (ehFaixaLocal(trackId)) return `/artista/${encodeURIComponent(artist.name)}`;
  return artist.id ? `/artist/${artist.id}` : null;
}

/** `null` = não há para onde ir; o nome vira texto simples. */
export function albumHref(track: TrackDto, chaveLocal: string | null): string | null {
  if (ehFaixaLocal(track.id)) return chaveLocal ? `/disco/${encodeURIComponent(chaveLocal)}` : null;
  return track.album ? `/album/${track.album.id}` : null;
}
