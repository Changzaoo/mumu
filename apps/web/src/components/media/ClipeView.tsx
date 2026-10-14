import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Music } from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { audioEngine } from '@/lib/audio/AudioEngine';
import {
  decidir,
  estadoInicial,
  idDoVideo,
  ADIANTO_DO_OUVIDO_S,
  LIMITE_S,
} from '@/lib/clipe/sincronia';
import { acoplarPlayer, criarIframeDoClipe, ESTADO, type YtPlayer } from '@/lib/clipe/youtubeApi';
import { clipeAlternativo, MAX_TENTATIVAS } from '@/lib/clipe/clipeAlternativo';
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
 * ── O QUE FAZ SER RÁPIDO ──
 *
 * 1. O iframe do embed é criado NO CLIQUE, direto no DOM, antes de a API do
 *    YouTube chegar (ver `lib/clipe/youtubeApi`). O vídeo começa a baixar no
 *    primeiro instante; a API se acopla ao iframe quando estiver pronta.
 * 2. O vídeo aparece assim que está TOCANDO e não precisa de um salto grande
 *    (erro ≤ 1 s). O ajuste fino continua por baixo, com ele à vista — uma
 *    deriva de décimos num clipe mudo não se nota; um spinner de 4 s, sim.
 * 3. O link de origem (o `watch?v=`) já é buscado quando a tela cheia abre,
 *    então no clique o id do vídeo normalmente já está em mãos.
 *
 * ── QUANDO O OFICIAL NÃO ENTRA ──
 *
 * Clipe com embed desligado pelo dono (erro 101/150), vídeo removido, ou faixa
 * sem link de origem: o modo procura a MESMA música em outro vídeo que aceite
 * embed (ver `lib/clipe/clipeAlternativo`) e tenta os candidatos em ordem, no
 * mesmo player. Só depois de esgotá-los é que diz que não há clipe.
 *
 * A capa segura a tela até o vídeo estar tocando; na pausa do som, ela volta
 * (o embed pausado mostra a bandeja de "mais vídeos" do YouTube — a capa é
 * mais limpa). Na troca de faixa o clipe some antes, e a capa nova segura a
 * tela enquanto o clipe novo carrega no mesmo player (sem recriar o iframe).
 */
