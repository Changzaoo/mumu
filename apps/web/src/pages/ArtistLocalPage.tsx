/**
 * /artista/:name — a Spotify-style page for an artist in YOUR library: their
 * most POPULAR tracks first (ranking do mundo real, via Deezer), a bio da
 * Wikipédia, a gravadora e depois os álbuns.
 */
import { SeguirArtistaButton } from '@/components/media/SeguirArtista';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Disc3, Flame, MicVocal, Play, Share2 } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import { MediaCard } from '@/components/media/MediaCard';
import { SobreOArtista } from '@/components/media/SobreOArtista';
import { openShare } from '@/components/media/ShareDialog';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { VirtualList } from '@/components/media/VirtualList';
import { tracksToShare } from '@/lib/share/share';
import { useTrackLikes } from '@/features/library/api';
import { useArtistBio } from '@/lib/artistBio';
import { useArtistImage } from '@/lib/artistImage';
import { useArtistTopTracks } from '@/lib/artistTop';
import { dominantLabel } from '@/lib/catalog/label';
import * as localLibrary from '@/lib/local/localLibrary';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: localLibrary.LibraryEntry[] = [];

/** Quantas faixas o bloco "Populares" mostra antes do "ver mais" (padrão Spotify). */
const POPULAR_PREVIEW = 5;

function GravadoraLink({ label }: { label: string }) {
  return (
    <dl>
      <dt className="uppercase tracking-[0.14em] text-fg-subtle">Gravadora</dt>
      <dd className="mt-0.5">
        <Link to={`/gravadora/${encodeURIComponent(label)}`} className="text-fg hover:text-accent">
          {label}
        </Link>
      </dd>
    </dl>
  );
}

