import { AnimatePresence, motion } from 'framer-motion';
import { MonitorSpeaker, Music, Pause, Play, SkipForward } from 'lucide-react';
import { LikeButton } from '@/components/media/LikeButton';
import { useTrackLikes } from '@/features/library/api';
import { useNowPlaying, useNowPlayingProgress } from '@/lib/devices/useNowPlaying';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * O FIO DE PROGRESSO, ISOLADO.
 *
 * Ele é a única coisa aqui que muda cinco vezes por segundo. Sozinho num
 * componente-folha, o React repinta uma <div> de 2px em vez do mini player
 * inteiro — que carrega arrasto do framer-motion e um `AnimatePresence`.
 * Mesmo motivo do `PlayerSeek` na barra grande. Ver `useNowPlayingProgress`.
 */
function MiniProgress() {
  const { progress, duration } = useNowPlayingProgress();
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-fg/10">
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * 64px mini player docked above the mobile tabs (<768px).
 * Hairline progress at the bottom edge; tap opens NowPlaying.
 */
export function MiniPlayer() {
  // Mostra o que toca aqui OU em outro aparelho, sem distinção — só o nome do
  // aparelho aparece quando é remoto. Ver `useNowPlaying`.
  const np = useNowPlaying();
  const localTrack = usePlayerStore((s) => s.currentTrack);
  const setNowPlayingOpen = useUiStore((s) => s.setNowPlayingOpen);
  const likes = useTrackLikes();

  const track = np;
  const isPlaying = np?.isPlaying ?? false;
  const toggle = np?.toggle ?? (() => undefined);
  const next = np?.next ?? (() => undefined);
  const prev = np?.prev ?? (() => undefined);
  const artistas = np?.artists.map((a) => a.name).join(', ') ?? '';

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          key="mini-player"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          // COLADO NAS ABAS. A altura era `4.5rem + env + 0.5rem`, mas a barra
          // de abas mede 4rem: sobravam 1rem de vão entre as duas, e por ele
          // aparecia a página passando — a "brecha esquisita".
          //
          // Agora o fundo é exatamente a altura das abas, e só os cantos de
          // CIMA são arredondados: as duas peças leem como um bloco só, que é o
          // que a borda inferior arredondada contrariava mesmo sem vão nenhum.
          className="glass-strong fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 h-16 overflow-hidden rounded-b-none rounded-t-xl border-x-0 md:hidden"
        >
          {/* Swipe lateral (Spotify): arrastar para a ESQUERDA pula para a
              próxima, para a DIREITA volta — solta e o card volta ao lugar. */}
          <motion.div
            className="flex h-full items-center gap-3 px-3"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (info.offset.x < -60 || info.velocity.x < -400) next();
              else if (info.offset.x > 60 || info.velocity.x > 400) prev();
            }}
          >
            <button
              type="button"
              aria-label="Abrir reprodução em tela cheia"
              onClick={() => setNowPlayingOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="relative size-11 shrink-0 overflow-hidden rounded-sm bg-fg/6">
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center text-fg-subtle">
                    <Music className="size-4" />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="line-clamp-1 text-sm font-medium text-fg">{track.title}</span>
                <span className="line-clamp-1 text-xs text-fg-muted">
                  {track.source === 'remote' && track.deviceName ? (
                    <span className="flex items-center gap-1 text-accent">
                      <MonitorSpeaker className="size-3 shrink-0" />
                      <span className="truncate">
                        {track.deviceName}
                        {artistas ? ` · ${artistas}` : ''}
                      </span>
                    </span>
                  ) : (
                    artistas
                  )}
                </span>
              </span>
            </button>
            {track.source === 'local' && localTrack && (
              <LikeButton
                liked={likes.isLiked(localTrack)}
                onToggle={(liked) => likes.toggle(localTrack, liked)}
                className="shrink-0"
              />
            )}
            <button
              type="button"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              onClick={toggle}
              className="grid size-10 shrink-0 place-items-center rounded-full text-fg active:scale-95"
            >
              {isPlaying ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="ml-0.5 size-5 fill-current" />
              )}
            </button>
            <button
              type="button"
              aria-label="Próxima"
              onClick={next}
              className="grid size-10 shrink-0 place-items-center rounded-full text-fg-muted active:scale-95"
            >
              <SkipForward className="size-5 fill-current" />
            </button>
          </motion.div>
          <MiniProgress />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
