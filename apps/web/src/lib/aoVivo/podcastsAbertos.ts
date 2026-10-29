/**
 * Podcasts do mundo inteiro, pelo diretório público da Apple Podcasts.
 *
 * Três portas, todas com CORS liberado e sem chave:
 * - parada (top 100) por país e por categoria — refeita pela Apple todo dia;
 * - busca por nome/assunto;
 * - `lookup` com `entity=podcastEpisode`: o podcast e os episódios mais novos
 *   já com o link do MP3, sem precisar ler o RSS (que quase nunca tem CORS).
 *
 * O id do podcast é o `collectionId` da Apple — só dígitos —, o que separa estes
 * dos podcasts cadastrados na API do radinho (ids cuid) na rota /podcast/:id.
 */
import type { EpisodeDto, PodcastDto } from '@radinho/shared';
import type { NomeDeDesenho } from '@/components/icones/Desenho';

export interface PodcastAberto extends PodcastDto {
  categoria: string | null;
}

export interface CategoriaDePodcast {
  id: number;
  nome: string;
  icone: NomeDeDesenho;
}

/** Categorias da Apple Podcasts (ids fixos do diretório deles). */
export const CATEGORIAS_DE_PODCAST: CategoriaDePodcast[] = [
  { id: 1489, nome: 'Notícias', icone: 'jornal' },
  { id: 1303, nome: 'Comédia', icone: 'risada' },
  { id: 1324, nome: 'Sociedade e cultura', icone: 'sociedade' },
  { id: 1488, nome: 'True crime', icone: 'lupa' },
  { id: 1321, nome: 'Negócios', icone: 'maleta' },
  { id: 1304, nome: 'Educação', icone: 'capelo' },
  { id: 1545, nome: 'Esportes', icone: 'bola' },
  { id: 1512, nome: 'Saúde e bem-estar', icone: 'lotus' },
  { id: 1318, nome: 'Tecnologia', icone: 'notebook' },
  { id: 1310, nome: 'Música', icone: 'nota' },
  { id: 1314, nome: 'Religião e espiritualidade', icone: 'estrela-guia' },
  { id: 1487, nome: 'História', icone: 'coluna' },
  { id: 1533, nome: 'Ciência', icone: 'atomo' },
  { id: 1309, nome: 'TV e cinema', icone: 'claquete' },
  { id: 1301, nome: 'Artes', icone: 'paleta' },
  { id: 1483, nome: 'Ficção', icone: 'livro' },
  { id: 1305, nome: 'Infantil e família', icone: 'pipa' },
  { id: 1502, nome: 'Lazer', icone: 'controle' },
];

/** Países com parada própria na Apple Podcasts que mais interessam aqui. */
export const PAISES_DE_PODCAST = [
  'BR',
  'PT',
  'US',
  'GB',
  'ES',
  'MX',
  'AR',
  'CO',
  'CL',
  'FR',
  'DE',
  'IT',
  'CA',
  'AU',
  'JP',
  'IN',
] as const;

const ITUNES = 'https://itunes.apple.com';

/** Capa no tamanho pedido (a Apple troca o tamanho pelo nome do arquivo). */
function capa(url: string | null | undefined, lado = 600): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, `/${lado}x${lado}bb.jpg`);
}

/** O `country` da Apple é minúsculo e nem todo país tem loja: cai nos EUA. */
function loja(pais: string): string {
  return /^[a-z]{2}$/i.test(pais) ? pais.toLowerCase() : 'us';
}

interface EntradaDaParada {
  'im:name': { label: string };
  'im:image'?: { label: string }[];
  'im:artist'?: { label: string };
  summary?: { label: string };
  id: { attributes: { 'im:id': string } };
  category?: { attributes: { label: string } };
}

