/**
 * /library — playlists / albums / artists tabs with filter and
 * create-playlist dialog (RHF + zod createPlaylistSchema).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Disc3, Heart, Library, ListMusic, Loader2, MicVocal, Plus, Search } from 'lucide-react';
import { createPlaylistSchema, type CreatePlaylistInput } from '@aurial/shared';
import { ArtistCard } from '@/components/media/ArtistCard';
import { DeviceTracksRow } from '@/components/media/DeviceTracksRow';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { MediaCard } from '@/components/media/MediaCard';
import { PageSkeleton } from '@/components/media/PageSkeleton';
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
import { formatCompactNumber } from '@/lib/utils';

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
  const { data, isLoading, isError, refetch } = useLibrary();
  const localPlaylists = useLocalPlaylists();
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const term = filter.trim().toLowerCase();
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

  const grid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

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
      <DeviceTracksRow />

      {isLoading ? (
        <PageSkeleton variant="home" />
      ) : isError ? (
        <div className="py-16">
          <ErrorState onRetry={() => void refetch()} />
        </div>
      ) : !data ? null : (
        <>
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

          <Tabs defaultValue="playlists">
            <TabsList>
              <TabsTrigger value="playlists">Playlists</TabsTrigger>
              <TabsTrigger value="albums">Álbuns</TabsTrigger>
              <TabsTrigger value="artists">Artistas</TabsTrigger>
            </TabsList>

            <TabsContent value="playlists">
              {filtered.playlists.length === 0 && !(!term && data.likedTracksCount > 0) ? (
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
                  {!term && <LikedTile count={data.likedTracksCount} />}
                  {filtered.playlists.map((playlist) => (
                    <PlaylistCard key={playlist.id} playlist={playlist} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="albums">
              {filtered.albums.length === 0 ? (
                <EmptyState
                  icon={Disc3}
                  title={term ? 'Nenhum álbum com esse nome' : 'Nenhum álbum salvo'}
                  description={term ? undefined : 'Salve álbuns para encontrá-los aqui.'}
                />
              ) : (
                <div className={grid}>
                  {filtered.albums.map((album) => (
                    <MediaCard
                      key={album.id}
                      title={album.title}
                      subtitle={album.artists.map((a) => a.name).join(', ')}
                      imageUrl={album.coverUrl}
                      to={`/album/${album.id}`}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="artists">
              {filtered.artists.length === 0 ? (
                <EmptyState
                  icon={MicVocal}
                  title={term ? 'Nenhum artista com esse nome' : 'Nenhum artista seguido'}
                  description={term ? undefined : 'Siga artistas para acompanhar seus lançamentos.'}
                />
              ) : (
                <div className={grid}>
                  {filtered.artists.map((artist) => (
                    <ArtistCard key={artist.id} artist={artist} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
