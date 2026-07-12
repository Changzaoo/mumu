/**
 * /profile/:handle — banner, avatar, bio, social links, badges, public
 * playlists and listening stats (own profile). Edit via PATCH /me.
 *
 * Route param resolution: own handle → cached MeDto; anything else is
 * treated as a user id for GET /users/:id (see features/profile/api.ts).
 */
import { useState } from 'react';
import { useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, ListMusic, Loader2, Pencil, UserMinus, UserPlus } from 'lucide-react';
import { updateMeSchema, type MeDto, type UpdateMeInput } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { PageSkeleton } from '@/components/media/PageSkeleton';
import { PlaylistCard } from '@/components/media/PlaylistCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import {
  useFollowUser,
  useProfileUser,
  useUpdateMe,
  useUserPlaylists,
} from '@/features/profile/api';
import { useLocalPlaylists } from '@/features/library/api';
import { formatCompactNumber } from '@/lib/utils';

function EditProfileDialog({
  me,
  open,
  onOpenChange,
}: {
  me: MeDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateMe = useUpdateMe();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateMeInput>({
    resolver: zodResolver(updateMeSchema),
    values: { displayName: me.displayName, handle: me.handle, bio: me.bio ?? '' },
  });

  const onSubmit = handleSubmit((input) => {
    updateMe.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
          <DialogDescription>
            Como você aparece para outras pessoas no radinho.online.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">Nome de exibição</Label>
            <Input
              id="pf-name"
              aria-invalid={Boolean(errors.displayName)}
              {...register('displayName')}
            />
            {errors.displayName && <p className="text-xs text-danger">Entre 1 e 50 caracteres.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-handle">Nome de usuário</Label>
            <Input id="pf-handle" aria-invalid={Boolean(errors.handle)} {...register('handle')} />
            {errors.handle && (
              <p className="text-xs text-danger">Só letras minúsculas, números, _ e . (3–30).</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-bio">Bio</Label>
            <Textarea id="pf-bio" placeholder="Fale um pouco sobre você" {...register('bio')} />
            {errors.bio && <p className="text-xs text-danger">Máximo de 300 caracteres.</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="accent" disabled={updateMe.isPending}>
              {updateMe.isPending && <Loader2 className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfilePage() {
  const { handle = '' } = useParams<{ handle: string }>();
  const { user, isOwn, isLoading, isError, refetch } = useProfileUser(handle);
  const serverPlaylists = useUserPlaylists(user?.id);
  const localPlaylists = useLocalPlaylists();
  const follow = useFollowUser(user?.id ?? '');
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (isError || !user) {
    return (
      <div className="py-16">
        <ErrorState
          title="Perfil não encontrado"
          description="Este perfil não existe ou não pôde ser carregado."
          onRetry={refetch}
        />
      </div>
    );
  }

  const socialLinks = 'socialLinks' in user ? (user.socialLinks ?? {}) : {};
  const isFollowing = 'isFollowing' in user ? (user.isFollowing ?? false) : false;
  // Own profile shows on-device playlists; other users' come from the server.
  const shownPlaylists = isOwn ? localPlaylists : (serverPlaylists.data ?? []);

  return (
    <div className="space-y-8 py-4">
      {/* Banner + identity */}
      <header className="relative -mx-4 md:-mx-6 lg:-mx-8">
        <div className="h-44 overflow-hidden bg-fg/5 md:h-56">
          {user.bannerUrl && <img src={user.bannerUrl} alt="" className="size-full object-cover" />}
        </div>
        <div className="relative -mt-14 flex flex-col items-center gap-4 px-4 md:flex-row md:items-end md:px-6 lg:px-8">
          <Avatar className="size-28 border-4 border-bg shadow-xl md:size-32">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="text-2xl">{user.displayName.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1 pb-1 text-center md:items-start md:text-left">
            <h1 className="line-clamp-1 text-3xl font-bold tracking-tight text-fg md:text-4xl">
              {user.displayName}
            </h1>
            <p className="text-sm text-fg-muted">@{user.handle}</p>
            <p className="text-[13px] text-fg-muted">
              <span className="font-medium text-fg">
                {formatCompactNumber(user.followersCount)}
              </span>{' '}
              seguidores ·{' '}
              <span className="font-medium text-fg">
                {formatCompactNumber(user.followingCount)}
              </span>{' '}
              seguindo
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {user.isPremium && <Badge variant="accent">Premium</Badge>}
            {isOwn ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil /> Editar perfil
              </Button>
            ) : (
              <Button
                variant={isFollowing ? 'default' : 'accent'}
                size="sm"
                aria-pressed={isFollowing}
                onClick={() => follow.mutate(!isFollowing)}
              >
                {isFollowing ? <UserMinus /> : <UserPlus />}
                {isFollowing ? 'Seguindo' : 'Seguir'}
              </Button>
            )}
          </div>
        </div>
      </header>

      {(user.bio || Object.keys(socialLinks).length > 0) && (
        <section className="max-w-2xl space-y-3">
          {user.bio && <p className="text-sm leading-relaxed text-fg-muted">{user.bio}</p>}
          {Object.keys(socialLinks).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(socialLinks).map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] font-medium capitalize text-fg-muted transition-colors hover:border-fg/25 hover:text-fg"
                >
                  <ExternalLink className="size-3.5" /> {name}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-label="Playlists">
        <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Playlists</h2>
        {shownPlaylists.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title="Nenhuma playlist"
            description={isOwn ? 'Crie uma playlist para exibi-la aqui.' : undefined}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {shownPlaylists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )}
      </section>

      {isOwn && 'email' in user && (
        <EditProfileDialog me={user} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </div>
  );
}
