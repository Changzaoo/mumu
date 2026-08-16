/**
 * Sincroniza uma letra PLANA usando o próprio áudio da faixa.
 *
 * O LRCLIB tem letra sincronizada para os hits, mas para muita coisa só existe
 * a versão em texto corrido — e aí o karaokê simplesmente não funciona. Aqui
 * fechamos essa lacuna: transcrevemos o áudio (que já está no aparelho) só
 * para saber QUANDO cada palavra é cantada, e casamos esses tempos com o texto
 * que já sabemos estar certo (ver lib/lyrics/align).
 *
 * Princípios:
 * - O texto NUNCA vem do ASR. Transcrição de canto erra; a letra do LRCLIB não.
 * - Só roda com áudio LOCAL. Baixar a música de novo só para transcrever seria
 *   gastar a internet do usuário por um enfeite.
 * - Alinhamento fraco é rejeitado (align devolve null): karaokê fora de tempo
 *   é pior que karaokê nenhum.
 * - O resultado entra no MESMO cache das letras, então vale offline e para
 *   sempre — a transcrição acontece uma vez por faixa na vida.
 */
import type { TrackDto } from '@aurial/shared';
import { alignLinesToSegments, alignLyrics, spreadLinesOverSpan } from '@/lib/lyrics/align';
import {
  cachedLyrics,
  fetchLyrics,
  writeLyrics,
  type Lyrics,
  type LyricLine,
} from '@/lib/lyrics/lyrics';
import {
  aiTranscribe,
  type TranscribedSegment,
  type TranscribedWord,
} from '@/lib/local/importerHelper';
import { getAudioBlob } from '@/lib/offline/audioCache';
import { blobFor as localLibraryBlob } from '@/lib/local/localLibrary';

/**
 * Dica de idioma para o transcritor. Inglês → parakeet-tdt (tempo por PALAVRA,
 * o melhor karaokê). Qualquer outra coisa → 'multi', e o whisper detecta e
 * devolve tempo por LINHA. A detecção é grosseira DE PROPÓSITO: só precisa
 * separar "inglês" do resto (o acervo do dono é majoritariamente brasileiro).
 */
