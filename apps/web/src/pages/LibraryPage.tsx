/**
 * /library — playlists / albums / artists tabs with filter and
 * create-playlist dialog (RHF + zod createPlaylistSchema).
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Disc3,
  Heart,
  Library,
  ListMusic,
  Loader2,
  MicVocal,
  Plus,
  Search,
  Tag,
} from 'lucide-react';
import { createPlaylistSchema, type CreatePlaylistInput } from '@aurial/shared';
import { DeviceTracksRow } from '@/components/media/DeviceTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { LocalArtistCard } from '@/components/media/LocalArtistCard';
import { MediaCard } from '@/components/media/MediaCard';
import { PlaylistCard } from '@/components/media/PlaylistCard';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useCreatePlaylist, useLibrary, useLocalPlaylists } from '@/features/library/api';
import * as localLibrary from '@/lib/local/localLibrary';
import * as localLikes from '@/lib/local/localLikes';
import { formatCompactNumber } from '@/lib/utils';

const EMPTY_LIB: localLibrary.LibraryEntry[] = [];

function CreatePlaylistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const createPlaylist = useCreatePlaylist();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreatePlaylistInput>({
    resolver: zodResolver(createPlaylistSchema),
    defaultValues: { title: '', description: '', isPublic: true, isCollaborative: false },
  });

  const onSubmit = handleSubmit((input) => {
    createPlaylist.mutate(input, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova playlist</DialogTitle>
          <DialogDescription>Dê um nome e comece a adicionar faixas.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pl-title">Nome</Label>
            <Input
              id="pl-title"
              placeholder="Minha playlist"
              aria-invalid={Boolean(errors.title)}
              {...register('title')}
            />
            {errors.title && (
              <p className="text-xs text-danger">Informe um nome de até 100 caracteres.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-description">Descrição (opcional)</Label>
            <Textarea
              id="pl-description"
              placeholder="Sobre o que é essa playlist?"
              {...register('description')}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pl-public" className="text-sm text-fg">
              Playlist pública
            </Label>
            <Switch
              id="pl-public"
              checked={watch('isPublic')}
              onCheckedChange={(checked) => setValue('isPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pl-collab" className="text-sm text-fg">
              Colaborativa
            </Label>
            <Switch
              id="pl-collab"
              checked={watch('isCollaborative')}
              onCheckedChange={(checked) => setValue('isCollaborative', checked)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="accent" disabled={createPlaylist.isPending}>
              {createPlaylist.isPending && <Loader2 className="animate-spin" />}
              Criar playlist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Special "Curtidas" tile at the top of the playlists grid. */
function LikedTile({ count }: { count: number }) {
  return (
    <Link
      to="/liked"
      className="group w-40 shrink-0 rounded-xl p-3 transition-colors duration-200 hover:bg-fg/5 md:w-44"
    >
      <div className="grid aspect-square place-items-center rounded-lg bg-gradient-to-br from-accent/80 to-accent/30">
        <Heart className="size-10 fill-current text-accent-fg" />
      </div>
      <div className="mt-3 space-y-0.5">
        <p className="line-clamp-1 text-sm font-medium text-fg">Curtidas</p>
        <p className="text-[13px] text-fg-muted">{formatCompactNumber(count)} faixas</p>
      </div>
    </Link>
  );
}

