/**
 * /playlist/:id — hero with owner editing, play/shuffle/menu actions,
 * virtualized track list (owner: move/remove) and inline add-tracks search.
 *
 * Note: the API has no playlist-like endpoint (library covers tracks/albums/
 * artists only), so the actions row offers share instead.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Link2,
  ListMusic,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  updatePlaylistSchema,
  type PlaylistWithTracksDto,
  type TrackDto,
  type UpdatePlaylistInput,
} from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { HeroHeader } from '@/components/media/HeroHeader';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlayButton } from '@/components/media/PlayButton';
import { TrackList, TrackRow } from '@/components/media/TrackRow';
import { VirtualList } from '@/components/media/VirtualList';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useAddTracks,
  useDeletePlaylist,
  usePlaylist,
  useRemoveTrack,
  useReorderTrack,
  useUpdatePlaylist,
} from '@/features/playlists/api';
import { useTrackLikes } from '@/features/library/api';
import { useCatalogSearch } from '@/features/catalog/api';
import { useSearch } from '@/features/search/api';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDurationLong } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

function EditDialog({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: PlaylistWithTracksDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdatePlaylist(playlist.id);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdatePlaylistInput>({
    resolver: zodResolver(updatePlaylistSchema),
    values: { title: playlist.title, description: playlist.description ?? '' },
  });

  const onSubmit = handleSubmit((input) => {
    update.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar playlist</DialogTitle>
          <DialogDescription>Nome e descrição visíveis para quem acessa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Nome</Label>
            <Input id="edit-title" aria-invalid={Boolean(errors.title)} {...register('title')} />
            {errors.title && (
              <p className="text-xs text-danger">Informe um nome de até 100 caracteres.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Descrição</Label>
            <Textarea id="edit-description" {...register('description')} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="accent" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline add-tracks search (owner only). */
