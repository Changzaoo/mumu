/**
 * / — Home, focused on the music people actually ADD to the app: recently-added
 * tracks, your on-device library, and everything organized by genre and artist.
 * No external 30s-preview catalog — only real, user-added songs.
 */
import { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { Clock, Heart, Library, Music, Users } from 'lucide-react';
import { CommunityTracksRow } from '@/components/media/CommunityTracksRow';
import { DeviceTracksRow } from '@/components/media/DeviceTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import * as localLibrary from '@/lib/local/localLibrary';
import { trackArtistNames } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Spotify-style quick-access shortcut tiles to the user's own spaces. */
function QuickAccess() {
  const items = [
    { to: '/liked', label: 'Curtidas', icon: Heart },
    { to: '/history', label: 'Histórico', icon: Clock },
    { to: '/artistas', label: 'Artistas', icon: Users },
    { to: '/library', label: 'Biblioteca', icon: Library },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 px-3 lg:grid-cols-4">
      {items.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="glass group flex items-center gap-3 overflow-hidden rounded-lg py-2 pr-3 transition-colors duration-200 hover:bg-fg/10"
        >
          <span className="grid size-11 shrink-0 place-items-center bg-accent/12 text-accent">
            <Icon className="size-5" />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-fg">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function HomePage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const genres = localLibrary.genreGroups();
  const artists = localLibrary.artists();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  return (
    <div className="space-y-8 py-4">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl"
      >
        {localGreeting()}
      </motion.h1>

      <QuickAccess />

      {/* Recently added — by the community and on this device. */}
      <CommunityTracksRow limit={20} />
      <DeviceTracksRow limit={16} />

      {/* Everything organized by genre (AI-assigned). */}
      {genres.map((g) => (
        <SectionCarousel key={g.genre} title={g.genre}>
          {g.tracks.map((track, index) => (
            <MediaCard
              key={track.id}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              playing={currentTrack?.id === track.id && isPlaying}
              onPlay={() =>
                playQueue(g.tracks, index, { source: 'library', sourceId: `genre:${g.genre}` })
              }
            />
          ))}
        </SectionCarousel>
      ))}

      {/* Your artists. */}
      {artists.length > 0 && (
        <SectionCarousel title="Seus artistas">
          {artists.map((artist) => (
            <MediaCard
              key={artist.name}
              title={artist.name}
              subtitle={`${artist.trackCount} ${artist.trackCount === 1 ? 'música' : 'músicas'}`}
              shape="round"
              imageUrl={artist.coverUrl}
              to={`/artista/${encodeURIComponent(artist.name)}`}
            />
          ))}
        </SectionCarousel>
      )}

      {entries.length === 0 && (
        <div className="px-3">
          <EmptyState
            icon={Music}
            title="Sua biblioteca está vazia"
            description="Adicione músicas por link ou importe seus arquivos — elas aparecem aqui, organizadas por gênero e artista."
          />
        </div>
      )}
    </div>
  );
}
