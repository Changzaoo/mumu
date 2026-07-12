import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  ChevronDown,
  Gauge,
  ListMusic,
  MicVocal,
  Music,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Timer,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { WaveformDto } from '@aurial/shared';
import { LyricsView } from '@/components/media/LyricsView';
import { PlayButton } from '@/components/media/PlayButton';
import { SeekSlider } from '@/components/media/SeekSlider';
import { SpectrumVisualizer } from '@/components/media/SpectrumVisualizer';
import { WaveformSeeker } from '@/components/media/WaveformSeeker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Slider } from '@/components/ui/slider';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { cn, formatTime, trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

const SLEEP_OPTIONS = [15, 30, 45, 60] as const;
const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

function useWaveform(trackId: string | undefined) {
  return useQuery({
    queryKey: ['waveform', trackId],
    enabled: Boolean(trackId),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => (await api.get<WaveformDto>(`/tracks/${trackId as string}/waveform`)).data,
  });
}

/**
 * Theater mode (DESIGN §7): fullscreen sheet with ambient artwork glow,
 * waveform seek, transport, lyrics pane, spectrum visualizer, sleep timer
 * and playback-rate menus. Drag down to dismiss (mobile).
 */
export function NowPlaying() {
  const open = useUiStore((s) => s.nowPlayingOpen);
  const setOpen = useUiStore((s) => s.setNowPlayingOpen);
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const toggleLyrics = useUiStore((s) => s.toggleLyrics);
  const toggleQueue = useUiStore((s) => s.toggleQueue);
  const setActiveModal = useUiStore((s) => s.setActiveModal);

  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const context = usePlayerStore((s) => s.context);
  const { toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat, setRate } =
    usePlayerStore.getState();

  const sleepTimer = useSettingsStore((s) => s.sleepTimerMinutes);
  const setSleepTimer = useSettingsStore((s) => s.setSleepTimer);

  const [visualizer, setVisualizer] = useState(false);
  const isTouch = useMediaQuery('(pointer: coarse)');
  const dominant = useDominantColor(track?.coverUrl);
  const glow = track?.dominantColor ?? dominant ?? 'hsl(var(--accent))';
  const { data: waveform } = useWaveform(open ? track?.id : undefined);

  const sourceLabels: Record<string, string> = {
    album: 'do álbum',
    playlist: 'da playlist',
    artist: 'do artista',
    search: 'da busca',
    home: 'do início',
    library: 'da biblioteca',
    queue: 'da fila',
    radio: 'da rádio',
    podcast: 'do podcast',
    upload: 'dos seus uploads',
    recommendation: 'das recomendações',
  };

  return (
    <AnimatePresence>
      {open && track && (
        <motion.section
          key="now-playing"
          aria-label="Tocando agora"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          drag={isTouch ? 'y' : false} /* drag-to-dismiss only where it belongs */
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={(_event, info) => {
            if (info.offset.y > 140 || info.velocity.y > 600) setOpen(false);
          }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg"
        >
          {/* Ambient glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-24 -top-40 h-[60vh] opacity-25 blur-[120px]"
            style={{
              background: `radial-gradient(55% 60% at 50% 35%, ${glow} 0%, transparent 70%)`,
            }}
          />

          {/* Header */}
          <header className="relative z-10 flex h-16 shrink-0 items-center justify-between px-4 md:px-8">
            <IconButton aria-label="Fechar" onClick={() => setOpen(false)}>
              <ChevronDown />
            </IconButton>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
              Tocando {context ? (sourceLabels[context.source] ?? '') : ''}
            </p>
            <IconButton aria-label="Fila" onClick={toggleQueue}>
              <ListMusic />
            </IconButton>
          </header>

          {/* Body */}
          <div
            className={cn(
              'relative z-10 mx-auto grid w-full max-w-xl min-h-0 flex-1 grid-cols-1 gap-6 px-6 pb-6 md:px-10',
              lyricsOpen ? 'items-stretch' : 'items-center',
            )}
          >
            <div
              className={cn(
                'mx-auto flex w-full flex-col items-center gap-6',
                lyricsOpen && 'h-full min-h-0',
              )}
            >
              {/* Artwork / visualizer / lyrics (lyrics replaces the cover so the
                  transport + the "Letra" toggle below stay reachable). */}
              <div
                className={cn(
                  'relative overflow-hidden rounded-xl bg-fg/6 shadow-2xl',
                  lyricsOpen && !visualizer
                    ? 'min-h-0 w-full flex-1'
                    : 'aspect-square w-[min(70vw,340px)]',
                )}
              >
                {visualizer ? (
                  <div className="absolute inset-0 grid place-items-end bg-bg-elevated p-6">
                    <SpectrumVisualizer className="h-3/4" />
                  </div>
                ) : lyricsOpen ? (
                  <LyricsView track={track} className="h-full px-2" />
                ) : track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-fg-subtle">
                    <Music className="size-16" />
                  </div>
                )}
              </div>

              {/* Title */}
              <div className="w-full text-center">
                <h1 className="line-clamp-2 text-2xl font-bold tracking-tight text-fg">
                  {track.title}
                </h1>
                <p className="mt-1 line-clamp-1 text-sm text-fg-muted">{trackArtistNames(track)}</p>
              </div>

              {/* Seek: waveform when peaks exist, slider otherwise */}
              <div className="w-full">
                {waveform && waveform.peaks.length > 0 ? (
                  <>
                    <WaveformSeeker peaks={waveform.peaks} duration={duration} onSeek={seek} />
                    <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-fg-muted">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </>
                ) : (
                  <SeekSlider
                    value={progress}
                    duration={duration}
                    buffered={buffered}
                    onSeek={seek}
                  />
                )}
              </div>

              {/* Transport */}
              <div className="flex items-center gap-3">
                <IconButton aria-label="Aleatório" active={shuffle} onClick={toggleShuffle}>
                  <Shuffle />
                </IconButton>
                <IconButton aria-label="Anterior" size="lg" onClick={prev}>
                  <SkipBack className="fill-current" />
                </IconButton>
                <PlayButton playing={isPlaying} size="lg" onClick={toggle} />
                <IconButton aria-label="Próxima" size="lg" onClick={next}>
                  <SkipForward className="fill-current" />
                </IconButton>
                <IconButton
                  aria-label={
                    repeat === 'off' ? 'Repetir' : repeat === 'all' ? 'Repetir uma' : 'Não repetir'
                  }
                  active={repeat !== 'off'}
                  onClick={cycleRepeat}
                >
                  {repeat === 'one' ? <Repeat1 /> : <Repeat />}
                </IconButton>
              </div>

              {/* Utility row */}
              <div className="flex w-full items-center justify-center gap-1">
                <IconButton
                  aria-label={lyricsOpen ? 'Voltar para a capa' : 'Letra'}
                  size="sm"
                  active={lyricsOpen}
                  onClick={() => {
                    toggleLyrics();
                    setVisualizer(false);
                  }}
                >
                  <MicVocal />
                </IconButton>
                <IconButton
                  aria-label="Visualizador de espectro"
                  size="sm"
                  active={visualizer}
                  onClick={() => {
                    const next = !visualizer;
                    setVisualizer(next);
                    if (next && lyricsOpen) toggleLyrics();
                  }}
                >
                  <AudioLines />
                </IconButton>
                <IconButton
                  aria-label="Equalizador"
                  size="sm"
                  onClick={() => setActiveModal('equalizer')}
                >
                  <SlidersHorizontal />
                </IconButton>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label="Timer de sono" size="sm" active={sleepTimer !== null}>
                      <Timer />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuLabel>Timer de sono</DropdownMenuLabel>
                    {SLEEP_OPTIONS.map((minutes) => (
                      <DropdownMenuItem key={minutes} onSelect={() => setSleepTimer(minutes)}>
                        {minutes} minutos
                        {sleepTimer === minutes && <span className="ml-auto text-accent">●</span>}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      disabled={sleepTimer === null}
                      onSelect={() => setSleepTimer(null)}
                    >
                      Desligar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Velocidade de reprodução"
                      size="sm"
                      active={playbackRate !== 1}
                    >
                      <Gauge />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuLabel>Velocidade</DropdownMenuLabel>
                    {RATE_OPTIONS.map((rate) => (
                      <DropdownMenuItem key={rate} onSelect={() => setRate(rate)}>
                        {rate}×
                        {playbackRate === rate && <span className="ml-auto text-accent">●</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="ml-2 hidden items-center gap-2 sm:flex">
                  <IconButton
                    aria-label={muted ? 'Ativar som' : 'Silenciar'}
                    size="sm"
                    onClick={toggleMute}
                  >
                    {muted || volume === 0 ? <VolumeX /> : volume < 0.5 ? <Volume1 /> : <Volume2 />}
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
              </div>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