export function ClipeView({ track, className }: { track: TrackDto; className?: string }) {
  // 1. Qual vídeo? O link de origem da faixa (buscado no acervo se faltar) —
  //    e, se ele falhar ou não existir, a mesma música em outro vídeo.
  //    `undefined` = ainda escolhendo; `null` = não há clipe para esta faixa.
  const trackRef = useRef(track);
  trackRef.current = track;
  /** Vídeos desta faixa que já deram erro no player: não voltam. */
  const evitadosRef = useRef<{ trackId: string; ids: Set<string> }>({
    trackId: track.id,
    ids: new Set(),
  });
  /** Sobe a cada erro do YouTube: pede o próximo candidato. */
  const [tentativa, setTentativa] = useState(0);
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  useEffect(() => {
    if (evitadosRef.current.trackId !== track.id) {
      evitadosRef.current = { trackId: track.id, ids: new Set() };
    }
    const evitar = evitadosRef.current.ids;
    let vivo = true;
    void escolherVideo(trackRef.current, evitar).then((r) => {
      if (vivo) setEscolha({ trackId: track.id, tentativa, ...r });
    });
    return () => {
      vivo = false;
    };
  }, [track.id, track.sourceUrl, tentativa]);
  const videoId: string | null | undefined =
    escolha?.trackId === track.id && escolha.tentativa === tentativa ? escolha.videoId : undefined;
  const motivo = videoId === null ? escolha?.motivo : undefined;

  const tocando = usePlayerStore((s) => s.isPlaying);
  const [visivel, setVisivel] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  /** Falso depois de desmontar: um acoplamento que chega tarde é descartado. */
  const montadoRef = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const prontoRef = useRef(false);
  /** O que está carregado no player: o vídeo E a faixa a que ele pertence. */
  const carregadoRef = useRef<string | null>(null);
  const querRef = useRef<string | null>(null);
  const syncRef = useRef(estadoInicial());

  // 2. O iframe: criado uma vez, no clique; reaproveitado a cada faixa.
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

    if (iframeRef.current) {
      const p = playerRef.current;
      if (p && prontoRef.current && carregadoRef.current !== chave) {
        carregadoRef.current = chave;
        p.loadVideoById({ videoId, startSeconds: inicio });
        p.mute();
      }
      return; // a API ainda está acoplando — o onReady carrega o que se quer
    }
    if (!caixaRef.current) return;

    // O embed começa a baixar AGORA. A API vem em paralelo e se acopla depois.
    const iframe = criarIframeDoClipe(caixaRef.current, videoId, inicio);
    iframeRef.current = iframe;
    carregadoRef.current = chave;
    // A chave NÃO está presa a este `videoId`: a faixa pode trocar antes de a
    // API chegar, e o player que nasce tem que servir à faixa de agora — por
    // isso só o desmonte descarta, nunca a troca.
    void acoplarPlayer(iframe, {
      onReady: () => {
        if (!montadoRef.current) return;
        prontoRef.current = true;
        const ligar = (): void => {
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
        };
        // O `playerRef` é escrito quando o construtor devolve; se o pronto
        // chegar antes disso, espera a volta em vez de deixar o player mudo.
        if (playerRef.current) ligar();
        else window.setTimeout(ligar, 0);
      },
      onStateChange: () => conferir(),
      onError: () => {
        // Este vídeo não entra (embed desligado, removido…): risca e pede o
        // próximo candidato da mesma música. Esgotou: desiste de vez.
        const chave = carregadoRef.current;
        if (!chave) return;
        const [trackId, vid] = chave.split('|') as [string, string];
        if (trackId !== trackRef.current.id) return;
        setVisivel(false);
        evitadosRef.current.ids.add(vid);
        if (evitadosRef.current.ids.size >= MAX_TENTATIVAS) {
          setFalhou(true);
          return;
        }
        setTentativa((t) => t + 1);
      },
    })
      .then((p) => {
        if (!montadoRef.current) {
          p.destroy();
          return;
        }
        playerRef.current = p;
      })
      .catch(() => {
        if (montadoRef.current) setFalhou(true);
      });
  }, [track.id, videoId]);

  // Desmontou (saiu do modo): o iframe vai embora junto. O som nem percebe.
  useEffect(
    () => () => {
      montadoRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
      iframeRef.current?.remove();
      iframeRef.current = null;
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
    // Pausa de verdade (ou tela apagada): a capa volta. Um engasgo do áudio
    // só segura o vídeo — piscar a capa a cada buffer seria pior que o atraso.
    const pausado = !s.isPlaying || document.hidden;
    const audio = audioEngine.getPosition();
    const duracao = p.getDuration();

    // O clipe pode acabar antes do áudio (créditos cortados): a capa assume —
    // o embed que acabou desenha o botão de "assistir de novo" por cima.
    if (duracao > 0 && audio + ADIANTO_DO_OUVIDO_S >= duracao - 0.3) {
      setVisivel(false);
      return;
    }

    if (!somSaindo) {
      // Som parado: o vídeo para junto e a capa volta. Enquanto isso ele já
      // é posto onde o som está, para voltar no tempo quando o play chegar.
      if (estado === ESTADO.TOCANDO || estado === ESTADO.CARREGANDO) p.pauseVideo();
      else if (estado === ESTADO.PAUSADO) {
        const alvo = audio + ADIANTO_DO_OUVIDO_S;
        if (Math.abs(p.getCurrentTime() - alvo) > LIMITE_S) p.seekTo(alvo, true);
      }
      if (pausado) setVisivel(false);
      return;
    }
    if (estado !== ESTADO.TOCANDO) {
      // Pronto, pausado ou acabado com o som andando: o embed mostra o botão
      // grande de play do YouTube — a capa cobre até ele voltar a tocar.
      if (estado !== ESTADO.CARREGANDO) {
        setVisivel(false);
        p.playVideo();
      }
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
    // Tocando e sem salto pendente: aparece. O ajuste fino termina à vista.
    if (d.saltarPara === null) setVisivel(true);
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
      {/* A capa segura a tela até o clipe estar tocando — e volta na pausa. */}
      {track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          className={cn(
            'absolute inset-0 size-full object-cover transition-[filter,opacity] duration-500',
            visivel ? 'opacity-0' : 'opacity-100',
            esperando && 'blur-[2px] brightness-75',
          )}
        />
      ) : (
        <div
          className={cn(
            'absolute inset-0 grid place-items-center text-fg-subtle transition-opacity duration-500',
            visivel ? 'opacity-0' : 'opacity-100',
          )}
        >
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
          'transition-[opacity,scale] duration-500 ease-out will-change-[opacity,scale]',
          visivel ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0',
        )}
      >
        <div ref={caixaRef} className="size-full [&>iframe]:size-full [&>iframe]:border-0" />
      </div>

      {semClipe && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm text-white/85">
          <Clapperboard className="size-4" />
          {mensagemSemClipe(falhou, motivo)}
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

interface Escolha {
  trackId: string;
  tentativa: number;
  videoId: string | null;
  motivo?: 'login' | 'limite' | 'falha';
}

/**
 * O vídeo a mostrar para esta faixa, fora dos que já falharam: o de origem,
 * se ainda vale; senão a mesma música em outro vídeo, pela busca.
 */
async function escolherVideo(
  track: TrackDto,
  evitar: ReadonlySet<string>,
): Promise<Omit<Escolha, 'trackId' | 'tentativa'>> {
  const origem =
    idDoVideo(track.sourceUrl ?? localLibrary.sourceUrlFor(track.id)) ??
    idDoVideo(await origemDaFaixa(track.id).catch(() => null));
  if (origem && !evitar.has(origem)) return { videoId: origem };
  return clipeAlternativo(track, evitar);
}

function mensagemSemClipe(falhou: boolean, motivo: Escolha['motivo']): string {
  if (falhou) return 'Nenhum vídeo desta música pôde ser exibido aqui';
  if (motivo === 'login') return 'Entre na conta para procurar o clipe desta música';
  if (motivo === 'limite') return 'Muitas buscas agora — o clipe volta a procurar em um minuto';
  return 'Não achamos um clipe desta música';
}
