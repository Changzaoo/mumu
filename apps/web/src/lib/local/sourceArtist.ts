/**
 * O artista lido da FONTE do download, não adivinhado.
 *
 * Todo este acervo veio do YouTube, e o vídeo sempre soube de quem é a música:
 * está no título ("MATUÊ - BACKSTAGE") e no canal. O app guardava a `sourceUrl`
 * de cada faixa desde sempre — e mesmo assim as tentativas anteriores de
 * identificar tentavam DEDUZIR o dono a partir do título solto, o que rendeu
 * "CAROLINA" virando Ninho e "DIOR" virando Pop Smoke.
 *
 * Medições que levaram até aqui, para ninguém repetir o caminho:
 *  • busca por título na Apple/Deezer: acerta o que é famoso, erra o resto;
 *  • descobrir o artista buscando o título e conferindo a duração: 1 acerto em
 *    14 — títulos genéricos ("PARTY", "BACKSTAGE") afundam a faixa certa;
 *  • ranquear os parceiros que aparecem no catálogo dos artistas conhecidos:
 *    também 1 em 14 — quem aparece mais é produtor, não o dono da faixa.
 *
 * O oEmbed do YouTube resolve sem chave, sem servidor e sem heurística: ele
 * devolve o dado, em vez de nos fazer inferir. É CORS-aberto, então funciona
 * mesmo com o importador caseiro desligado.
 */

/** Sufixos de canal que não fazem parte do nome do artista. */
const CHANNEL_NOISE = /\s*(?:-\s*topic|vevo|official|oficial|music|records?)\s*$/gi;

/** Ruído que vem grudado no título do vídeo. */
const TITLE_NOISE =
  /\s*[([{]?\s*\b(?:official|oficial|video|vídeo|clipe|audio|áudio|lyric|lyrics|visualizer|prod|hd|4k|m\/v|mv)\b[^)\]}]*[)\]}]?\s*/gi;

/** O id do vídeo numa URL do YouTube, em qualquer das formas usuais. */
export function youtubeIdFrom(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (!/(^|\.)youtube\.com$/.test(host)) return null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * O nome do artista a partir do título do vídeo e do canal.
 *
 * O título manda quando traz o separador "ARTISTA - MÚSICA", que é a convenção
 * de praticamente todo lançamento. Sem ele, sobra o canal — que num acervo
 * baixado do canal do próprio artista é exatamente o nome procurado.
 *
 * Devolve null em vez de chutar: um nome errado aqui vira autoria errada na
 * biblioteca, que é pior que "Desconhecido" porque parece certo.
 */
export function artistFromVideo(videoTitle: string, channel: string): string | null {
  const limpo = (s: string): string =>
    s
      .replace(TITLE_NOISE, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  const titulo = limpo(videoTitle ?? '');
  // Só o PRIMEIRO travessão separa artista de música; os seguintes costumam
  // pertencer ao nome da faixa.
  const corte = titulo.split(/\s[-–—|]\s/);
  const primeiro = corte[0];
  if (corte.length >= 2 && primeiro) {
    const candidato = primeiro
      // "MATUÊ FEAT. TETO - X" → o dono é quem vem antes da participação.
      .replace(/\b(?:feat|ft|featuring|com)\b\.?.*$/i, '')
      .trim();
    // Um "artista" de uma letra ou de frase inteira quase sempre é título mal
    // formatado, não nome de gente.
    if (candidato.length >= 2 && candidato.split(/\s+/).length <= 6) return candidato;
  }

  const canal = (channel ?? '').replace(CHANNEL_NOISE, '').trim();
  if (canal.length >= 2) return canal;
  return null;
}

interface OEmbed {
  title?: unknown;
  author_name?: unknown;
}

/**
 * Consulta o oEmbed do YouTube e devolve o artista.
 *
 * Sem chave e sem proxy: o endpoint manda CORS aberto. Vídeo removido ou
 * privado responde 401/404 — nesse caso não há o que fazer, devolve null e a
 * faixa segue para as outras fontes.
 */
export async function artistFromSource(sourceUrl: string): Promise<string | null> {
  if (!youtubeIdFrom(sourceUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as OEmbed;
    const titulo = typeof data.title === 'string' ? data.title : '';
    const canal = typeof data.author_name === 'string' ? data.author_name : '';
    return artistFromVideo(titulo, canal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
