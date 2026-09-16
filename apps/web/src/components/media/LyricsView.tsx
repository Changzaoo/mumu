import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MicVocal } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { cachedLyrics, fetchLyrics } from '@/lib/lyrics/lyrics';
import { syncLyricsFromAudio, transcribeToLyrics } from '@/lib/lyrics/syncFromAudio';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Sem antecipação artificial: evita letra "adiantada" perceptivelmente. */
const LEAD_MS = 0;

export interface LyricsViewProps {
  track: TrackDto;
  className?: string;
}

/**
 * Synced lyrics pane (LRCLIB): active line highlighted + auto-scroll.
 * Click a line to seek (synced lyrics only).
 */
export function LyricsView({ track, className }: LyricsViewProps) {
  const seek = usePlayerStore((s) => s.seek);
  const isCurrent = usePlayerStore((s) => s.currentTrack?.id === track.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const queryClient = useQueryClient();
  // A LETRA APARECE COM O QUE JÁ EXISTE. Antes a consulta só terminava depois
  // de sincronizar pelo áudio (decodificar a faixa inteira) ou transcrever — a
  // letra já estava em mãos e a tela seguia no esqueleto por segundos. Agora a
  // consulta devolve a letra encontrada e o upgrade vem depois, trocando-a.
  const { data: lyrics, isLoading } = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: () => fetchLyrics(track),
    // Já buscada quando a faixa começou (playerStore): aparece no primeiro quadro.
    initialData: () => cachedLyrics(track.id) ?? undefined,
    staleTime: Infinity,
    retry: false,
  });

  const encontrada = lyrics;
  const terminouBusca = !isLoading;
  useEffect(() => {
    if (!terminouBusca || encontrada?.synced) return;
    let cancelado = false;
    void (async () => {
      // Letra sem tempo: tenta ganhar sincronia pelo áudio do aparelho.
      // Nenhuma letra publicada: transcreve, rotulado como transcrição.
      const melhor = encontrada
        ? await syncLyricsFromAudio(track).catch(() => null)
        : await transcribeToLyrics(track).catch(() => null);
      if (!cancelado && melhor) queryClient.setQueryData(['lyrics', track.id], melhor);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma tentativa por faixa
  }, [terminouBusca, Boolean(encontrada), track.id]);

  // Karaokê fluido: a posição do STORE é throttled a ~5/s (passos visíveis e
  // ~200ms atrasados). Amostramos a posição REAL do engine por rAF — mas só da
  // faixa que está tocando, para não destacar linha na letra de outra faixa.
  const [positionMs, setPositionMs] = useState(0);
  const synced = Boolean(lyrics?.synced) && isCurrent;
  useEffect(() => {
    if (!synced) return;
    let raf = 0;
    const tick = (): void => {
      setPositionMs(audioEngine.getPosition() * 1000 + LEAD_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, isPlaying, track.id]);

  const activeIndex = useMemo(() => {
    if (!synced || !lyrics) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if ((lyrics.lines[i]?.timeMs ?? Infinity) <= positionMs) index = i;
      else break;
    }
    return index;
  }, [synced, lyrics, positionMs]);

  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  if (isLoading) {
    return (
      <div className={cn('space-y-4 py-6', className)}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
        ))}
      </div>
    );
  }

  if (!lyrics || lyrics.lines.length === 0) {
    return (
      <EmptyState
        icon={MicVocal}
        title="Sem letra disponível"
        description="Não encontramos a letra desta faixa."
        className={className}
      />
    );
  }

  return (
    <div
      className={cn('no-scrollbar h-full space-y-1 overflow-y-auto py-8', className)}
      aria-label="Letra da música"
    >
      {lyrics.lines.map((line, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${line.timeMs}-${index}`}
            ref={active ? activeRef : undefined}
            type="button"
            disabled={!lyrics.synced}
            onClick={() => seek(line.timeMs / 1000)}
            className={cn(
              'block w-full rounded-lg px-3 py-2 text-left text-xl font-semibold tracking-tight transition-colors duration-200',
              lyrics.synced && 'cursor-pointer hover:bg-fg/5',
              active ? 'text-fg' : 'text-fg-muted/60',
            )}
          >
            {/* Linha ativa COM tempo por palavra: o destaque anda junto com a
                voz. Sem isso a linha inteira acende de uma vez e fica quatro
                segundos parada, sempre um pouco fora do que está sendo cantado.
                As demais linhas seguem como texto simples — animar o que não
                está sendo cantado só custa renderização. */}
            {active && line.words && line.words.length > 0 ? (
              <span>
                {line.words.map((palavra, i) => (
                  <span
                    key={`${palavra.timeMs}-${i}`}
                    className={cn(
                      'transition-colors duration-150',
                      positionMs >= palavra.timeMs ? 'text-fg' : 'text-fg-muted/50',
                    )}
                  >
                    {palavra.text}
                    {i < line.words!.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </span>
            ) : (
              line.text || '♪'
            )}
          </button>
        );
      })}
      {lyrics.source && (
        <p className="px-3 pt-6 text-[11px] text-fg-subtle">Fonte: {lyrics.source}</p>
      )}
    </div>
  );
}