export default function ArtistLocalPage() {
  const { name = '' } = useParams<{ name: string }>();
  const artist = decodeURIComponent(name);
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const localTracks = useMemo(() => localLibrary.artistTracks(artist), [entries, artist]);
  const albums = useMemo(() => localLibrary.artistAlbums(artist), [entries, artist]);

  // Ordem por popularidade REAL. Sem rede o hook devolve a ordem local intacta,
  // então a página nunca fica vazia por causa do ranking.
  const { tracks, ranked, fans } = useArtistTopTracks(artist, localTracks);
  // Faixas e álbuns do acervo são a pista para separar homônimos: o verbete
  // certo cita a obra que o usuário TEM desse artista.
  const bioHints = useMemo(
    () => ({ titles: [...albums.map((a) => a.title), ...localTracks.map((t) => t.title)] }),
    [albums, localTracks],
  );
  const bio = useArtistBio(artist, bioHints);
  const label = useMemo(() => dominantLabel(tracks.map((t) => t.label)), [tracks]);

  const [showAllPopular, setShowAllPopular] = useState(false);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likes = useTrackLikes();

  const photo = useArtistImage(artist);
  const cover = photo ?? tracks.find((t) => t.coverUrl)?.coverUrl ?? null;
  const play = (index = 0): void =>
    tracks.length > 0
      ? playQueue(tracks, index, { source: 'artist', sourceId: artist })
      : undefined;
  // UMA MÚSICA DE UM ÁLBUM TOCA O ÁLBUM, na ordem do disco, a partir dela.
  // O botão grande (`play`) continua tocando o artista; a faixa avulsa também.
  const tocarFaixa = (index: number): void => {
    const faixa = tracks[index];
    const album = faixa ? localLibrary.faixasDoAlbumDe(faixa) : null;
    if (!faixa || !album) {
      play(index);
      return;
    }
    const posicao = album.tracks.findIndex((t) => t.id === faixa.id);
    playQueue(album.tracks, Math.max(0, posicao), { source: 'album', sourceId: album.key });
  };

  if (tracks.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={MicVocal}
          title={artist}
          description="Você ainda não tem músicas desse artista no aparelho."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4">
      {/* Header */}
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
        <span className="size-40 shrink-0 overflow-hidden rounded-full bg-fg/6 shadow-xl">
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-fg-subtle">
              <MicVocal className="size-12" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            Artista
          </p>
          <h1 className="mt-1 line-clamp-2 text-4xl font-bold tracking-tight text-fg">{artist}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {tracks.length} {tracks.length === 1 ? 'música' : 'músicas'}
            {albums.length > 0 && ` · ${albums.length} ${albums.length === 1 ? 'álbum' : 'álbuns'}`}
            {fans !== null && fans > 0 && ` · ${fans.toLocaleString('pt-BR')} fãs`}
            {label && ` · ${label}`}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => play(0)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
            >
              <Play className="size-4 fill-current" /> Tocar
            </button>
            {/* Seguir põe o artista na lateral (como no Spotify), com o play
                das melhores dele — ver components/media/SeguirArtista. */}
            <SeguirArtistaButton nome={artist} capaUrl={cover} />
            <button
              type="button"
              aria-label="Compartilhar artista"
              onClick={() =>
                openShare({
                  type: 'artista',
                  title: artist,
                  subtitle: `${tracks.length} ${tracks.length === 1 ? 'música' : 'músicas'}`,
                  coverUrl: cover,
                  tracks: tracksToShare(tracks),
                })
              }
              className="grid size-10 place-items-center rounded-full border border-border text-fg transition-colors hover:bg-fg/5"
            >
              <Share2 className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Populares — os hits primeiro, que é o que se procura numa página de artista */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
          <Flame className="size-5 text-fg-muted" /> Populares
        </h2>
        <TrackList header aria-label={`Músicas populares de ${artist}`}>
          {(showAllPopular ? tracks : tracks.slice(0, POPULAR_PREVIEW)).map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={track.id === currentTrack?.id}
              playing={track.id === currentTrack?.id && isPlaying}
              liked={likes.isLiked(track)}
              onToggleLike={(liked) => likes.toggle(track, liked)}
              onPlay={() => tocarFaixa(index)}
            />
          ))}
        </TrackList>
        {tracks.length > POPULAR_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAllPopular((v) => !v)}
            className="text-[13px] font-semibold text-fg-muted transition-colors hover:text-fg"
          >
            {showAllPopular ? 'Mostrar menos' : 'Ver mais'}
          </button>
        )}
        {!ranked && (
          <p className="text-[12px] text-fg-subtle">
            Ordem do aparelho — o ranking de popularidade não pôde ser consultado agora.
          </p>
        )}
      </section>

      {/* Sobre o artista — foto grande + bio conferida (lib/artistBio.ts). Sem
          bio com identidade provada, o card não aparece: vazio é melhor que a
          pessoa errada. A gravadora continua aparecendo sozinha. */}
      {bio ? (
        <SobreOArtista
          name={artist}
          // A foto do catálogo (Deezer) primeiro; a do verbete só na falta dela.
          imageUrl={photo ?? bio.imageUrl ?? cover}
          stat={fans !== null && fans > 0 ? `${fans.toLocaleString('pt-BR')} fãs` : null}
          text={bio.text}
          fonte={
            bio.url && (
              <a
                href={bio.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-fg-muted hover:text-fg"
              >
                Fonte: Wikipédia ({bio.lang.toUpperCase()})
              </a>
            )
          }
        >
          {label && <GravadoraLink label={label} />}
        </SobreOArtista>
      ) : (
        label && (
          <section className="text-[12px]">
            <GravadoraLink label={label} />
          </section>
        )
      )}

      {/* Albums */}
      {albums.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <Disc3 className="size-5 text-fg-muted" /> Álbuns
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {albums.map((album) => (
              <MediaCard
                key={album.key}
                title={album.title}
                subtitle={`${album.tracks.length} faixas`}
                imageUrl={album.coverUrl}
                to={`/disco/${encodeURIComponent(album.key)}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* All tracks */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Todas as músicas</h2>
        <TrackList header aria-label={`Músicas de ${artist}`}>
          {/* Virtualizada: a discografia completa de um artista muito ouvido
              passa de cem faixas, e desenhar todas de uma vez é o que trava a
              abertura da página em aparelho de entrada. Ver GenreLocalPage. */}
          <VirtualList
            items={tracks}
            estimateSize={56}
            renderItem={(track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                active={track.id === currentTrack?.id}
                playing={track.id === currentTrack?.id && isPlaying}
                liked={likes.isLiked(track)}
                onToggleLike={(liked) => likes.toggle(track, liked)}
                onPlay={() => tocarFaixa(index)}
              />
            )}
          />
        </TrackList>
      </section>

      <p className="text-[12px] text-fg-subtle">
        <Link to="/dispositivo" className="hover:text-fg">
          Ver tudo no dispositivo
        </Link>
      </p>
    </div>
  );
}
