/**
 * / — Home, focused on the music people actually ADD to the app: quick-access
 * tiles (Spotify-style, with real artwork), recently played, auto mixes by
 * artist/genre, albums, genres and artists. No external 30s-preview catalog —
 * only real, user-added songs.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import type { IconType } from 'react-icons';
import { IoHeart, IoMusicalNotesOutline, IoPeopleOutline, IoTimeOutline } from 'react-icons/io5';
import { Music } from 'lucide-react';
import type { TrackDto } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import { MediaCard } from '@/components/media/MediaCard';
import { SectionCarousel } from '@/components/media/SectionCarousel';
import * as localHistory from '@/lib/local/localHistory';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { buildRecommendations, daySeed, seededShuffle } from '@/lib/reco/recommend';
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

interface QuickTile {
  key: string;
  to: string;
  label: string;
  sub: string;
  imageUrl?: string | null;
  gradient?: boolean;
  icon?: IconType;
  round?: boolean;
}

/**
 * Spotify-style quick-access grid: 2×4 tiles with the REAL artwork of the
 * user's own spaces — Curtidas (gradient), latest playlists, top artists.
 */
function QuickAccess({
  playlists,
  artists,
  likedCount,
  cover,
}: {
  playlists: localPlaylists.LocalPlaylist[];
  artists: localLibrary.LocalArtist[];
  likedCount: number;
  cover: (trackIds: string[]) => string | null;
}) {
  const tiles: QuickTile[] = [
    {
      key: 'liked',
      to: '/liked',
      label: 'Músicas Curtidas',
      sub: `${likedCount} ${likedCount === 1 ? 'música' : 'músicas'}`,
      gradient: true,
      icon: IoHeart,
    },
  ];
  for (const p of playlists.slice(0, 3)) {
    tiles.push({
      key: `pl:${p.id}`,
      to: `/playlist/${p.id}`,
      label: p.title,
      sub: `Playlist • ${p.trackIds.length} faixas`,
      imageUrl: cover(p.trackIds),
      icon: IoMusicalNotesOutline,
    });
  }
  for (const a of artists.slice(0, 3)) {
    tiles.push({
      key: `ar:${a.name}`,
      to: `/artista/${encodeURIComponent(a.name)}`,
      label: a.name,
      sub: 'Artista',
      imageUrl: a.coverUrl,
      icon: IoPeopleOutline,
      round: true,
    });
  }
  tiles.push({
    key: 'history',
    to: '/history',
    label: 'Tocadas recentemente',
    sub: 'Histórico',
    icon: IoTimeOutline,
  });

  return (
    <div className="grid grid-cols-2 gap-2 px-3 lg:grid-cols-4">
      {tiles.slice(0, 8).map(({ key, to, label, sub, imageUrl, gradient, icon: Icon, round }) => (
        <Link
          key={key}
          to={to}
          className="group flex items-center gap-3 overflow-hidden rounded-md bg-fg/6 pr-3 transition-colors duration-200 hover:bg-fg/12"
        >
          <span
            className={cnTile(gradient)}
            style={round ? { borderRadius: '0 9999px 9999px 0' } : undefined}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              Icon && <Icon className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-1 text-[13px] font-bold text-fg">{label}</span>
            <span className="line-clamp-1 text-[11px] text-fg-muted">{sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function cnTile(gradient?: boolean): string {
  return [
    'grid size-12 shrink-0 place-items-center overflow-hidden shadow-[2px_0_8px_rgba(0,0,0,0.25)]',
    gradient
      ? 'bg-linear-to-br from-indigo-500 via-violet-500 to-blue-400 text-white'
      : 'bg-fg/10 text-fg-muted',
  ].join(' ');
}

export default function HomePage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);
  const history = useSyncExternalStore(localHistory.subscribe, localHistory.list, () => []);
  const likedCount = useSyncExternalStore(localLikes.subscribe, localLikes.count, () => 0);
  const genres = localLibrary.genreGroups();
  const artists = localLibrary.artists();
  const albums = localLibrary.albumGroups();

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // Adicionadas recentemente (pela data real de adição, mais novas primeiro).
  const recentlyAdded = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
        .slice(0, 12)
        .map((e) => e.track),
    [entries],
  );

  // Recently played, deduped by track (latest first).
  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    const out: TrackDto[] = [];
    for (const h of history) {
      if (seen.has(h.track.id)) continue;
      seen.add(h.track.id);
      out.push(h.track);
      if (out.length >= 12) break;
    }
    return out;
  }, [history]);

  // Motor de recomendação local (lib/reco): afinidade com decaimento temporal,
  // mixes diários por cluster, nostalgia, descobertas e hora-consciente —
  // memoizado no módulo, muda quando a biblioteca/histórico/dia mudam.
  const recos = useMemo(
    () => buildRecommendations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontes reativas
    [entries, history],
  );

  const playlistCover = (trackIds: string[]): string | null => {
    for (const id of trackIds) {
      const cover = entries.find((e) => e.track.id === id)?.track.coverUrl;
      if (cover) return cover;
    }
    return null;
  };

  return (
    <div className="relative space-y-8 py-4">
      {/* Spotify-style tinted header glow fading into the page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-4 h-72 bg-linear-to-b from-accent/14 to-transparent"
      />

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="relative px-3 text-3xl font-bold tracking-tight text-fg md:text-4xl"
      >
        {localGreeting()}
      </motion.h1>

      <div className="relative">
        <QuickAccess
          playlists={playlists}
          artists={artists}
          likedCount={likedCount}
          cover={playlistCover}
        />
      </div>

      {/* Adicionadas recentemente — "Mostrar tudo" leva à página completa. */}
      {recentlyAdded.length > 0 && (
        <SectionCarousel title="Adicionadas recentemente" href="/recentes">
          {recentlyAdded.map((track, index) => (
            <MediaCard
              key={track.id}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              playing={currentTrack?.id === track.id && isPlaying}
              onPlay={() =>
                playQueue(recentlyAdded, index, { source: 'library', sourceId: 'recentes' })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Recently played on THIS profile. */}
      {recentTracks.length > 0 && (
        <SectionCarousel title="Tocadas recentemente" href="/history">
          {recentTracks.map((track, index) => (
            <MediaCard
              key={track.id}
              title={track.title}
              subtitle={trackArtistNames(track)}
              imageUrl={track.coverUrl}
              playing={currentTrack?.id === track.id && isPlaying}
              onPlay={() => playQueue(recentTracks, index, { source: 'home' })}
            />
          ))}
        </SectionCarousel>
      )}

      {/* Recomendações do motor local — renovam a cada dia, estáveis no dia. */}
      {recos.length > 0 && (
        <SectionCarousel title="Feito para você" subtitle="Do seu jeito de ouvir">
          {recos.map((rec) => (
            <MediaCard
              key={rec.key}
              title={rec.title}
              subtitle={rec.subtitle}
              imageUrl={rec.coverUrl}
              imageUrls={rec.coverUrls}
              to={rec.key.startsWith('reco:') ? undefined : `/mix/${encodeURIComponent(rec.key)}`}
              onPlay={() =>
                playQueue(seededShuffle(rec.tracks, daySeed()), 0, {
                  source: 'library',
                  sourceId: rec.key,
                })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Seções "adicionadas recentemente"/"no dispositivo" removidas a pedido —
          a Home é recomendação + biblioteca organizada; adicionar músicas vive
          na página própria. */}

      {/* Real albums in the library (capped — o resto vive em "Mostrar tudo"). */}
      {albums.length > 0 && (
        <SectionCarousel title="Seus álbuns" href="/library">
          {albums.slice(0, 20).map((album) => (
            <MediaCard
              key={album.key}
              title={album.title}
              subtitle={album.artist}
              imageUrl={album.coverUrl}
              to={`/disco/${encodeURIComponent(album.key)}`}
              onPlay={() =>
                playQueue(album.tracks, 0, { source: 'library', sourceId: `album:${album.key}` })
              }
            />
          ))}
        </SectionCarousel>
      )}

      {/* Everything organized by genre (AI-assigned). */}
      {genres.map((g) => (
        <SectionCarousel
          key={g.genre}
          title={g.genre}
          href={`/genero/${encodeURIComponent(g.genre)}`}
        >
          {g.tracks.slice(0, 12).map((track, index) => (
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

      {/* Your artists (capped — a página /artistas tem todos). */}
      {artists.length > 0 && (
        <SectionCarousel title="Seus artistas" href="/artistas">
          {artists.slice(0, 20).map((artist) => (
            <LocalArtistCard
              key={artist.name}
              name={artist.name}
              trackCount={artist.trackCount}
              fallbackImage={artist.coverUrl}
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
