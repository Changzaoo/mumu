/**
 * "Recriar playlist a partir de uma lista": casar cada linha colada com uma
 * faixa QUE O USUÁRIO JÁ TEM.
 *
 * Antes, cada linha sem correspondência virava o primeiro resultado do catálogo
 * grátis — a lista nascia cheia de substitutos que o usuário nunca escolheu e
 * que entram na biblioteca dele. Aqui só o acervo próprio conta; o que não
 * casar é devolvido como "faltando" para a tela dizer a verdade.
 */
import type { TrackDto } from '@aurial/shared';

/** Mesma normalização da biblioteca (caixa/acento/pontuação não decidem nada). */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Linhas úteis de um texto colado (vazias fora, teto de segurança). */
export function parseLines(text: string, limit = 300): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Quebra "Título - Artista" (também aceita "–", "—" e "Título por Artista").
 * Sem separador, a linha inteira é tratada como título.
 */
export function splitLine(line: string): { title: string; artist: string } {
  const match = /^(.*?)\s+[-–—]\s+(.*)$/.exec(line);
  if (!match) return { title: line.trim(), artist: '' };
  return { title: (match[1] ?? '').trim(), artist: (match[2] ?? '').trim() };
}

/** Chaves de busca de uma faixa: "titulo artista" e "artista titulo" e só "titulo". */
function trackKeys(track: TrackDto): string[] {
  const title = normalizeName(track.title);
  if (!title) return [];
  const keys = [title];
  for (const artist of track.artists) {
    const name = normalizeName(artist.name ?? '');
    if (!name) continue;
    keys.push(`${title} ${name}`, `${name} ${title}`);
  }
  return keys;
}

export interface ListMatchResult {
  /** Faixas da biblioteca do usuário, na ordem da lista colada (sem repetir). */
  matched: TrackDto[];
  /** Linhas sem nenhuma faixa correspondente no acervo do usuário. */
  missing: string[];
}

/**
 * Casa cada linha com o acervo do usuário. A lista resultante NUNCA contém
 * faixa de catálogo — no máximo vem mais curta do que o texto colado.
 */
export function matchLinesToLibrary(lines: string[], library: TrackDto[]): ListMatchResult {
  const index = new Map<string, TrackDto>();
  for (const track of library) {
    for (const key of trackKeys(track)) {
      // Primeira faixa a reclamar a chave vence — mantém o resultado estável.
      if (!index.has(key)) index.set(key, track);
    }
  }

  const matched: TrackDto[] = [];
  const missing: string[] = [];
  const used = new Set<string>();

  for (const line of lines) {
    const { title, artist } = splitLine(line);
    const whole = normalizeName(line);
    const normTitle = normalizeName(title);
    const normArtist = normalizeName(artist);
    // Do mais específico (título + artista, nas duas ordens) ao mais frouxo.
    const candidates = [
      normArtist ? `${normTitle} ${normArtist}` : '',
      normArtist ? `${normArtist} ${normTitle}` : '',
      whole,
      normTitle,
    ].filter(Boolean);

    const hit = candidates.map((key) => index.get(key)).find(Boolean);
    if (!hit) {
      missing.push(line);
      continue;
    }
    if (used.has(hit.id)) continue; // mesma faixa citada duas vezes: entra uma
    used.add(hit.id);
    matched.push(hit);
  }

  return { matched, missing };
}
