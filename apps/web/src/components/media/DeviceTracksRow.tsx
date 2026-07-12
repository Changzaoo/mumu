import { useSyncExternalStore } from 'react';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import * as localLibrary from '@/lib/local/localLibrary';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: LibraryEntry[] = [];

interface DeviceTracksRowProps {
  title?: string;
  subtitle?: string;
  /** Cap how many cards to show (newest first); omit for all. */
  limit?: number;
}

/**
 * Carousel of the user's on-device tracks (imported files, link downloads,
 * tracks received over P2P). Renders nothing when the local library is empty,
 * so it can be dropped into any page. Newest first (the store already prepends).
 */
export function DeviceTracksRow({
  title = 'Baixadas no dispositivo',
  subtitle = 'Suas faixas salvas — tocam offline',
  limit,
}: DeviceTracksRowProps) {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  if (entries.length === 0) return null;

  const tracks = entries.map((e) => e.track);
  const shown = limit ? tracks.slice(0, limit) : tracks;

  return (
    <SectionCarousel title={title} subtitle={subtitle} href="/dispositivo">
      {shown.map((track, index) => (
        <MediaCard
          key={track.id}
          title={track.title}
          subtitle={track.artists[0]?.name ?? 'Desconhecido'}
          imageUrl={track.coverUrl}
          playing={currentTrack?.id === track.id && isPlaying}
          onPlay={() => playQueue(tracks, index, { source: 'library', sourceId: 'device' })}
        />
      ))}
    </SectionCarousel>
  );
}
