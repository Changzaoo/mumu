import type { PlaylistDto } from '@aurial/shared';
import { MediaCard } from '@/components/media/MediaCard';

export interface PlaylistCardProps {
  playlist: Pick<PlaylistDto, 'id' | 'title' | 'coverUrl' | 'owner' | 'trackCount'>;
  onPlay?: () => void;
  className?: string;
}

export function PlaylistCard({ playlist, onPlay, className }: PlaylistCardProps) {
  return (
    <MediaCard
      title={playlist.title}
      subtitle={`De ${playlist.owner.displayName} · ${playlist.trackCount} faixas`}
      imageUrl={playlist.coverUrl}
      to={`/playlist/${playlist.id}`}
      onPlay={onPlay}
      className={className}
    />
  );
}
