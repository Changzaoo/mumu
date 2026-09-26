import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MicVocal } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { cachedLyrics, fetchLyrics } from '@/lib/lyrics/lyrics';
import { linhaAtiva, palavraAtiva, palavrasDaLinha } from '@/lib/lyrics/karaoke';
import { syncLyricsFromAudio, transcribeToLyrics } from '@/lib/lyrics/syncFromAudio';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** Sem antecipação artificial: evita letra "adiantada" perceptivelmente. */
const LEAD_MS = 0;

/**
 * Escala, opacidade e desfoque por DISTÂNCIA da linha cantada. Transform e
 * opacidade ficam no compositor — não refazem layout, então a lista não pula
 * quando a linha ativa troca.
 */
function estiloDeProfundidade(distancia: number): {
  style: CSSProperties;
  desfoca: boolean;
} {
  const escala = [1, 0.82, 0.74, 0.68][Math.min(distancia, 3)] as number;
  const opacidade = [1, 0.55, 0.32, 0.18][Math.min(distancia, 3)] as number;
  const desfoque = distancia >= 2 ? Math.min(distancia - 1, 2) * 0.6 : 0;
  return {
    style: {
      transform: `scale(${escala})`,
      opacity: opacidade,
      ...(desfoque > 0 ? { filter: `blur(${desfoque}px)` } : {}),
    },
    desfoca: desfoque > 0,
  };
}

export interface LyricsViewProps {
  track: TrackDto;
  className?: string;
}

/**
 * Letra sincronizada: a linha cantada em primeiro plano, a palavra cantada em
 * destaque, e as vizinhas menores e mais apagadas conforme se afastam.
 * Clicar numa linha leva a música até ela (só letra sincronizada).
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

  // ONDE A VOZ ESTÁ — linha e palavra. A posição REAL do engine é amostrada a
  // cada quadro (a do store é estrangulada a ~5/s e chega ~200 ms atrasada),
  // mas o estado só muda quando a linha ou a palavra MUDA: antes cada quadro
  // re-renderizava a letra inteira, 60 vezes por segundo, e num celular fraco
  // o próprio destaque atrasava. Só a faixa que está tocando é acompanhada.
  const synced = Boolean(lyrics?.synced) && isCurrent;
  const palavrasPorLinha = useMemo(
    () =>
      lyrics?.synced
        ? lyrics.lines.map((linha, i) =>
            palavrasDaLinha(linha, lyrics.lines[i + 1]?.timeMs ?? null),
          )
        : [],
    [lyrics],
  );
  const [ativa, setAtiva] = useState({ linha: -1, palavra: -1 });
  useEffect(() => {
    if (!synced || !lyrics) {
      setAtiva({ linha: -1, palavra: -1 });
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const posMs = audioEngine.getPosition() * 1000 + LEAD_MS;
      const linha = linhaAtiva(lyrics.lines, posMs);
      const palavra = linha >= 0 ? palavraAtiva(palavrasPorLinha[linha] ?? [], posMs) : -1;
      setAtiva((atual) =>
        atual.linha === linha && atual.palavra === palavra ? atual : { linha, palavra },
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced, isPlaying, track.id, lyrics, palavrasPorLinha]);
  const activeIndex = ativa.linha;

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
        // PROFUNDIDADE: quanto mais longe da linha cantada, menor, mais
        // apagada e mais desfocada — a atual fica em primeiro plano. Antes da
        // primeira linha, a primeira é a "próxima" (distância 1).
        const distancia = synced
          ? activeIndex < 0
            ? index + 1
            : Math.abs(index - activeIndex)
          : null;
        const profundidade = distancia === null ? null : estiloDeProfundidade(distancia);
        const palavras = active ? (palavrasPorLinha[index] ?? []) : [];
        return (
          <button
            key={`${line.timeMs}-${index}`}
            ref={active ? activeRef : undefined}
            type="button"
            disabled={!lyrics.synced}
            onClick={() => seek(line.timeMs / 1000)}
            aria-current={active ? 'true' : undefined}
            style={profundidade?.style}
            className={cn(
              'block w-full origin-left rounded-lg px-3 py-2 text-left text-2xl font-bold tracking-tight sm:text-3xl',
              // Encolher/crescer anima; a COR não — o destaque tem que trocar
              // no instante da voz, não 200 ms depois.
              'transition-[transform,opacity,filter] duration-500 ease-out motion-reduce:transition-none',
              lyrics.synced && 'cursor-pointer hover:bg-fg/5',
              profundidade?.desfoca && 'letra-desfoque',
              distancia === null ? 'text-fg-muted/80' : active ? 'text-fg' : 'text-fg-muted',
            )}
          >
            {active && palavras.length > 0 ? (
              <span>
                {palavras.map((palavra, i) => {
                  const cantada = i < ativa.palavra;
                  const agora = i === ativa.palavra;
                  return (
                    <span key={`${palavra.timeMs}-${i}`}>
                      <span
                        className={cn(
                          // Ênfase por ELEVAÇÃO e brilho, não por escala: crescer a palavra a
                          // fazia invadir o espaço da vizinha ("Ascachorra").
                          'inline-block transition-transform duration-150 ease-out motion-reduce:transition-none',
                          agora
                            ? 'letra-palavra-agora -translate-y-0.5 text-fg'
                            : cantada
                              ? 'text-fg'
                              : 'text-fg-muted/70',
                        )}
                      >
                        {palavra.text}
                      </span>
                      {i < palavras.length - 1 ? ' ' : ''}
                    </span>
                  );
                })}
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