function dicaDeIdioma(texto: string): string {
  const t = texto.toLowerCase();
  // Acento é a marca mais forte de português (e de vários outros): não é inglês.
  if (/[ãõáâàéêíóôúüçñ]/.test(t)) return 'multi';
  const ingles = (
    t.match(
      /\b(the|you|and|is|to|of|in|it|my|me|we|your|are|this|that|with|for|on|be|don't|i'm|can't|love|baby|yeah)\b/g,
    ) ?? []
  ).length;
  const palavras = (t.match(/[a-z']+/g) ?? []).length || 1;
  // Densidade alta de stopwords inglesas = inglês; senão, deixa o whisper decidir.
  return ingles / palavras > 0.12 ? 'en' : 'multi';
}

/**
 * Quebra o BLOCO de texto de um segmento do whisper em linhas de letra.
 *
 * O whisper devolve ~30 s de canto como um texto corrido; letra se lê em
 * versos. Cortamos por pontuação forte e por um teto de palavras — o mesmo
 * critério de respiro do `palavrasEmLinhas`, mas sem tempo por palavra aqui.
 */
function quebrarEmLinhas(texto: string): string[] {
  const MAX_PALAVRAS = 8;
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual: string[] = [];
  const fechar = (): void => {
    if (atual.length > 0) linhas.push(atual.join(' '));
    atual = [];
  };
  for (const p of palavras) {
    atual.push(p);
    if (/[.?!;]$/.test(p) || atual.length >= MAX_PALAVRAS) fechar();
  }
  fechar();
  return linhas.filter((l) => /[\p{L}\p{N}]/u.test(l));
}

/**
 * Letra sincronizada por LINHA a partir dos segmentos do whisper — o caminho
 * pt-BR, para quando não existe letra publicada. Cada segmento vira versos
 * espalhados dentro da sua janela de ~30 s.
 */
function linhasDeSegmentos(segments: TranscribedSegment[]): LyricLine[] {
  const out: LyricLine[] = [];
  for (const seg of segments) {
    for (const l of spreadLinesOverSpan(quebrarEmLinhas(seg.text), seg.startMs, seg.endMs)) {
      out.push({ timeMs: l.timeMs, text: l.text });
    }
  }
  // Monotonicidade entre segmentos: o destaque nunca anda para trás.
  let last = 0;
  for (const l of out) {
    if (l.timeMs < last) l.timeMs = last;
    last = l.timeMs;
  }
  return out;
}

/** Faixas em processamento — evita transcrever a mesma coisa duas vezes. */
const inFlight = new Set<string>();
/** Faixas que já falharam nesta sessão: não insistir a cada abertura da letra. */
const failed = new Set<string>();

export function isSyncingLyrics(trackId: string): boolean {
  return inFlight.has(trackId);
}

/** Áudio da faixa NESTE aparelho, sem tocar a rede. */
async function localAudio(track: TrackDto): Promise<Blob | null> {
  const fromLibrary = await localLibraryBlob(track.id).catch(() => null);
  if (fromLibrary) return fromLibrary;
  return getAudioBlob(track.id).catch(() => null);
}

/**
 * Agrupa as palavras transcritas em LINHAS de letra.
 *
 * O ASR devolve palavra a palavra com carimbo de tempo; letra se lê em versos.
 * O corte é por respiro: pausa longa entre palavras é onde o verso acaba de
 * verdade. O limite de palavras existe para o caso de canto contínuo, em que
 * ninguém respira e a linha viraria um parágrafo.
 */
export function palavrasEmLinhas(words: TranscribedWord[]): LyricLine[] {
  const PAUSA_MS = 700;
  const MAX_PALAVRAS = 9;
  const linhas: LyricLine[] = [];
  let atual: TranscribedWord[] = [];

  const fechar = (): void => {
    if (atual.length === 0) return;
    const palavras = atual
      .map((w) => ({ text: w.text.trim(), timeMs: w.startMs }))
      .filter((w) => w.text.length > 0);
    const texto = palavras.map((w) => w.text).join(' ');
    // Na transcrição o tempo por palavra é EXATO — veio direto do ASR, não de
    // interpolação. É a fonte mais precisa de sincronia que o app tem.
    if (texto) linhas.push({ timeMs: palavras[0]!.timeMs, text: texto, words: palavras });
    atual = [];
  };

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    const anterior = words[i - 1];
    const respiro = anterior ? w.startMs - anterior.startMs : 0;
    if (atual.length >= MAX_PALAVRAS || (anterior && respiro >= PAUSA_MS)) fechar();
    atual.push(w);
  }
  fechar();
  return linhas;
}

/**
 * Letra vinda da TRANSCRIÇÃO, para quando não existe letra publicada.
 *
 * A regra desta casa sempre foi "o texto nunca vem do ASR", porque transcrição
 * de canto erra e a letra do LRCLIB não. Ela continua valendo enquanto HOUVER
 * letra publicada. Mas para música pouco conhecida o LRCLIB não tem nada, e a
 * regra deixava o usuário com a tela vazia — que é pior que um texto com erro
 * declarado. Então: só quando não há alternativa, e sempre rotulada como
 * transcrição, para ninguém confundir com a letra oficial.
 */
export async function transcribeToLyrics(track: TrackDto): Promise<Lyrics | null> {
  if (inFlight.has(track.id) || failed.has(track.id)) return null;
  if (track.previewOnly) return null;
  if (cachedLyrics(track.id)) return null; // já há letra: não é caso para ASR

  inFlight.add(track.id);
  try {
    const audio = await localAudio(track);
    if (!audio) return null;

    // Sem letra publicada não há texto de referência para adivinhar o idioma:
    // 'multi' deixa o whisper detectar (pt-BR, o caso do acervo underground) e
    // ainda cobre inglês. Se voltar tempo por palavra, agrupamos por respiro;
    // se voltar por segmento (whisper), espalhamos as linhas na janela.
    const result = await aiTranscribe(audio, { language: 'multi' });
    const linhas = result?.words?.length
      ? palavrasEmLinhas(result.words)
      : result?.segments?.length
        ? linhasDeSegmentos(result.segments)
        : [];
    // Punhado de palavras soltas não é letra — é ruído de fundo transcrito.
    if (linhas.length < 4) {
      failed.add(track.id);
      return null;
    }

    const lyrics: Lyrics = {
      synced: true,
      lines: linhas,
      source: 'Transcrição automática',
    };
    writeLyrics(track.id, lyrics);
    return lyrics;
  } catch {
    failed.add(track.id);
    return null;
  } finally {
    inFlight.delete(track.id);
  }
}

/**
 * Tenta transformar a letra plana da faixa em letra sincronizada.
 * Devolve a letra sincronizada, ou null quando não deu (sem áudio local, sem
 * serviço, alinhamento fraco). Nunca lança.
 */
export async function syncLyricsFromAudio(track: TrackDto): Promise<Lyrics | null> {
  if (inFlight.has(track.id) || failed.has(track.id)) return null;

  const current = cachedLyrics(track.id);
  // Só faz sentido para letra que existe e NÃO tem tempo.
  if (!current || current.synced || current.lines.length === 0) return null;
  // Preview de 30s nunca casa com a letra da música inteira.
  if (track.previewOnly) return null;

  inFlight.add(track.id);
  try {
    const audio = await localAudio(track);
    if (!audio) return null;

    // O TEXTO já é conhecido (LRCLIB) — usamos ele para escolher o motor:
    // inglês vai ao parakeet-tdt (tempo por palavra); o resto ao whisper
    // (tempo por linha).
    const textoDaLetra = current.lines.map((l) => l.text).join(' ');
    const result = await aiTranscribe(audio, { language: dicaDeIdioma(textoDaLetra) });
    const linhasDaLetra = current.lines.map((l) => l.text);
    // Palavra → alinhamento forçado por palavra (o melhor). Segmento → tempo de
    // LINHA distribuído pelas janelas de ~30 s do whisper.
    const aligned = result?.words?.length
      ? alignLyrics(linhasDaLetra, result.words)
      : result?.segments?.length
        ? alignLinesToSegments(linhasDaLetra, result.segments)
        : null;
    if (!aligned) {
      // Casou mal: provavelmente a letra é de outra gravação (ao vivo, remix)
      // ou o ASR não entendeu o idioma. Mantém a letra plana.
      failed.add(track.id);
      return null;
    }

    const synced: Lyrics = {
      synced: true,
      lines: aligned,
      // Fonte composta: o texto continua sendo do LRCLIB, o tempo é nosso.
      source: `${current.source ?? 'Letra'} + sincronia do áudio`,
    };
    writeLyrics(track.id, synced);
    return synced;
  } catch {
    failed.add(track.id);
    return null;
  } finally {
    inFlight.delete(track.id);
  }
}

// ── fila de fundo: toda faixa baixada ganha letra sincronizada ───
//
// Baixar uma playlist inteira dispararia uma transcrição por faixa AO MESMO
// TEMPO — uma rajada que derrubaria o importer e cozinharia o celular. A fila
// abaixo processa UMA por vez, com uma pausa entre elas, e sempre atrás da
// reprodução: sincronizar letra é enfeite, tocar música é o serviço.
const queue: TrackDto[] = [];
const queued = new Set<string>();
/** Faixas que furaram a fila por estarem tocando agora. */
const urgente = new Set<string>();
let draining = false;

/** Respiro entre transcrições — mantém o aparelho e o servidor confortáveis. */
const GAP_MS = 4_000;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const track = queue.shift();
      if (!track) continue;
      queued.delete(track.id);
      urgente.delete(track.id);
      // Offline não adianta: nem letra nem transcrição. Devolve à fila e para.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queue.unshift(track);
        queued.add(track.id);
        break;
      }
      try {
        // 1) garante o TEXTO (LRCLIB) — a letra publicada é sempre preferida;
        const lyrics = cachedLyrics(track.id) ?? (await fetchLyrics(track));
        if (!lyrics) {
          // 2) não existe letra publicada: transcrever é a única saída, e é
          //    melhor que a tela vazia que o usuário via até aqui.
          await transcribeToLyrics(track);
        } else if (!lyrics.synced) {
          // 3) tem texto, falta tempo: usa o áudio só para cronometrar.
          await syncLyricsFromAudio(track);
        }
      } catch {
        /* faixa problemática não pode travar a fila */
      }
      // Pausa só entre faixas de fundo. Se alguém furou a fila pedindo a letra
      // do que está tocando AGORA, esperar 4s é justamente o que não pode.
      if (queue.length > 0 && !urgente.has(queue[0]!.id)) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Enfileira a faixa para ganhar letra sincronizada — chamado assim que o áudio
 * fica disponível no aparelho (download concluído ou import). Não bloqueia
 * quem chamou e nunca lança.
 */
export function queueLyricsSync(track: TrackDto, opts: { agora?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (track.previewOnly) return; // prévia de 30s não casa com a letra inteira
  if (inFlight.has(track.id) || failed.has(track.id)) return;
  // Já tem letra COM tempo: não há o que ganhar.
  if (cachedLyrics(track.id)?.synced) return;

  if (queued.has(track.id)) {
    // Já estava na fila, mas agora é o que está tocando: promove para a frente
    // em vez de ignorar — era isso que fazia a letra da faixa atual esperar a
    // transcrição de uma playlist inteira baixada meia hora antes.
    if (opts.agora && !urgente.has(track.id)) {
      const at = queue.findIndex((t) => t.id === track.id);
      if (at > 0) queue.unshift(...queue.splice(at, 1));
      urgente.add(track.id);
    }
    return;
  }

  queued.add(track.id);
  if (opts.agora) {
    urgente.add(track.id);
    queue.unshift(track);
  } else {
    queue.push(track);
  }
  void drain();
}

/** Quantas faixas ainda esperando sincronia (para UI de progresso, se quisermos). */
export function pendingLyricsSyncs(): number {
  return queue.length + inFlight.size;
}
