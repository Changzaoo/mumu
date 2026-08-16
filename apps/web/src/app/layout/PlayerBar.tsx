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
import { MonitorSpeaker } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRemoteControl } from '@/lib/devices/useRemoteControl';
import { useNowPlaying } from '@/lib/devices/useNowPlaying';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX />;
  if (volume < 0.5) return <Volume1 />;
  return <Volume2 />;
}

/** Curtir a faixa que está carregada AQUI (o remoto não tem esse estado). */
function LocalLikeButton() {
  const liked = usePlayerStore((s) => s.currentTrack?.isLiked ?? false);
  return <LikeButton liked={liked} className="ml-1" />;
}

/**
 * Fixed bottom player (DESIGN §7): 88px glass, 3 columns —
 * [art + track + like] [transport + seek] [queue/lyrics/EQ/volume/fullscreen].
 * Hidden until the first track, then springs up. Desktop only (≥768px).
 */
export function PlayerBar() {
  // A barra mostra o que está tocando AQUI ou em outro aparelho, sem distinção —
  // só o `deviceName` indica quando é remoto. Play/pausar/pular/buscar seguem a
  // música para o aparelho certo (ver `useNowPlaying`).
  const np = useNowPlaying();
  const isBuffering = usePlayerStore((s) => s.isBuffering && s.currentTrack !== null);
  const buffered = usePlayerStore((s) => s.buffered);
  const muted = usePlayerStore((s) => s.muted);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const { toggleMute, toggleShuffle, cycleRepeat } = usePlayerStore.getState();

  // O volume já valia para o aparelho remoto — mexer no alto-falante mudo daqui
  // não abaixava nada audível.
  const remoto = useRemoteControl();
  const volume = remoto.volume;
  const setVolume = remoto.setVolume;

  const track = np;
  const isPlaying = np?.isPlaying ?? false;
  const progress = np?.progress ?? 0;
  const duration = np?.duration ?? 0;
  const toggle = np?.toggle ?? (() => undefined);
  const next = np?.next ?? (() => undefined);
  const prev = np?.prev ?? (() => undefined);
  const seek = np?.seek ?? (() => undefined);

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
          // SAIU DE `fixed`, E ISSO É O CONSERTO DA SOBREPOSIÇÃO.
          //
          // Ele era `fixed inset-x-0 bottom-0`: uma faixa presa à janela, da
          // borda esquerda à direita — ou seja, POR CIMA da barra lateral. O
          // menu ficava coberto nos últimos 88px, e nenhum ajuste de z-index
          // resolvia, porque o problema não era ordem de pilha: era a barra
          // ocupar uma largura que não é dela.
          //
          // Agora ele é a última LINHA do layout. O menu e o conteúdo dividem a
          // linha de cima, o player fica embaixo dos dois, e a sobreposição
          // deixa de ser possível por construção — não por acerto de medida.
          className="glass-strong hidden h-[88px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 rounded-xl border-0 px-4 md:grid"
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
              <button
                type="button"
                onClick={toggle}
                className="line-clamp-1 text-left text-sm font-medium text-fg hover:underline"
              >
                {track.title}
              </button>
              <p className="line-clamp-1 text-[13px] text-fg-muted">
                {track.artists.map((artist, i) => (
                  <Fragment key={artist.id || artist.name}>
                    {i > 0 && ', '}
                    {track.source === 'remote' || !artist.id ? (
                      <span>{artist.name}</span>
                    ) : (
                      <Link to={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                        {artist.name}
                      </Link>
                    )}
                  </Fragment>
                ))}
              </p>
              {/* Onde está tocando — pequeno, só quando é outro aparelho. */}
              {track.source === 'remote' && track.deviceName && (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-accent">
                  <MonitorSpeaker className="size-3 shrink-0" />
                  <span className="truncate">{track.deviceName}</span>
                </span>
              )}
            </div>
            {/* Curtir só faz sentido para a faixa carregada AQUI. */}
            {track.source === 'local' && <LocalLikeButton />}
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
