/**
 * O ÚLTIMO RECURSO: A MESMA MÚSICA, ACHADA DE NOVO.
 *
 * Uma faixa só era "indisponível" quando todas as fontes dela tinham acabado:
 * sem cópia no cofre e com o link de origem morto (vídeo removido, privado) —
 * ou sem link nenhum. Mas a MÚSICA quase sempre continua existindo em outro
 * lugar. Aqui o player a procura pelo nome e pelo artista (a mesma busca do
 * "Mais músicas", pelo importador), escolhe o resultado que é mesmo ela, e toca
 * na hora. Quem chama grava o link novo na faixa: da próxima vez ela já nasce
 * com a origem boa, e o cofre baixa a cópia.
 *
 * ESCOLHER É O QUE IMPORTA — tocar outra música no lugar é pior que avisar.
 * O resultado precisa ter o TÍTULO da faixa, e ainda o artista (no título ou no
 * canal) ou a duração batendo; versões mexidas (speed up, 8D, karaokê…) ficam
 * de fora, a não ser que a própria faixa seja uma delas.
 */
import type { TrackDto } from '@radinho/shared';
import { buildStreamUrl, buscarNoYoutube, type ResultadoYoutube } from '@/lib/local/importerHelper';

const DIACRITICOS = new RegExp('[\u0300-\u036f]', 'g');
const VERSAO_ALTERADA =
  /\b(?:speed ?up|sped ?up|slowed|reverb|8d|nightcore|bass ?boost(?:ed)?|karaok[eê]|instrumental|cover|reac(?:t|tion|ting)|reagindo|tutorial|aula)\b/i;

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat|ft|part|participacao)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nota do resultado para esta faixa; 0 = não é ela. */
export function notaDoResultado(track: TrackDto, r: ResultadoYoutube): number {
  const titulo = norm(track.title);
  if (!titulo) return 0;
  const doVideo = norm(r.titulo);
  if (!doVideo.includes(titulo)) return 0;
  const bruto = `${r.titulo} ${r.canal}`;
  if (VERSAO_ALTERADA.test(bruto) && !VERSAO_ALTERADA.test(track.title)) return 0;
  const onde = `${doVideo} ${norm(r.canal)}`;
  const artistaBate = track.artists.some((a) => {
    const n = norm(a.name);
    return n.length >= 2 && onde.includes(n);
  });
  const esperado = (track.durationMs ?? 0) / 1000;
  const duracaoBate =
    esperado > 0 &&
    r.duracaoSeg > 0 &&
    Math.abs(r.duracaoSeg - esperado) <= Math.max(8, esperado * 0.1);
  if (!artistaBate && !duracaoBate) return 0;
  // Título exato vale mais que título contido ("Mantém" vs "Mantém Remix").
  return (artistaBate ? 2 : 0) + (duracaoBate ? 2 : 0) + (doVideo === titulo ? 1 : 0);
}

export function melhorResultado(
  track: TrackDto,
  resultados: readonly ResultadoYoutube[],
): ResultadoYoutube | null {
  let melhor: ResultadoYoutube | null = null;
  let nota = 0;
  for (const r of resultados) {
    const n = notaDoResultado(track, r);
    if (n > nota) {
      melhor = r;
      nota = n;
    }
  }
  return melhor;
}

/**
 * A faixa pronta para tocar pela busca, com a origem nova em `sourceUrl`, ou
 * null. `evitar`: links que já falharam (a origem morta não volta como "achada").
 */
export async function acharPelaBusca(
  track: TrackDto,
  evitar: ReadonlySet<string> = new Set(),
): Promise<TrackDto | null> {
  const artista = track.artists.find((a) => a.name && a.name !== 'Desconhecido')?.name ?? '';
  const termo = `${artista} ${track.title}`.trim();
  if (!track.title?.trim()) return null;
  const busca = await buscarNoYoutube(termo).catch(() => null);
  if (!busca?.ok) return null;
  const candidatos = busca.resultados.filter((r) => !evitar.has(r.url));
  const achado = melhorResultado(track, candidatos);
  if (!achado) return null;
  const streamUrl = await buildStreamUrl(achado.url).catch(() => null);
  if (!streamUrl) return null;
  return { ...track, streamUrl, sourceUrl: achado.url };
}
