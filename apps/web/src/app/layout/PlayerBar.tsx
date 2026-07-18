import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ListMusic,
  Maximize2,
  MicVocal,
  Music,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Fragment } from 'react';
import { LikeButton } from '@/components/media/LikeButton';
import { DevicePickerButton } from '@/components/media/DevicePicker';
import { PlayButton } from '@/components/media/PlayButton';
import { SeekSlider } from '@/components/media/SeekSlider';
import { IconButton } from '@/components/ui/icon-button';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX />;
  if (volume < 0.5) return <Volume1 />;
  return <Volume2 />;
}

/**
 * Fixed bottom player (DESIGN §7): 88px glass, 3 columns —
 * [art + track + like] [transport + seek] [queue/lyrics/EQ/volume/fullscreen].
 * Hidden until the first track, then springs up. Desktop only (≥768px).
 */
export function PlayerBar() {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const { toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat } =
    usePlayerStore.getState();

  const queueOpen = useUiStore((s) => s.queueOpen);
  const toggleQueue = useUiStore((s) => s.toggleQueue);
  const setNowPlayingOpen = useUiStore((s) => s.setNowPlayingOpen);
  const setLyricsOpen = useUiStore((s) => s.setLyricsOpen);
  const setActiveModal = useUiStore((s) => s.setActiveModal);

  return (
    <AnimatePresence>
      {track && (
        <motion.footer
          key="player-bar"
          initial={{ y: 96 }}
          animate={{ y: 0 }}
          exit={{ y: 96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="glass fixed inset-x-0 bottom-0 z-40 hidden h-[88px] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 rounded-none border-x-0 border-b-0 px-4 md:grid"
        >
          {/* Left — track identity */}
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-fg/6">
              {track.coverUrl ? (
                <img src={track.coverUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-fg-subtle">
                  <Music className="size-5" />
                </span>
              )}
            </span>
            <div className="min-w-0">
              {track.album ? (
                <Link
                  to={`/album/${track.album.id}`}
                  className="line-clamp-1 text-sm font-medium text-fg hover:underline"
                >
                  {track.title}
                </Link>
              ) : (
                <p className="line-clamp-1 text-sm font-medium text-fg">{track.title}</p>
              )}
              <p className="line-clamp-1 text-[13px] text-fg-muted">
                {track.artists.map((artist, i) => (
                  <Fragment key={artist.id}>
                    {i > 0 && ', '}
                    <Link to={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                      {artist.name}
                    </Link>
                  </Fragment>
                ))}
              </p>
            </div>
            {/* Like wiring belongs to the features layer — seam kept visible. */}
            <LikeButton liked={track.isLiked ?? false} className="ml-1" />
          </div>

          {/* Center — transport + seek */}
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <IconButton
                aria-label="Aleatório"
                size="sm"
                active={shuffle}
                onClick={toggleShuffle}
                className="relative"
              >
                <Shuffle />
                {shuffle && (
                  <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
                )}
              </IconButton>
              <IconButton aria-label="Anterior" onClick={prev}>
                <SkipBack className="fill-current" />
              </IconButton>
              {isBuffering ? (
                <span className="grid size-10 place-items-center">
                  <Spinner size="md" />
                </span>
              ) : (
                <PlayButton playing={isPlaying} onClick={toggle} />
              )}
              <IconButton aria-label="Próxima" onClick={next}>
                <SkipForward className="fill-current" />
              </IconButton>
              <IconButton
                aria-label={
                  repeat === 'off' ? 'Repetir' : repeat === 'all' ? 'Repetir uma' : 'Não repetir'
                }
                size="sm"
                active={repeat !== 'off'}
                onClick={cycleRepeat}
                className="relative"
              >
                {repeat === 'one' ? <Repeat1 /> : <Repeat />}
                {repeat !== 'off' && (
                  <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
                )}
              </IconButton>
            </div>
            <SeekSlider value={progress} duration={duration} buffered={buffered} onSeek={seek} />
          </div>

          {/* Right — utilities */}
          <div className="flex items-center justify-end gap-1">
            <IconButton
              aria-label="Letra"
              size="sm"
              onClick={() => {
                setLyricsOpen(true);
                setNowPlayingOpen(true);
              }}
            >
              <MicVocal />
            </IconButton>
            <IconButton
              aria-label="Equalizador"
              size="sm"
              onClick={() => setActiveModal('equalizer')}
            >
              <SlidersHorizontal />
            </IconButton>
            <IconButton aria-label="Fila" size="sm" active={queueOpen} onClick={toggleQueue}>
              <ListMusic />
            </IconButton>
            {/* Aparelhos: some sozinho quando a conta só tem este. */}
            <DevicePickerButton />
            <div className="hidden items-center gap-2 lg:flex">
              <IconButton
                aria-label={muted ? 'Ativar som' : 'Silenciar'}
                size="sm"
                onClick={toggleMute}
              >
                <VolumeIcon volume={volume} muted={muted} />
              </IconButton>
              <Slider
                aria-label="Volume"
                value={[muted ? 0 : Math.round(volume * 100)]}
                max={100}
                step={1}
                onValueChange={([v]) => setVolume((v ?? 0) / 100)}
                className="w-24"
              />
            </div>
            <IconButton
              aria-label="Tela cheia"
              size="sm"
              className={cn('ml-1')}
              onClick={() => setNowPlayingOpen(true)}
            >
              <Maximize2 />
            </IconButton>
          </div>
        </motion.footer>
      )}
    </AnimatePresence>
  );
}
