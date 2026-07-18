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
import { alignLyrics } from '@/lib/lyrics/align';
import { cachedLyrics, writeLyrics, type Lyrics } from '@/lib/lyrics/lyrics';
import { aiTranscribe } from '@/lib/local/importerHelper';
import { getAudioBlob } from '@/lib/offline/audioCache';
import { blobFor as localLibraryBlob } from '@/lib/local/localLibrary';

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

    const words = await aiTranscribe(audio);
    if (!words || words.length === 0) {
      failed.add(track.id);
      return null;
    }

    const aligned = alignLyrics(
      current.lines.map((l) => l.text),
      words,
    );
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
