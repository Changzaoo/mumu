import { useState } from 'react';
import { toast } from 'sonner';
import type { SharedTrack } from '@/lib/sync/sharedLibrary';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { useSharedTracks } from '@/features/community/api';
import { buildStreamUrl } from '@/lib/local/importerHelper';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Tracks other users imported by link, shared to everyone. Tapping one plays it
 * if it's already on this device, otherwise re-imports it (via the importer,
 * using the stored source link) and then plays.
 */
export function CommunityTracksRow({ limit }: { limit?: number }) {
  const shared = useSharedTracks();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [busy, setBusy] = useState<string | null>(null);

  if (shared.length === 0) return null;
  const items = limit ? shared.slice(0, limit) : shared;

  const play = async (item: SharedTrack): Promise<void> => {
    // Already on this device → play instantly.
    const existing = localLibrary.findBySource(item.sourceUrl);
    if (existing) {
      playQueue([existing], 0, { source: 'library', sourceId: 'community' });
      return;
    }
    if (busy) return;
    setBusy(item.sourceUrl);
    try {
      // Instant: stream now (yt-dlp→ffmpeg live) while the full copy downloads
      // in the background so it's saved offline + in the library for next time.
      const streamUrl = await buildStreamUrl(item.sourceUrl);
      if (streamUrl) {
        playQueue([{ ...item.track, streamUrl }], 0, { source: 'library', sourceId: 'community' });
        void localLibrary.addByUrl(item.sourceUrl).catch(() => undefined);
        return;
      }
      // Fallback (signed out / no importer): download then play.
      const toastId = toast.loading('Baixando da comunidade…');
      try {
        const track = await localLibrary.addByUrl(item.sourceUrl);
        toast.success(`“${track.title}” adicionada`, { id: toastId });
        playQueue([track], 0, { source: 'library', sourceId: 'community' });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível tocar.', {
          id: toastId,
        });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCarousel title="Adicionadas pela comunidade">
      {items.map((item) => (
        <MediaCard
          key={item.sourceUrl}
          title={item.track.title}
          subtitle={item.track.artists[0]?.name ?? item.sharedByName ?? 'Comunidade'}
          imageUrl={item.track.coverUrl}
          onPlay={() => void play(item)}
        />
      ))}
    </SectionCarousel>
  );
}
