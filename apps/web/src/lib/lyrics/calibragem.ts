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
  aplicarAlinhamento,
  buscarAlinhamento,
  buscarTempo,
  linhasParaAlinhar,
  palavrasEmLinhas,
  recalibrarLetra,
  transcricaoConfiavel,
  type TranscricaoParcial,
  urlDoAlinhamento,
  urlDoTempo,
} from '@/lib/lyrics/recalibrar';
import { remoteUrlFor } from '@/lib/local/localLibrary';
import { letraConfirmadaPelaVoz, palavrasOuvidas } from '@/lib/lyrics/confirmarPelaVoz';

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
const TENTATIVAS_MAX = 20;
/** Rótulo da transcrição do caminho antigo (texto inventado, não é letra). */
export const TRANSCRICAO_ANTIGA = 'Transcrição do áudio';
/** Rótulo da transcrição de hoje: o que o modelo ouviu, na falta da letra. */
export const TRANSCRICAO_AUTOMATICA = 'Transcrição automática';

/** Transcrição (de qualquer época) não é letra publicada. */
export function ehTranscricao(letra: Lyrics | null | undefined): boolean {
  return letra?.source === TRANSCRICAO_ANTIGA || letra?.source === TRANSCRICAO_AUTOMATICA;
}
/** Enquanto a transcrição roda, a tela mostra as palavras chegando. */
const AO_VIVO_MS = 3_000;
/**
 * Com quantas palavras ouvidas já dá para procurar a letra de verdade e
 * confirmá-la pela voz (ver lib/lyrics/confirmarPelaVoz.ts) — o bastante para
 * a prova valer, cedo o bastante para a letra certa chegar em segundos.
 */
const OUVIDAS_PARA_CONFIRMAR = 40;

/**
 * A LETRA SENDO FEITA, AO VIVO — o que a tela mostra enquanto o importador
 * trabalha: "nosso time está transcrevendo a letra agora", com as palavras
 * aparecendo conforme o modelo ouve a música. Um registro por faixa, que a
 * `LyricsView` assina.
 */
export interface LetraAoVivo {
  fase: 'na-fila' | 'transcrevendo' | 'alinhando';
  parcial?: TranscricaoParcial;
  /** A letra de verdade, já achada, enquanto é alinhada ao áudio. */
  letra?: Lyrics;
}
const aoVivo = new Map<string, LetraAoVivo>();
const ouvintesAoVivo = new Set<() => void>();

export function assinarLetraAoVivo(ouvinte: () => void): () => void {
  ouvintesAoVivo.add(ouvinte);
  return () => ouvintesAoVivo.delete(ouvinte);
}

export function letraAoVivo(trackId: string): LetraAoVivo | null {
  return aoVivo.get(trackId) ?? null;
}

function publicar(trackId: string, estado: LetraAoVivo | null): void {
  if (estado) aoVivo.set(trackId, estado);
  else if (!aoVivo.delete(trackId)) return;
  for (const o of ouvintesAoVivo) o();
}

/** Letra já passada pelo motor atual (alinhamento / transcrição filtrada). */
export type LetraAlinhada = Lyrics & {
  alinhada?: boolean;
  /** Transcrição que já procurou a letra de verdade (e não achou). */
  procuradaPelaVoz?: boolean;
};

/** Uma entrada por faixa em voo — o que impede o pedido duplicado. */
const emVoo = new Map<string, Promise<Lyrics | null>>();

/** Para os testes (e para quem quiser evitar chamar duas vezes à toa). */
export function calibracaoEmVoo(trackId: string): boolean {
  return emVoo.has(trackId);
}

function letraPublicada(letra: Lyrics | null | undefined): Lyrics | null {
  return letra && !ehTranscricao(letra) ? letra : null;
}

function idiomaPara(letra: Lyrics | null): string {
  if (!letra) return 'auto'; // sem letra em cache: deixa o importador detectar
  const texto = letra.lines.map((l) => l.text).join(' ');
  return dicaDeIdioma(texto) === 'en' ? 'en' : 'pt';
}

