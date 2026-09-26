/**
 * UM PEDIDO DE CALIBRAÇÃO POR FAIXA, DIVIDIDO ENTRE QUEM PRECISAR.
 *
 * Duas partes do app querem a mesma coisa — o instante de cada palavra
 * cantada, aplicado à letra em cache: o AQUECIMENTO (`aquecerCalibracao`,
 * chamado pelo playerStore assim que a faixa começa a tocar, letra fechada) e
 * a `LyricsView` (quando a pessoa abre a tela). Sem um ponto único, os dois
 * abririam cada um o seu próprio laço de `buscarTempo` — e abrir a letra
 * enquanto o aquecimento já estava perguntando duplicaria o pedido ao
 * importador pela MESMA faixa. Aqui há no máximo UM laço em voo por faixa
 * (`emVoo`); quem chega depois recebe a mesma promessa, e todos são
 * avisados quando ela resolve.
 *
 * A meta é a letra já chegar calibrada (`writeLyrics(..., { calibrada: true })`)
 * ANTES de alguém abrir a tela — para isso o pedido tem que sair assim que o
 * SOM sai, não quando a letra é aberta. Por isso nada aqui pode lançar nem
 * atrasar quem chamou: é sempre best-effort, fora do caminho crítico.
 */
import type { TrackDto } from '@radinho/shared';
import { cachedLyrics, fetchLyrics, writeLyrics, type Lyrics } from '@/lib/lyrics/lyrics';
import { garantirDetalhe } from '@/lib/local/detalheDaFaixa';
import { dicaDeIdioma } from '@/lib/lyrics/syncFromAudio';
import {
  buscarTempo,
  palavrasEmLinhas,
  recalibrarLetra,
  urlDoTempo,
} from '@/lib/lyrics/recalibrar';
import { remoteUrlFor } from '@/lib/local/localLibrary';

/**
 * Espaço entre perguntas ao importador e o número de tentativas.
 *
 * ~3 minutos de orçamento: o caminho em inglês (Riva) responde em segundos,
 * mas o pt-BR (faster-whisper local) leva ~50 s por música de 4 min — e pode
 * estar atrás de outra faixa na fila do importador (uma de cada vez). Correr
 * apenas ENQUANTO a faixa continua atual/próxima evita gastar essas doze
 * perguntas com uma música que a pessoa já pulou.
 */
const INTERVALO_MS = 15_000;
const TENTATIVAS_MAX = 12;

/** Uma entrada por faixa em voo — o que impede o pedido duplicado. */
const emVoo = new Map<string, Promise<Lyrics | null>>();

/** Para os testes (e para quem quiser evitar chamar duas vezes à toa). */
export function calibracaoEmVoo(trackId: string): boolean {
  return emVoo.has(trackId);
}

function idiomaPara(letra: Lyrics | null): string {
  if (!letra) return 'auto'; // sem letra em cache: deixa o importador detectar
  const texto = letra.lines.map((l) => l.text).join(' ');
  return dicaDeIdioma(texto) === 'en' ? 'en' : 'pt';
}

async function perguntarAteChegar(
  trackId: string,
  url: string,
  manterVivo: () => boolean,
): Promise<Lyrics | null> {
  let tentativas = 0;
  while (manterVivo()) {
    const r = await buscarTempo(url);
    if (r.tipo === 'pronto') {
      const atual = cachedLyrics(trackId);
      // Letra em cache: reancora nela. Sem letra nenhuma: a transcrição vira
      // a própria letra (rotulada — ver palavrasEmLinhas/recalibrar.ts).
      const nova: Lyrics | null = atual
        ? recalibrarLetra(atual, r.words)
        : { synced: true, lines: palavrasEmLinhas(r.words), source: 'Transcrição do áudio' };
      if (!nova || nova.lines.length === 0) return null;
      const pronta: Lyrics = { ...nova, calibrada: true };
      writeLyrics(trackId, pronta);
      return pronta;
    }
    if (r.tipo !== 'esperar' || ++tentativas >= TENTATIVAS_MAX) return null;
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
  }
  return null;
}

/**
 * Pede (ou reaproveita) a calibração desta faixa. Devolve a letra calibrada
 * quando chega, ou `null` quando não há como — sem cópia no cofre, offline,
 * o importador desistiu (422), ou o orçamento de tentativas esgotou. Nunca
 * lança.
 *
 * `manterVivo` é checado antes de CADA tentativa: quando falso, o laço para
 * sem gastar mais uma pergunta — é o que a próxima faixa da fila vira "não
 * vale mais a pena" quando a pessoa pula adiante de novo.
 */
export function pedirCalibracao(
  track: TrackDto,
  manterVivo: () => boolean = () => true,
): Promise<Lyrics | null> {
  const emAndamento = emVoo.get(track.id);
  if (emAndamento) return emAndamento;

  const emCache = cachedLyrics(track.id);
  if (emCache?.calibrada) return Promise.resolve(emCache);

  // Preview de 30s (Apple) nunca casa com o tempo da música inteira.
  if (track.previewOnly) return Promise.resolve(null);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(null);

  const promessa = (async (): Promise<Lyrics | null> => {
    // O IDIOMA DEPENDE DA LETRA, e no começo da faixa ela ainda não chegou
    // (o prefetch sai no mesmo instante). Escolher sem ela mandava música em
    // inglês para o whisper local (~50 s) em vez do Riva (~5 s) — e para um
    // cache diferente do que a tela de letra pede. A busca é a mesma do
    // prefetch: já em cache ou em voo, custa quase nada.
    const letra = emCache ?? (await fetchLyrics(track).catch(() => null));
    // O LINK DO COFRE também pode não existir ainda: a entrada do acervo chega
    // magra e ganha `remoteUrl` no detalhe, buscado no caminho do play.
    if (!remoteUrlFor(track.id) && !track.streamUrl) {
      await garantirDetalhe(track.id).catch(() => false);
    }
    const remota = remoteUrlFor(track.id) ?? track.streamUrl ?? null;
    const url = remota ? urlDoTempo(remota, idiomaPara(letra)) : null;
    if (!url || !manterVivo()) return null;
    return perguntarAteChegar(track.id, url, manterVivo);
  })()
    .catch(() => null)
    .finally(() => {
      emVoo.delete(track.id);
    });
  emVoo.set(track.id, promessa);
  return promessa;
}

/**
 * Aquece a calibração assim que o SOM sai — letra fechada, sem ninguém
 * esperando. Fire-and-forget: nunca lança, nunca atrasa quem chamou (é
 * chamado depois do `audioEngine.load`, fora do caminho crítico do play).
 * Quando a letra for aberta, `writeLyrics` já deixou a versão calibrada no
 * cache e `LyricsView` a lê de cara — ou, se o pedido ainda estiver em voo,
 * `pedirCalibracao` (chamado de lá) reaproveita esta mesma promessa.
 */
export function aquecerCalibracao(track: TrackDto, manterVivo: () => boolean): void {
  pedirCalibracao(track, manterVivo).catch(() => undefined);
}
