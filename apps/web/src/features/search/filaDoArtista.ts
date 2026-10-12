/**
 * A FILA DE QUEM TOCOU UMA MÚSICA DA INTERNET — mais do MESMO artista.
 *
 * Antes, tocar um achado do YouTube na busca enfileirava a lista de resultados
 * inteira: buscou "Mantém", ouvia "Mantém" e depois as versões, os covers e o
 * que mais tivesse o mesmo nome — de outros artistas. Quem dá play numa música
 * quer continuar ouvindo QUEM canta. A fila agora é: o que o acervo já tem
 * desse artista, depois o que ele tem na internet, sem repetir música.
 */
import * as localLibrary from '@/lib/local/localLibrary';
import { buscarNoYoutube, faixaDoYoutube } from '@/lib/local/importerHelper';
import { trackArtistNames } from '@/lib/utils';
import type { TrackDto } from '@radinho/shared';

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
/** Fila grande o bastante para uma tarde, pequena para não pesar no aparelho. */
const TAMANHO_DA_FILA = 30;

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "Mantém" de "Matuê" — a mesma música em qualquer grafia/versão. */
export function chaveDaMusica(t: TrackDto): string {
  return `${norm(trackArtistNames(t))}|${norm(t.title)}`;
}

/**
 * Versão mexida por terceiros (acelerada, "8D", karaokê, reação…): quem busca
 * "Mantém" quer a música, não o "speed up + grave" de um canal qualquer. Só
 * aparece se a própria busca pedir por ela.
 */
export const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|cover|reac(?:t|tion|ting)|reagindo|react|tutorial|aula|remix)\b/i;

/** A faixa é desse artista? Por nome normalizado, em qualquer posição dos créditos. */
export function ehDoArtista(t: TrackDto, artista: string): boolean {
  const alvo = norm(artista);
  if (!alvo) return false;
  return t.artists.some((a) => {
    const nome = norm(a.name);
    return nome === alvo || ` ${nome} `.includes(` ${alvo} `) || ` ${alvo} `.includes(` ${nome} `);
  });
}

/**
 * Outras músicas do artista principal de `faixa`, sem ela mesma. Acervo
 * primeiro (toca na hora, da cópia), internet depois. Nunca lança: sem rede
 * ou sem conta, devolve só o que o acervo tiver.
 */
export async function maisDoArtista(faixa: TrackDto, signal?: AbortSignal): Promise<TrackDto[]> {
  const artista = faixa.artists[0]?.name?.trim();
  if (!artista) return [];

  const vistas = new Set([chaveDaMusica(faixa)]);
  const saida: TrackDto[] = [];
  const juntar = (t: TrackDto): void => {
    if (saida.length >= TAMANHO_DA_FILA || t.id === faixa.id) return;
    const chave = chaveDaMusica(t);
    if (vistas.has(chave)) return;
    vistas.add(chave);
    saida.push(t);
  };

  for (const t of localLibrary.artistTracks(artista)) juntar(t);

  const busca = await buscarNoYoutube(artista, signal);
  if (busca.ok) {
    const daInternet = await Promise.all(
      busca.resultados
        .filter((r) => !VERSAO_ALTERADA.test(`${r.titulo} ${r.canal}`))
        .map((r) => localLibrary.findBySource(r.url) ?? faixaDoYoutube(r)),
    );
    for (const t of daInternet) if (t && ehDoArtista(t, artista)) juntar(t);
  }
  return saida;
}