export async function paradaDePodcasts(
  pais: string,
  categoria: number | null = null,
  limite = 100,
): Promise<PodcastAberto[]> {
  const genero = categoria ? `/genre=${categoria}` : '';
  const r = await fetch(`${ITUNES}/${loja(pais)}/rss/toppodcasts/limit=${limite}${genero}/json`);
  if (!r.ok) throw new Error(`parada ${r.status}`);
  const dados = (await r.json()) as { feed?: { entry?: EntradaDaParada[] | EntradaDaParada } };
  const entradas = dados.feed?.entry;
  const lista = Array.isArray(entradas) ? entradas : entradas ? [entradas] : [];
  return lista.map((e) => ({
    id: e.id.attributes['im:id'],
    title: e['im:name'].label,
    publisher: e['im:artist']?.label ?? '',
    coverUrl: capa(e['im:image']?.at(-1)?.label, 400),
    description: e.summary?.label ?? null,
    episodeCount: 0,
    categoria: e.category?.attributes.label ?? null,
  }));
}

interface ResultadoItunes {
  wrapperType: string;
  kind?: string;
  collectionId: number;
  trackId: number;
  collectionName: string;
  trackName: string;
  artistName: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  trackCount?: number;
  primaryGenreName?: string;
  episodeUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
}

function paraPodcast(r: ResultadoItunes): PodcastAberto {
  return {
    id: String(r.collectionId),
    title: r.collectionName || r.trackName,
    publisher: r.artistName ?? '',
    coverUrl: capa(r.artworkUrl600 ?? r.artworkUrl100, 400),
    description: null,
    episodeCount: r.trackCount ?? 0,
    categoria: r.primaryGenreName ?? null,
  };
}

export async function buscarPodcasts(termo: string, pais: string): Promise<PodcastAberto[]> {
  const qs = new URLSearchParams({
    term: termo,
    media: 'podcast',
    entity: 'podcast',
    country: loja(pais),
    limit: '50',
  });
  const r = await fetch(`${ITUNES}/search?${qs}`);
  if (!r.ok) throw new Error(`busca ${r.status}`);
  const dados = (await r.json()) as { results: ResultadoItunes[] };
  return dados.results.filter((x) => x.kind === 'podcast').map(paraPodcast);
}

/** Texto do episódio: a Apple manda HTML às vezes; aqui vira texto corrido. */
function textoLimpo(html: string | undefined): string | null {
  if (!html) return null;
  const texto = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return texto || null;
}

export interface PodcastComEpisodios {
  podcast: PodcastAberto;
  episodios: EpisodeDto[];
}

/** Podcast + até 200 episódios mais novos (o teto do `lookup` da Apple). */
export async function podcastComEpisodios(id: string, pais = 'BR'): Promise<PodcastComEpisodios> {
  const qs = new URLSearchParams({
    id,
    entity: 'podcastEpisode',
    limit: '200',
    country: loja(pais),
  });
  const r = await fetch(`${ITUNES}/lookup?${qs}`);
  if (!r.ok) throw new Error(`lookup ${r.status}`);
  const dados = (await r.json()) as { results: ResultadoItunes[] };
  const cabeca = dados.results.find((x) => x.wrapperType === 'track' && x.kind === 'podcast');
  if (!cabeca) throw new Error('podcast não encontrado');
  const podcast = paraPodcast(cabeca);
  const episodios: EpisodeDto[] = dados.results
    .filter((x) => x.wrapperType === 'podcastEpisode' && x.episodeUrl)
    .map((x) => ({
      id: String(x.trackId),
      podcastId: podcast.id,
      title: x.trackName,
      description: textoLimpo(x.description ?? x.shortDescription),
      durationMs: x.trackTimeMillis ?? 0,
      publishedAt: x.releaseDate ?? new Date(0).toISOString(),
      streamUrl: x.episodeUrl ?? null,
      coverUrl: capa(x.artworkUrl600, 600) ?? podcast.coverUrl,
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (podcast.episodeCount === 0) podcast.episodeCount = episodios.length;
  return { podcast, episodios };
}

export function ehPodcastAberto(id: string): boolean {
  return /^\d+$/.test(id);
}
