/**
 * Pílula "Tocando em {aparelho}" — aparece quando OUTRO dispositivo da mesma
 * conta está com playback ativo e este aqui está parado (o aviso verde do
 * Spotify Connect). Flutua logo acima do player/abas, some sozinha quando o
 * outro aparelho pausa ou este começa a tocar.
 */
import { useSyncExternalStore } from 'react';
import { MonitorSpeaker } from 'lucide-react';
import { currentRemotePlayback, subscribeRemotePlayback } from '@/lib/devices/presence';
import { usePlayerStore } from '@/stores/playerStore';

export function RemotePlaybackBanner() {
  const remote = useSyncExternalStore(subscribeRemotePlayback, currentRemotePlayback, () => null);
  const isPlayingHere = usePlayerStore((s) => s.isPlaying);
  const hasTrackHere = usePlayerStore((s) => s.currentTrack !== null);

  if (!remote || isPlayingHere) return null;

  return (
    <div
      className={
        hasTrackHere
          ? 'pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-[calc(88px+0.75rem)]'
          : 'pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6'
      }
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <MonitorSpeaker className="size-4 shrink-0" />
        <span className="truncate">
          Tocando em {remote.deviceName} · {remote.title}
        </span>
      </div>
    </div>
  );
}
