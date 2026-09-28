import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MicVocal } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { cachedLyrics, fetchLyrics, type Lyrics } from '@/lib/lyrics/lyrics';
import {
  ehTranscricao,
  pedirCalibracao,
  TRANSCRICAO_ANTIGA,
  TRANSCRICAO_AUTOMATICA,
  type LetraAlinhada,
} from '@/lib/lyrics/calibragem';
import { LetraSendoFeita, useLetraAoVivo } from '@/components/media/LetraSendoFeita';
import {
  linhaAtiva,
  palavraAtiva,
  palavrasDaLinha,
  palavrasDeFundo,
  trechosDaLinha,
} from '@/lib/lyrics/karaoke';
import { cn, formatDuration } from '@/lib/utils';
import { palavrasEmLinhas } from '@/lib/lyrics/recalibrar';
import { usePlayerStore } from '@/stores/playerStore';

/** Sem antecipação artificial: evita letra "adiantada" perceptivelmente. */
const LEAD_MS = 0;
/** Clicar numa palavra entra este tanto antes dela (o ataque da sílaba). */
const INICIO_DA_PALAVRA_MS = 60;
/** Confiança mínima para a palavra ouvida entrar na letra ao vivo. */
const CONFIANCA_AO_VIVO = 0.6;

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
  const { data: achada, isLoading } = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: () => fetchLyrics(track),
    // Já buscada quando a faixa começou (playerStore): aparece no primeiro quadro.
    initialData: () => cachedLyrics(track.id) ?? undefined,
    staleTime: Infinity,
    retry: false,
  });
  // A "Transcrição do áudio" do caminho antigo era texto inventado pelo
  // reconhecimento livre — não é letra, não aparece.
  const publicada = achada?.source === TRANSCRICAO_ANTIGA ? null : achada;
  const vivo = useLetraAoVivo(track.id);
  // A letra de verdade que a voz acabou de confirmar aparece JÁ, enquanto é
  // alinhada ao áudio — no lugar do vazio ou da transcrição.
  // A LETRA SENDO FEITA É LETRA DE VERDADE NA TELA: as palavras que o
  // importador já ouviu (com confiança) viram FRASES sincronizadas — a mesma
  // tela da letra publicada, com a linha e a palavra acendendo no tempo da
  // música. Antes era uma lista à parte, sem sincronia, e quando a
  // transcrição passava à frente da música nada acompanhava o que tocava.
  const parcial = vivo?.parcial;
  const letraAoVivo = useMemo<Lyrics | null>(() => {
    if (!parcial || parcial.words.length === 0) return null;
    const ouvidas = parcial.words.filter(
      (w) => w.prob === undefined || w.prob >= CONFIANCA_AO_VIVO,
    );
    const lines = palavrasEmLinhas(ouvidas);
    return lines.length > 0 ? { synced: true, lines, source: TRANSCRICAO_AUTOMATICA } : null;
  }, [parcial]);
  const transcrevendo = Boolean(letraAoVivo) && (!publicada || ehTranscricao(publicada));
  const lyrics =
    vivo?.letra && (!publicada || ehTranscricao(publicada))
      ? vivo.letra
      : transcrevendo
        ? letraAoVivo
        : publicada;

  const terminouBusca = !isLoading;
  // O CAMINHO ANTIGO FOI DESLIGADO: transcrever pelo aparelho (reconhecimento
  // livre, modelo pequeno) inventava letra com sotaque e autotune, e a gravava
  // no cache como se fosse a letra. Hoje a letra publicada é ALINHADA ao áudio
  // no importador e, sem letra nenhuma, a transcrição de lá só mostra o que o
  // modelo ouviu com confiança — ver lib/lyrics/calibragem.ts.

  // A LETRA NO RELÓGIO DO ÁUDIO. A letra publicada costuma ter sido
  // cronometrada para outra gravação (adiantada, ou acabando antes da música),
  // e muitas nem têm tempo. O importador calcula o instante de cada palavra
  // cantada no arquivo do cofre; aqui a letra é reancorada nele — uma vez por
  // faixa, guardado no cache. Enquanto o cálculo roda (até ~1 min em
  // português), a letra que já existe continua na tela.
  //
  // `pedirCalibracao` é o MESMO mecanismo que o playerStore já disparou
  // quando esta faixa começou a tocar (letra ainda fechada, ver
  // `aquecerCalibracao`/lib/lyrics/calibragem.ts) — se aquele pedido ainda
  // estiver em voo, este efeito reaproveita a mesma promessa em vez de abrir
  // um segundo laço de perguntas ao importador para a mesma faixa. Se já
  // tiver terminado, `writeLyrics` já deixou a versão calibrada no cache e o
  // guarda acima (`lyrics?.calibrada`) nem deixa este efeito rodar.
  useEffect(() => {
    if (!terminouBusca || !isCurrent || (lyrics as LetraAlinhada | undefined)?.alinhada) return;
    let cancelado = false;
    void pedirCalibracao(track).then((pronta) => {
      if (cancelado || !pronta) return;
      const naTela = queryClient.getQueryData<Lyrics | null>([
        'lyrics',
        track.id,
      ]) as LetraAlinhada | null;
      // Transcrição na tela perde para a letra de verdade que a voz confirmou.
      const jaTinha = naTela?.alinhada && !(ehTranscricao(naTela) && !ehTranscricao(pronta));
      if (!jaTinha) queryClient.setQueryData(['lyrics', track.id], pronta);
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma calibração por faixa
  }, [
    terminouBusca,
    isCurrent,
    track.id,
    Boolean((lyrics as LetraAlinhada | undefined)?.alinhada),
  ]);

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
    // PAUSADO NÃO GASTA QUADRO: `isPlaying` estava só nas dependências (para
    // reabrir o efeito), mas o laço em si nunca olhava para ele — pausar a
    // música deixava este rAF girando a 60/s para sempre, recalculando a
    // mesma linha/palavra sem nada de novo para mostrar. O mesmo desperdício
    // que `SpectrumVisualizer` já evita.
    if (!synced || !lyrics || !isPlaying) {
      if (!synced || !lyrics) setAtiva({ linha: -1, palavra: -1 });
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
    if (vivo && vivo.fase !== 'alinhando') {
      return <LetraSendoFeita vivo={vivo} duracaoMs={track.durationMs} className={className} />;
    }
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
      {transcrevendo && !vivo?.letra && (
        <div className="px-3 pb-3" aria-live="polite">
          <p className="text-sm font-semibold text-fg">
            <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-fg/70 align-middle" />
            Nosso time está transcrevendo a letra agora
          </p>
          {parcial && parcial.ouvidoMs > 0 && (
            <p className="text-xs text-fg-muted">
              Ouvindo a música… {formatDuration(parcial.ouvidoMs)} de{' '}
              {formatDuration(track.durationMs)}
            </p>
          )}
        </div>
      )}
      {vivo?.fase === 'alinhando' && (
        <p className="px-3 pb-2 text-xs text-fg-muted" aria-live="polite">
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-fg/70 align-middle" />
          Sincronizando a letra com a voz…
        </p>
      )}
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
        // TODAS as linhas sincronizadas vêm palavra a palavra — cada palavra é
        // um ponto de entrada na música (clicar leva ao instante dela), não só
        // a linha que está sendo cantada.
        const palavras = synced ? (palavrasPorLinha[index] ?? []) : [];
        const deFundo = palavras.length > 0 ? palavrasDeFundo(palavras) : [];
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
            {palavras.length > 0 ? (
              <span>
                {palavras.map((palavra, i) => {
                  const cantada = active && i < ativa.palavra;
                  const agora = active && i === ativa.palavra;
                  const fundo = deFundo[i];
                  return (
                    <span key={`${palavra.timeMs}-${i}`}>
                      <span
                        // CLICAR NA PALAVRA LEVA À PALAVRA — não ao começo da
                        // frase. Um fio antes do início dela (INICIO_DA_PALAVRA_MS)
                        // para o ataque da sílaba não ser cortado pelo seek.
                        onClick={(e) => {
                          e.stopPropagation();
                          const alvo = Math.max(line.timeMs, palavra.timeMs - INICIO_DA_PALAVRA_MS);
                          seek(alvo / 1000);
                        }}
                        className={cn(
                          'cursor-pointer rounded-sm hover:underline hover:decoration-2 hover:underline-offset-4',
                          // Ênfase por ELEVAÇÃO e brilho, não por escala: crescer a palavra a
                          // fazia invadir o espaço da vizinha ("Ascachorra").
                          'inline-block transition-transform duration-150 ease-out motion-reduce:transition-none',
                          !active
                            ? null
                            : agora
                              ? 'letra-palavra-agora -translate-y-0.5 text-fg'
                              : cantada
                                ? 'text-fg'
                                : 'text-fg-muted/70',
                          // Voz de fundo (entre parênteses): a cor vem da classe.
                          fundo && 'letra-fundo',
                          fundo && active && !agora && !cantada && 'letra-fundo-depois',
                        )}
                      >
                        {palavra.text}
                      </span>
                      {i < palavras.length - 1 ? ' ' : ''}
                    </span>
                  );
                })}
              </span>
            ) : line.text ? (
              trechosDaLinha(line.text).map((trecho, i) =>
                trecho.fundo ? (
                  <span key={i} className="letra-fundo">
                    {trecho.texto}
                  </span>
                ) : (
                  trecho.texto
                ),
              )
            ) : (
              '♪'
            )}
          </button>
        );
      })}
      {transcrevendo && !vivo?.letra && (
        // O que ainda não foi ouvido: a letra continua chegando aqui.
        <p className="px-3 py-2 text-2xl font-bold tracking-tight text-fg-muted/60 sm:text-3xl">
          <span className="inline-block animate-pulse">…</span>
        </p>
      )}
      {lyrics.source && (
        <p className="px-3 pt-6 text-[11px] text-fg-subtle">Fonte: {lyrics.source}</p>
      )}
    </div>
  );
}
