import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Music } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { decidir, estadoInicial, idDoVideo, ADIANTO_DO_OUVIDO_S } from '@/lib/clipe/sincronia';
import { carregarYoutube, ESTADO, type YtPlayer } from '@/lib/clipe/youtubeApi';
import { origemDaFaixa } from '@/lib/local/detalheDaFaixa';
import * as localLibrary from '@/lib/local/localLibrary';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** De quanto em quanto tempo o vídeo é conferido contra o som. */
const BATIDA_MS = 250;

/**
 * MODO CLIPE — o vídeo do YouTube da faixa, mudo, casado com o som do app.
 *
 * O som não sai daqui: o player continua tocando o áudio dele, e este
 * componente só mostra a imagem, perseguindo `audioEngine.getPosition()` (ver
 * `lib/clipe/sincronia`). Entrar e sair do modo não interrompe nada.
 *
 * A capa fica por baixo até o vídeo estar TOCANDO e no tempo; só então ele
 * aparece, num fade. Na troca de faixa ele some antes, e a capa nova segura a
 * tela enquanto o clipe novo carrega no mesmo player (sem recriar o iframe).
 */
export function ClipeView({ track, className }: { track: TrackDto; className?: string }) {
  // 1. Qual vídeo? O link de origem da faixa — buscado no acervo se faltar.
  //    `undefined` = ainda buscando; `null` = a faixa não veio do YouTube.
  const direto = useMemo(
    () => idDoVideo(track.sourceUrl ?? localLibrary.sourceUrlFor(track.id)),
    [track.id, track.sourceUrl],
  );
  const [buscado, setBuscado] = useState<{ trackId: string; id: string | null } | null>(null);
  useEffect(() => {
    if (direto) return;
    let vivo = true;
    void origemDaFaixa(track.id)
      .catch(() => null)
      .then((url) => {
        if (vivo) setBuscado({ trackId: track.id, id: idDoVideo(url) });
      });
    return () => {
      vivo = false;
    };
  }, [track.id, direto]);
  const videoId: string | null | undefined =
    direto ?? (buscado?.trackId === track.id ? buscado.id : undefined);

  const tocando = usePlayerStore((s) => s.isPlaying);
  const [visivel, setVisivel] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const prontoRef = useRef(false);
  /** O que está carregado no player: o vídeo E a faixa a que ele pertence. */
  const carregadoRef = useRef<string | null>(null);
  const querRef = useRef<string | null>(null);
  const syncRef = useRef(estadoInicial());

  // 2. O player: criado uma vez, reaproveitado a cada faixa.
  useEffect(() => {
    setVisivel(false);
    setFalhou(false);
    if (!videoId) {
      // Faixa nova ainda sem vídeo: o antigo não pode seguir o som novo.
      querRef.current = null;
      carregadoRef.current = null;
      playerRef.current?.pauseVideo();
      return;
    }
    const chave = `${track.id}|${videoId}`;
    querRef.current = chave;
    // Mantém a correção aprendida: o atraso do salto é da rede, não da faixa.
    syncRef.current = estadoInicial(syncRef.current.compensacao);
    const inicio = Math.max(0, audioEngine.getPosition() + ADIANTO_DO_OUVIDO_S);

    if (playerRef.current) {
      if (prontoRef.current && carregadoRef.current !== chave) {
        carregadoRef.current = chave;
        playerRef.current.loadVideoById({ videoId, startSeconds: inicio });
        playerRef.current.mute();
      }
      return; // ainda criando — o onReady carrega o que se quer
    }

    let vivo = true;
    void carregarYoutube()
      .then((YT) => {
        if (!vivo || !caixaRef.current || playerRef.current) return;
        // O YouTube TROCA o elemento pelo iframe; um nó que o React não conhece
        // evita brigar com a reconciliação.
        const alvo = document.createElement('div');
        caixaRef.current.appendChild(alvo);
        carregadoRef.current = chave;
        playerRef.current = new YT.Player(alvo, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            start: Math.floor(inicio),
          },
          events: {
            onReady: () => {
              prontoRef.current = true;
              const p = playerRef.current;
              if (!p) return;
              p.mute();
              // A faixa pode ter trocado enquanto o player nascia.
              const quer = querRef.current;
              if (quer && quer !== carregadoRef.current) {
                carregadoRef.current = quer;
                p.loadVideoById({
                  videoId: quer.split('|')[1] as string,
                  startSeconds: audioEngine.getPosition() + ADIANTO_DO_OUVIDO_S,
                });
              }
              conferir();
            },
            onStateChange: () => conferir(),
            onError: () => {
              setFalhou(true);
              setVisivel(false);
            },
          },
        });
      })
      .catch(() => setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [track.id, videoId]);

  // Desmontou (saiu do modo): o iframe vai embora junto. O som nem percebe.
  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      prontoRef.current = false;
      carregadoRef.current = null;
    },
    [],
  );

  // 3. A perseguição: o vídeo vai atrás do som, a cada batida.
  function conferir(): void {
    const p = playerRef.current;
    if (!p || !prontoRef.current || !querRef.current) return;
    if (carregadoRef.current !== querRef.current) return;
    const s = usePlayerStore.getState();
    const estado = p.getPlayerState();
    const somSaindo = s.isPlaying && !s.isBuffering && !document.hidden;
    const audio = audioEngine.getPosition();
    const duracao = p.getDuration();

    // O clipe pode acabar antes do áudio (créditos cortados): fica no último quadro.
    if (duracao > 0 && audio + ADIANTO_DO_OUVIDO_S >= duracao - 0.3) return;

    if (!somSaindo) {
      if (estado === ESTADO.TOCANDO || estado === ESTADO.CARREGANDO) p.pauseVideo();
      return;
    }
    if (estado !== ESTADO.TOCANDO) {
      if (estado !== ESTADO.CARREGANDO) p.playVideo();
      return;
    }

    const d = decidir(syncRef.current, {
      video: p.getCurrentTime(),
      audio,
      agora: performance.now(),
    });
    syncRef.current = d.estado;
    if (d.saltarPara !== null) p.seekTo(d.saltarPara, true);
    // A velocidade do som (o menu 1,25×…) vezes o ajuste fino da perseguição.
    const rate = (s.playbackRate > 0 ? s.playbackRate : 1) * d.ritmo;
    if (Math.abs(p.getPlaybackRate() - rate) > 0.01) p.setPlaybackRate(rate);
    if (d.casado) setVisivel(true);
  }

  useEffect(() => {
    const t = window.setInterval(conferir, BATIDA_MS);
    // Play/pause/troca de faixa: confere na hora, sem esperar a batida.
    const sair = usePlayerStore.subscribe((s, antes) => {
      if (s.isPlaying !== antes.isPlaying || s.isBuffering !== antes.isBuffering) conferir();
    });
    const aoVoltar = (): void => conferir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(t);
      sair();
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  const semClipe = videoId === null || falhou;
  const esperando = !semClipe && !visivel && tocando;

  return (
    <div className={cn('relative overflow-hidden bg-black', className)}>
      {/* A capa segura a tela até o clipe estar no tempo. */}
      {track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          className={cn(
            'absolute inset-0 size-full object-cover transition-[filter,opacity] duration-700',
            visivel ? 'opacity-0' : 'opacity-100',
            esperando && 'blur-[2px] brightness-75',
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-fg-subtle">
          <Music className="size-16" />
        </div>
      )}

      {/* O vídeo PREENCHE o quadro da capa, como capa: 16:9 centrado e mais
          alto que a caixa, cortando as laterais. O corte de cima e de baixo
          some com o título e os botões do YouTube. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 left-1/2 aspect-video h-[135%] -translate-x-1/2 -translate-y-1/2',
          'transition-[opacity,scale] duration-700 ease-out will-change-[opacity,scale]',
          visivel ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
        )}
      >
        <div ref={caixaRef} className="size-full [&>iframe]:size-full" />
      </div>

      {semClipe && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm text-white/85">
          <Clapperboard className="size-4" />
          {falhou ? 'O clipe desta faixa não pode ser exibido aqui' : 'Esta faixa não tem clipe'}
        </div>
      )}
      {esperando && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
    </div>
  );
}