export default function LibraryPage() {
  const { data } = useLibrary();
  const localPlaylists = useLocalPlaylists();
  const libEntries = useSyncExternalStore(
    localLibrary.subscribe,
    localLibrary.list,
    () => EMPTY_LIB,
  );
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const term = filter.trim().toLowerCase();

  const localArtists = useMemo(() => {
    const all = localLibrary.artists();
    return term ? all.filter((a) => a.name.toLowerCase().includes(term)) : all;
  }, [libEntries, term]);
  const localGenres = useMemo(() => {
    const all = localLibrary.genreGroups();
    return term ? all.filter((g) => g.genre.toLowerCase().includes(term)) : all;
  }, [libEntries, term]);
  // Álbuns que você REALMENTE tem faixa. Antes esta aba trazia a discografia
  // inteira do iTunes de cada artista: dezenas de álbuns sem uma única música
  // sua, que abriam vazios. Álbum sem faixa não é biblioteca, é catálogo.
  const discography = useMemo(() => {
    const all = localLibrary.albumGroups();
    return term ? all.filter((a) => `${a.title} ${a.artist}`.toLowerCase().includes(term)) : all;
  }, [libEntries, term]);
  const filtered = useMemo(() => {
    // On-device playlists first, then any server ones.
    const playlists = [...localPlaylists, ...(data?.playlists ?? [])];
    const byTitle = (list: typeof playlists) =>
      term ? list.filter((p) => p.title.toLowerCase().includes(term)) : list;
    return {
      playlists: byTitle(playlists),
      albums: !data
        ? []
        : term
          ? data.albums.filter((a) => a.title.toLowerCase().includes(term))
          : data.albums,
      artists: !data
        ? []
        : term
          ? data.artists.filter((a) => a.name.toLowerCase().includes(term))
          : data.artists,
    };
  }, [data, term, localPlaylists]);

  // Faixas ainda sem capa: a varredura roda em segundo plano e pode levar
  // sessões (teto por sessão). Dizer quantas faltam evita a leitura de "o app
  // desistiu" — e dá o botão para quem quer forçar as que já desistiram.
  const missingCovers = useMemo(() => localLibrary.pendingCoverCount(), [libEntries]);

  const grid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  // Quantos cartões existem de cada vez. A página montava TODOS os artistas,
  // álbuns e gêneros de uma vez: com 300 faixas isso dá 4440 nós no DOM, e a
  // biblioteca do usuário é maior. Ninguém lê a centésima capa antes de rolar
  // até ela — 60 cobre várias telas e o botão traz o resto sob demanda.
  const PAGINA = 60;
  const [mostrar, setMostrar] = useState(PAGINA);
  const maisBotao = (total: number): React.ReactNode =>
    total > mostrar ? (
      <button
        type="button"
        onClick={() => setMostrar((n) => n + PAGINA)}
        className="col-span-full mx-auto mt-2 rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
      >
        Mostrar mais ({total - mostrar} restantes)
      </button>
    ) : null;

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <Library className="size-7 text-fg-muted" /> Sua biblioteca
        </h1>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus /> Nova playlist
        </Button>
      </header>

      {/* Your downloaded / on-device tracks — always shown, independent of the
          central library API (not deployed in the P2P topology). */}
      {/* Sem `limit` isto montava a biblioteca INTEIRA num carrossel
          horizontal — 300 faixas viravam 300 cartões e ~4400 nós no DOM, dos
          quais o usuário vê uns seis. É um trilho de "mais recentes", e o link
          do cabeçalho leva para /dispositivo, onde a lista completa mora. */}
      <DeviceTracksRow limit={24} />

      {missingCovers > 0 && (
        <p className="text-xs text-fg-subtle">
          Buscando capas… {missingCovers} restantes.{' '}
          <button
            type="button"
            onClick={() => localLibrary.retryCoverBackfill()}
            className="underline underline-offset-2 hover:text-fg"
          >
            Tentar de novo
          </button>
        </p>
      )}

      {/* Local-first: the library (genres/artists/albums/playlists) is built from
          the songs you added — always shown, no backend required. */}
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar na biblioteca"
          aria-label="Filtrar na biblioteca"
          className="pl-9"
        />
      </div>

      <Tabs defaultValue="genres">
        <TabsList>
          <TabsTrigger value="genres">Gêneros</TabsTrigger>
          <TabsTrigger value="artists">Artistas</TabsTrigger>
          <TabsTrigger value="albums">Álbuns</TabsTrigger>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
        </TabsList>

        <TabsContent value="genres">
          {localGenres.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={term ? 'Nenhum gênero com esse nome' : 'Sem gêneros ainda'}
              description={
                term ? undefined : 'Adicione músicas — a IA classifica cada uma por gênero.'
              }
            />
          ) : (
            <div className={grid}>
              {localGenres.slice(0, mostrar).map((g) => (
                <MediaCard
                  key={g.genre}
                  title={g.genre}
                  subtitle={`${g.tracks.length} ${g.tracks.length === 1 ? 'música' : 'músicas'}`}
                  imageUrl={g.coverUrl}
                  to={`/genero/${encodeURIComponent(g.genre)}`}
                />
              ))}
              {maisBotao(localGenres.length)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="artists">
          {localArtists.length === 0 ? (
            <EmptyState
              icon={MicVocal}
              title={term ? 'Nenhum artista com esse nome' : 'Nenhum artista ainda'}
              description={term ? undefined : 'Adicione músicas e seus artistas aparecem aqui.'}
            />
          ) : (
            <div className={grid}>
              {localArtists.slice(0, mostrar).map((artist) => (
                <LocalArtistCard
                  key={artist.name}
                  name={artist.name}
                  trackCount={artist.trackCount}
                  fallbackImage={artist.coverUrl}
                />
              ))}
              {maisBotao(localArtists.length)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="albums">
          {discography.length === 0 ? (
            <EmptyState
              icon={Disc3}
              title={term ? 'Nenhum álbum com esse nome' : 'Nenhum álbum ainda'}
              description={
                term ? undefined : 'Os álbuns das músicas que você adicionar aparecem aqui.'
              }
            />
          ) : (
            <div className={grid}>
              {discography.slice(0, mostrar).map((album) => (
                <MediaCard
                  key={album.key}
                  title={album.title}
                  subtitle={`${album.artist} · ${album.tracks.length} ${album.tracks.length === 1 ? 'música' : 'músicas'}`}
                  imageUrl={album.coverUrl}
                  to={`/disco/${encodeURIComponent(album.key)}`}
                />
              ))}
              {maisBotao(discography.length)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="playlists">
          {filtered.playlists.length === 0 && !(!term && localLikes.count() > 0) ? (
            <EmptyState
              icon={ListMusic}
              title={term ? 'Nenhuma playlist com esse nome' : 'Nenhuma playlist ainda'}
              description={term ? undefined : 'Crie a primeira e monte sua trilha sonora.'}
              action={
                term ? undefined : (
                  <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus /> Criar playlist
                  </Button>
                )
              }
            />
          ) : (
            <div className={grid}>
              {!term && <LikedTile count={localLikes.count()} />}
              {filtered.playlists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