/**
 * A letra de verdade apareceu (confirmada pela voz): guarda, mostra na hora e
 * alinha ao áudio — a mesma estrada de quem já tinha letra publicada.
 */
async function usarLetraConfirmada(
  trackId: string,
  remota: string,
  letra: Lyrics,
  manterVivo: () => boolean,
): Promise<Lyrics | null> {
  writeLyrics(trackId, letra);
  publicar(trackId, { fase: 'alinhando', letra });
  const url = urlDoAlinhamento(remota, idiomaPara(letra));
  const alinhada = url ? await alinharAteChegar(trackId, url, letra, manterVivo) : null;
  return alinhada ?? letra;
}

async function perguntarAteChegar(
  track: TrackDto,
  remota: string,
  url: string,
  manterVivo: () => boolean,
): Promise<Lyrics | null> {
  const trackId = track.id;
  let tentativas = 0;
  let procurouCedo = false;
  const limite = Date.now() + 10 * 60_000;
  while (manterVivo()) {
    const r = await buscarTempo(url);
    if (r.tipo === 'pronto') {
      // Antes de a transcrição virar letra: a letra de verdade existe em algum
      // lugar com outro artista/duração? A voz decide.
      if (!letraPublicada(cachedLyrics(trackId))) {
        const confirmada = await letraConfirmadaPelaVoz(track, r.words);
        if (confirmada) return usarLetraConfirmada(trackId, remota, confirmada, manterVivo);
      }
      const atual = letraPublicada(cachedLyrics(trackId));
      // Letra em cache: reancora nela. Sem letra nenhuma: a transcrição vira
      // a própria letra (rotulada — ver palavrasEmLinhas/recalibrar.ts).
      const ouvidas = atual ? null : transcricaoConfiavel(r.words);
      const nova: Lyrics | null = atual
        ? recalibrarLetra(atual, r.words)
        : ouvidas
          ? { synced: true, lines: palavrasEmLinhas(ouvidas), source: TRANSCRICAO_AUTOMATICA }
          : null;
      if (!nova || nova.lines.length === 0) return null;
      const pronta: LetraAlinhada = {
        ...nova,
        calibrada: true,
        alinhada: true,
        procuradaPelaVoz: true,
      };
      writeLyrics(trackId, pronta);
      return pronta;
    }
    if (r.tipo !== 'esperar') return null;
    // CEDO: com o começo da música já ouvido, procura a letra de verdade — se a
    // voz a confirmar, ela chega em segundos em vez de ao fim da transcrição.
    if (
      !procurouCedo &&
      r.parcial &&
      palavrasOuvidas(r.parcial.words).length >= OUVIDAS_PARA_CONFIRMAR
    ) {
      procurouCedo = true;
      const confirmada = await letraConfirmadaPelaVoz(track, r.parcial.words);
      if (confirmada && manterVivo()) {
        return usarLetraConfirmada(trackId, remota, confirmada, manterVivo);
      }
    }
    // Transcrevendo: a tela mostra as palavras chegando — pergunta a cada 3 s e
    // não gasta o orçamento de tentativas (a música inteira leva minutos).
    publicar(trackId, {
      fase: r.processando ? 'transcrevendo' : 'na-fila',
      ...(r.parcial ? { parcial: r.parcial } : {}),
    });
    if (!r.processando && ++tentativas >= TENTATIVAS_MAX) return null;
    if (Date.now() > limite) return null;
    await new Promise((resolve) => setTimeout(resolve, r.processando ? AO_VIVO_MS : INTERVALO_MS));
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
/** Pede o alinhamento da letra conhecida até ele chegar (ou desistir). */
async function alinharAteChegar(
  trackId: string,
  url: string,
  letra: Lyrics,
  manterVivo: () => boolean,
): Promise<Lyrics | null> {
  const indices = linhasParaAlinhar(letra);
  const textos = indices.map((i) => letra.lines[i]?.text ?? '');
  if (textos.length === 0) return null;
  let tentativas = 0;
  while (manterVivo()) {
    const r = await buscarAlinhamento(url, textos);
    if (r.tipo === 'pronto') {
      const nova = aplicarAlinhamento(letra, indices, r.linhas);
      // Alinhamento fraco: fica a letra como estava (e não se pergunta de novo).
      const pronta: LetraAlinhada = { ...(nova ?? letra), calibrada: true, alinhada: true };
      writeLyrics(trackId, pronta);
      return pronta;
    }
    if (r.tipo !== 'esperar' || ++tentativas >= TENTATIVAS_MAX) return null;
    publicar(trackId, { fase: 'alinhando' });
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
  }
  return null;
}

export function pedirCalibracao(
  track: TrackDto,
  manterVivo: () => boolean = () => true,
): Promise<Lyrics | null> {
  const emAndamento = emVoo.get(track.id);
  if (emAndamento) return emAndamento;

  const emCache = cachedLyrics(track.id);
  // `alinhada`, e não só `calibrada`: a calibração antiga (reconhecimento livre
  // com o modelo `base`) errava com sotaque e autotune e deixava a letra no
  // lugar errado — ela é refeita UMA vez pelo alinhamento.
  // Transcrição guardada antes da busca pela voz existir: passa por ela uma vez.
  if (
    emCache?.calibrada &&
    (emCache as LetraAlinhada).alinhada &&
    emCache.source !== TRANSCRICAO_ANTIGA &&
    !(emCache.source === TRANSCRICAO_AUTOMATICA && !(emCache as LetraAlinhada).procuradaPelaVoz)
  ) {
    return Promise.resolve(emCache);
  }

  // Preview de 30s (Apple) nunca casa com o tempo da música inteira.
  if (track.previewOnly) return Promise.resolve(null);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(null);

  const promessa = (async (): Promise<Lyrics | null> => {
    // O IDIOMA DEPENDE DA LETRA, e no começo da faixa ela ainda não chegou
    // (o prefetch sai no mesmo instante). Escolher sem ela mandava música em
    // inglês para o whisper local (~50 s) em vez do Riva (~5 s) — e para um
    // cache diferente do que a tela de letra pede. A busca é a mesma do
    // prefetch: já em cache ou em voo, custa quase nada.
    const achada = emCache ?? (await fetchLyrics(track).catch(() => null));
    // A "Transcrição do áudio" do caminho antigo NÃO é letra: é texto que o
    // reconhecimento livre inventou. Tratá-la como publicada seria alinhar a
    // invenção. Vale como "sem letra".
    const letra = letraPublicada(achada);
    // O LINK DO COFRE também pode não existir ainda: a entrada do acervo chega
    // magra e ganha `remoteUrl` no detalhe, buscado no caminho do play.
    if (!remoteUrlFor(track.id) && !track.streamUrl) {
      await garantirDetalhe(track.id).catch(() => false);
    }
    const remota = remoteUrlFor(track.id) ?? track.streamUrl ?? null;
    if (!remota || !manterVivo()) return null;
    // COM LETRA PUBLICADA: alinhamento forçado — o texto é o da letra, só o
    // relógio vem do áudio. Nunca inventa palavra. SEM LETRA: transcrição, e
    // só com o que o modelo ouviu com confiança (ver `transcricaoConfiavel`).
    if (letra && letra.lines.length > 0) {
      const url = urlDoAlinhamento(remota, idiomaPara(letra));
      return url ? alinharAteChegar(track.id, url, letra, manterVivo) : null;
    }
    const url = urlDoTempo(remota, idiomaPara(null));
    return url ? perguntarAteChegar(track, remota, url, manterVivo) : null;
  })()
    .catch(() => null)
    .finally(() => {
      emVoo.delete(track.id);
      publicar(track.id, null);
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
