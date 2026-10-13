/**
 * O CLIPE RESERVA — a mesma música, em outro vídeo, quando o oficial não entra.
 *
 * Muito clipe oficial (gravadora, VEVO) vem com o embed DESLIGADO pelo dono: o
 * YouTube responde erro 101/150 e o quadro fica preto. A música, porém, quase
 * sempre existe em outros vídeos que aceitam embed — lyric video, áudio num
 * canal de fã, gravação ao vivo. Aqui o modo clipe procura esses.
 *
 * ── AS DUAS REGRAS QUE NÃO SE NEGOCIAM ──
 *
 * 1. TEM QUE SER A MÚSICA. A busca é a mesma do "Mais músicas" (importador), e
 *    o crivo é o `notaDoResultado` do último recurso do player: o título da
 *    faixa no título do vídeo, e o artista (no título ou no canal) ou a duração
 *    batendo; speed up, cover, karaokê e afins ficam de fora. Um clipe de OUTRA
 *    música em cima do som é pior que a capa.
 *
 * 2. NADA IMPRÓPRIO. Título ou canal com marca de conteúdo adulto é descartado
 *    — a não ser que a palavra esteja no título da PRÓPRIA faixa (aí ela é
 *    parte do nome da música, não um aviso sobre o vídeo).
 *
 * A ordem favorece quem tem mais chance de aceitar embed: o canal do vídeo que
 * acabou de falhar costuma desligar o embed em tudo, e canais VEVO idem.
 */
import type { TrackDto } from '@radinho/shared';
import { notaDoResultado } from '@/lib/local/acharPelaBusca';
import {
  buscarNoYoutube,
  videoIdDoYoutube,
  type ResultadoYoutube,
} from '@/lib/local/importerHelper';

/** Quantos candidatos o modo clipe chega a tentar por faixa. */
export const MAX_TENTATIVAS = 4;

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

/** Marcas de conteúdo adulto no título ou no canal. Palavras inteiras. */
const IMPROPRIO =
  /\b(?:porn[oô]?|pornografia|xxx|\+ ?18|18 ?\+|sexo|sex|nude[sz]?|nua|pelad[ao]s?|hentai|onlyfans|privacy|putaria|safadeza|gozad[ao]|er[oó]tic[ao]s?|str[ie]p(?:tease)?|boquete|siririca|punheta)\b/gi;

function norm(s: string): string {
  return s.normalize('NFD').replace(DIACRITICOS, '').toLowerCase();
}

/**
 * O vídeo traz marca de conteúdo adulto que NÃO vem do nome da música?
 * Pura e exportada para o teste prender as duas pontas: o que cai e o que
 * fica porque a palavra é da faixa.
 */
export function pareceImproprio(track: Pick<TrackDto, 'title'>, r: ResultadoYoutube): boolean {
  const daFaixa = norm(track.title);
  const texto = norm(`${r.titulo} ${r.canal}`);
  for (const m of texto.matchAll(IMPROPRIO)) {
    const palavra = m[0].replace(/\s+/g, '');
    if (!daFaixa.replace(/\s+/g, '').includes(palavra)) return true;
  }
  return false;
}

export interface Candidato {
  videoId: string;
  nota: number;
}

/**
 * Os vídeos que servem de clipe para esta faixa, do melhor para o pior.
 * `evitar`: ids que já falharam (o oficial sem embed, os que deram erro).
 */
export function ordenarCandidatos(
  track: TrackDto,
  resultados: readonly ResultadoYoutube[],
  evitar: ReadonlySet<string> = new Set(),
): Candidato[] {
  // O canal de quem já falhou tende a ter o embed desligado em tudo.
  const canaisQueFalharam = new Set(
    resultados
      .filter((r) => {
        const id = videoIdDoYoutube(r.url);
        return id !== null && evitar.has(id) && r.canal;
      })
      .map((r) => norm(r.canal)),
  );
  const saida: Candidato[] = [];
  for (const r of resultados) {
    const videoId = videoIdDoYoutube(r.url);
    if (!videoId || evitar.has(videoId)) continue;
    const base = notaDoResultado(track, r);
    if (base <= 0) continue;
    if (pareceImproprio(track, r)) continue;
    let nota = base;
    if (r.canal && canaisQueFalharam.has(norm(r.canal))) nota -= 2;
    if (/vevo/i.test(r.canal)) nota -= 1;
    saida.push({ videoId, nota });
  }
  return saida.sort((a, b) => b.nota - a.nota);
}

export type BuscaDeClipe =
  | { ok: true; resultados: ResultadoYoutube[] }
  | { ok: false; motivo: 'login' | 'limite' | 'falha' };

/** Uma busca por faixa por sessão: o importador tem limite por pessoa. */
const buscas = new Map<string, Promise<BuscaDeClipe>>();

export function buscarClipes(track: TrackDto): Promise<BuscaDeClipe> {
  const ja = buscas.get(track.id);
  if (ja) return ja;
  const artista = track.artists.find((a) => a.name && a.name !== 'Desconhecido')?.name ?? '';
  const termo = `${artista} ${track.title}`.trim();
  if (!track.title?.trim()) return Promise.resolve({ ok: false, motivo: 'falha' });
  const p: Promise<BuscaDeClipe> = buscarNoYoutube(termo)
    .then((b): BuscaDeClipe => (b.ok ? { ok: true, resultados: b.resultados } : b))
    .catch((): BuscaDeClipe => ({ ok: false, motivo: 'falha' }));
  buscas.set(track.id, p);
  // Falha de rede não fica guardada: a próxima faixa igual tenta de novo.
  void p.then((b) => {
    if (!b.ok && b.motivo === 'falha') buscas.delete(track.id);
  });
  return p;
}

/**
 * O próximo vídeo a tentar como clipe desta faixa, fora dos `evitar`.
 * `null` = não há (ou não dá para procurar — `motivo` diz por quê).
 */
export async function clipeAlternativo(
  track: TrackDto,
  evitar: ReadonlySet<string>,
): Promise<{ videoId: string | null; motivo?: 'login' | 'limite' | 'falha' }> {
  const busca = await buscarClipes(track);
  if (!busca.ok) return { videoId: null, motivo: busca.motivo };
  const melhor = ordenarCandidatos(track, busca.resultados, evitar)[0];
  return { videoId: melhor?.videoId ?? null };
}
