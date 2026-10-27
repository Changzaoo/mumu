/**
 * "EM ALTA" POR GÊNERO — o que está no topo AGORA, reunido de várias paradas.
 *
 * O worker `emAlta` (apps/api/src/workers) lê as paradas públicas de tempos em
 * tempos, funde por "artista|título", atribui o gênero da taxonomia e grava o
 * resultado no banco. A página só LÊ o que está gravado (`GET /em-alta`): nunca
 * consulta parada nenhuma em tempo real.
 *
 * Cada faixa traz o VEREDITO DE CONTEÚDO, porque a prateleira obedece à idade
 * de quem olha (ver `apps/web/src/lib/conteudo/faixaEtaria.ts`): menor não vê
 * explícito, criança só vê o comprovadamente limpo. O veredito vem, nesta
 * ordem, do acervo (letra julgada no servidor), do título e do selo das fontes
 * (Deezer `explicit_lyrics`, Apple `trackExplicitness`).
 */
import { z } from 'zod';

export const FONTES_DE_PARADA = ['deezer', 'apple', 'youtube'] as const;
export type FonteDeParada = (typeof FONTES_DE_PARADA)[number];

export const faixaEmAltaSchema = z.object({
  /** "artista|título" normalizado — a identidade da música entre as fontes. */
  chave: z.string(),
  titulo: z.string(),
  artista: z.string(),
  /** Gênero da taxonomia (`GENRE_TAXONOMY`), ou `null` quando nenhuma fonte disse. */
  genero: z.string().nullable(),
  capa: z.string().nullable(),
  duracaoMs: z.number().int().nullable(),
  /** Posição dentro do gênero (1 = topo). */
  posicao: z.number().int().min(1),
  /** Quanto subiu: soma das posições em cada fonte, mais bônus por aparecer em várias. */
  nota: z.number(),
  fontes: z.array(z.enum(FONTES_DE_PARADA)),
  conteudo: z.enum(['explicito', 'limpo', 'desconhecido']),
  /** Id no acervo quando a música já está lá (e toca). */
  acervoId: z.string().nullable(),
  /** Link de origem para a fila de import quando ainda não está no acervo. */
  origem: z.string().nullable(),
});
export type FaixaEmAlta = z.infer<typeof faixaEmAltaSchema>;

export const generoEmAltaSchema = z.object({
  /** Nome do gênero da taxonomia, ou `Todos` para a parada geral. */
  genero: z.string(),
  faixas: z.array(faixaEmAltaSchema),
});
export type GeneroEmAlta = z.infer<typeof generoEmAltaSchema>;

export const emAltaSchema = z.object({
  /** ISO de quando o worker gravou esta leitura. */
  atualizadoEm: z.string(),
  generos: z.array(generoEmAltaSchema),
});
export type EmAltaDto = z.infer<typeof emAltaSchema>;

/** Rótulo da parada geral (todas as paradas, sem gênero). */
export const GENERO_TODOS = 'Todos';
