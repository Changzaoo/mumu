import { useState } from 'react';
import { toast } from 'sonner';
import type { SharedTrack } from '@/lib/sync/sharedLibrary';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import { useSharedTracks } from '@/features/community/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { searchSongs } from '@/lib/catalog/itunes';
import { buildStreamUrl } from '@/lib/local/importerHelper';
import * as localLibrary from '@/lib/local/localLibrary';
import * as importQueue from '@/lib/local/importQueue';
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
  const { user } = useAuthUser();

  if (shared.length === 0) return null;
  const items = limit ? shared.slice(0, limit) : shared;

  /** Auto-download the whole list in the background (paced queue skips dupes).
   *  Só para quem está LOGADO com conta real — sem credencial, cada item viraria
   *  um POST /import 403 (foi exatamente o loop que inundava o console). */
  const queueAll = (): void => {
    if (!user || user.isAnonymous) return;
    importQueue.enqueue(items.map((i) => i.sourceUrl));
  };

  const play = async (item: SharedTrack): Promise<void> => {
    queueAll(); // download the list the user is about to listen to
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
      // in the background (via the queue above) so it's saved offline for later.
      const streamUrl = await buildStreamUrl(item.sourceUrl);
      if (streamUrl) {
        playQueue([{ ...item.track, streamUrl }], 0, { source: 'library', sourceId: 'community' });
        return;
      }
      if (!user) {
        // Visitante: prévia de 30s do iTunes (o gate global reforça o limite) —
        // antes ele tentava baixar, tomava 403 e não ouvia NADA.
        const artist = item.track.artists[0]?.name ?? '';
        const songs = await searchSongs(`${item.track.title} ${artist}`, 'br', 1).catch(() => []);
        const preview = songs[0]?.previewUrl;
        if (preview) {
          playQueue([{ ...item.track, streamUrl: preview, previewOnly: true }], 0, {
            source: 'library',
            sourceId: 'community',
          });
          toast('Prévia de 30s — crie sua conta para ouvir completa');
        } else {
          toast.error('Sem prévia disponível — crie sua conta para ouvir completa.');
        }
        return;
      }
      // Logado sem stream (importer fora do ar): download then play.
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
    <SectionCarousel title="Adicionadas recentemente">
      {items.map((item) => (
        <MediaCard
          key={item.sourceUrl}
          title={item.track.title}
          subtitle={item.track.artists[0]?.name ?? 'Música'}
          imageUrl={item.track.coverUrl}
          onPlay={() => void play(item)}
        />
      ))}
    </SectionCarousel>
  );
}