function AddTracksSection({ playlist }: { playlist: PlaylistWithTracksDto }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounce(term, 300);
  const { data, isFetching } = useSearch(debounced, 'track');
  const addTracks = useAddTracks(playlist.id);
  const existing = useMemo(
    () => new Set(playlist.tracks.map((entry) => entry.track.id)),
    [playlist.tracks],
  );

  return (
    <section
      aria-label="Adicionar faixas"
      className="rounded-xl border border-border bg-bg-elevated p-4"
    >
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-fg">Adicionar faixas</h2>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar músicas para esta playlist"
          aria-label="Buscar músicas para adicionar"
          className="pl-9 pr-8"
        />
        {term && (
          <button
            type="button"
            aria-label="Limpar"
            onClick={() => setTerm('')}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {debounced.trim() && data && (
        <ul className={isFetching ? 'mt-3 space-y-1 opacity-70' : 'mt-3 space-y-1'}>
          {data.tracks.slice(0, 8).map((track) => {
            const already = existing.has(track.id);
            return (
              <li
                key={track.id}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-fg/5"
              >
                <span className="size-9 shrink-0 overflow-hidden rounded-sm bg-fg/6">
                  {track.coverUrl && (
                    <img
                      src={track.coverUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm text-fg">{track.title}</span>
                  <span className="line-clamp-1 text-xs text-fg-muted">
                    {track.artists.map((a) => a.name).join(', ')}
                  </span>
                </span>
                <Button
                  variant={already ? 'ghost' : 'outline'}
                  size="sm"
                  disabled={already || addTracks.isPending}
                  onClick={() => addTracks.mutate([track.id])}
                >
                  {already ? (
                    'Adicionada'
                  ) : (
                    <>
                      <Plus /> Adicionar
                    </>
                  )}
                </Button>
              </li>
            );
          })}
          {data.tracks.length === 0 && (
            <li className="px-2 py-3 text-sm text-fg-muted">
              Nada encontrado para “{data.query}”.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Add-tracks search for LOCAL playlists — full-length Audius catalog, stored on
 *  device with the full track so it renders and plays without a backend. */
function LocalAddTracksSection({ playlist }: { playlist: PlaylistWithTracksDto }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounce(term, 300);
  const { data: results, isFetching } = useCatalogSearch(debounced);
  const queryClient = useQueryClient();
  const existing = useMemo(
    () => new Set(playlist.tracks.map((entry) => entry.track.id)),
    [playlist.tracks],
  );

  const add = (track: TrackDto): void => {
    localPlaylists.addTracks(playlist.id, [track]);
    void queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    toast('Adicionada à playlist');
  };

  return (
    <section
      aria-label="Adicionar faixas"
      className="rounded-xl border border-border bg-bg-elevated p-4"
    >
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-fg">Adicionar faixas</h2>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar músicas para esta playlist"
          aria-label="Buscar músicas para adicionar"
          className="pl-9 pr-8"
        />
        {term && (
          <button
            type="button"
            aria-label="Limpar"
            onClick={() => setTerm('')}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {debounced.trim() && results && (
        <ul className={isFetching ? 'mt-3 space-y-1 opacity-70' : 'mt-3 space-y-1'}>
          {results.slice(0, 8).map((track) => {
            const already = existing.has(track.id);
            return (
              <li
                key={track.id}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-fg/5"
              >
                <span className="size-9 shrink-0 overflow-hidden rounded-sm bg-fg/6">
                  {track.coverUrl && (
                    <img
                      src={track.coverUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm text-fg">{track.title}</span>
                  <span className="line-clamp-1 text-xs text-fg-muted">
                    {track.artists.map((a) => a.name).join(', ')}
                  </span>
                </span>
                <Button
                  variant={already ? 'ghost' : 'outline'}
                  size="sm"
                  disabled={already}
                  onClick={() => add(track)}
                >
                  {already ? (
                    'Adicionada'
                  ) : (
                    <>
                      <Plus /> Adicionar
                    </>
                  )}
                </Button>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="px-2 py-3 text-sm text-fg-muted">Nada encontrado para “{debounced}”.</li>
          )}
        </ul>
      )}
    </section>
  );
}

export default function PlaylistPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = usePlaylist(id);
  const queryClient = useQueryClient();
  const { profile } = useAuthUser();
  const likes = useTrackLikes();
  const update = useUpdatePlaylist(id);
  const removeTrack = useRemoveTrack(id);
  const reorder = useReorderTrack(id);
  const deletePlaylist = useDeletePlaylist(id);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (isError || !data) {
    return (
      <div className="py-16">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  const isLocal = localPlaylists.isLocalPlaylistId(id);
  const isOwner = !isLocal && profile?.id === data.owner.id;
  // Local playlists are always editable by the viewer (they're on this device).
  const canEdit = isOwner || isLocal;
  const tracks = data.tracks.map((entry) => entry.track);

  const removeLocalTrack = (trackId: string): void => {
    localPlaylists.removeTrack(id, trackId);
    void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
  };

  const playAll = (index = 0): void => {
    if (tracks.length === 0) return;
    playQueue(tracks, index, { source: 'playlist', sourceId: data.id });
  };

  const playShuffled = (): void => {
    if (tracks.length === 0) return;
    if (!shuffle) toggleShuffle();
    playQueue(tracks, Math.floor(Math.random() * tracks.length), {
      source: 'playlist',
      sourceId: data.id,
    });
  };

  const copyLink = (): void => {
    void navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast('Link copiado'))
      .catch(() => toast.error('Não foi possível copiar o link.'));
  };

  return (
    <div className="space-y-6 py-4">
      <HeroHeader
        type={data.isCollaborative ? 'Playlist colaborativa' : 'Playlist'}
        title={data.title}
        imageUrl={data.coverUrl}
        dominantColor={data.dominantColor}
        meta={
          <>
            <Link
              to={`/profile/${isOwner ? (profile?.handle ?? data.owner.id) : data.owner.id}`}
              className="font-medium text-fg hover:underline"
            >
              {data.owner.displayName}
            </Link>
            <span aria-hidden>·</span>
            <span>{data.trackCount} faixas</span>
            <span aria-hidden>·</span>
            <span>{formatDurationLong(data.durationMs)}</span>
          </>
        }
        actions={
          <>
            <PlayButton size="lg" onClick={() => playAll(0)} disabled={tracks.length === 0} />
            <Button
              variant="outline"
              size="sm"
              onClick={playShuffled}
              disabled={tracks.length === 0}
            >
              <Shuffle /> Aleatório
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Mais opções da playlist"
                  className="grid size-9 place-items-center rounded-full text-fg-muted transition-colors hover:bg-fg/8 hover:text-fg"
                >
                  <MoreHorizontal className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={copyLink}>
                  <Link2 /> Copiar link
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil /> Editar detalhes
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => update.mutate({ isCollaborative: !data.isCollaborative })}
                    >
                      <Users />{' '}
                      {data.isCollaborative ? 'Tornar não colaborativa' : 'Tornar colaborativa'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger focus:text-danger"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Trash2 /> Excluir playlist
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        {data.description && (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted">{data.description}</p>
        )}
      </HeroHeader>

      {data.tracks.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title="Playlist vazia"
          description={
            canEdit
              ? 'Use a busca abaixo para adicionar as primeiras faixas.'
              : 'Ainda não há faixas por aqui.'
          }
        />
      ) : (
        <TrackList header aria-label={`Faixas de ${data.title}`}>
          <VirtualList
            items={data.tracks}
            estimateSize={56}
            renderItem={(entry, index) => (
              <div className="group/pl relative">
                <TrackRow
                  track={entry.track}
                  index={index}
                  active={entry.track.id === currentTrack?.id}
                  playing={entry.track.id === currentTrack?.id && isPlaying}
                  liked={likes.isLiked(entry.track)}
                  onToggleLike={(liked) => likes.toggle(entry.track, liked)}
                  onPlay={() => playAll(index)}
                  className={canEdit ? 'pr-10' : undefined}
                />
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Organizar ${entry.track.title}`}
                        className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-fg-muted opacity-0 transition-opacity duration-200 hover:text-fg group-hover/pl:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isOwner && (
                        <>
                          <DropdownMenuItem
                            disabled={index === 0}
                            onSelect={() =>
                              reorder.mutate({ entryId: entry.entryId, toPosition: index - 1 })
                            }
                          >
                            <ArrowUp /> Mover para cima
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === data.tracks.length - 1}
                            onSelect={() =>
                              reorder.mutate({ entryId: entry.entryId, toPosition: index + 1 })
                            }
                          >
                            <ArrowDown /> Mover para baixo
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        className="text-danger focus:text-danger"
                        onSelect={() =>
                          isLocal
                            ? removeLocalTrack(entry.track.id)
                            : removeTrack.mutate(entry.entryId)
                        }
                      >
                        <Trash2 /> Remover da playlist
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          />
        </TrackList>
      )}

      {isOwner && <AddTracksSection playlist={data} />}
      {isLocal && <LocalAddTracksSection playlist={data} />}

      <EditDialog playlist={data} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir playlist</DialogTitle>
            <DialogDescription>
              “{data.title}” será removida definitivamente. Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deletePlaylist.isPending}
              onClick={() => deletePlaylist.mutate()}
            >
              {deletePlaylist.isPending && <Loader2 className="animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
