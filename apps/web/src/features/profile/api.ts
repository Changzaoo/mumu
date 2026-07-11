/**
 * Profile feature — user pages + self edit.
 *
 * NOTE on the route param: the route is /profile/:handle, but the API only
 * exposes GET /users/:id (no handle lookup endpoint in ARCHITECTURE §4).
 * Resolution strategy: when the param matches the signed-in user's handle
 * (or id) we render from the cached MeDto; otherwise the param is treated
 * AS the user id and sent to GET /users/:id. Links across the app therefore
 * use the user id in /profile/:param for other users.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MeDto, PlaylistDto, UpdateMeInput, UserDto, UserStatsDto } from '@aurial/shared';
import { useAuthUser } from '@/hooks/useAuthUser';
import { api } from '@/lib/api';

export interface UserDetailDto extends UserDto {
  isFollowing?: boolean;
}

export interface ResolvedProfile {
  user: UserDetailDto | MeDto | null;
  isOwn: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Resolve the /profile/:handle param (own handle → MeDto; else id → GET /users/:id). */
export function useProfileUser(param: string): ResolvedProfile {
  const { profile, loading } = useAuthUser();
  const isOwn = Boolean(profile && (profile.handle === param || profile.id === param));

  const query = useQuery({
    queryKey: ['user', param],
    enabled: !loading && !isOwn,
    queryFn: async () => (await api.get<UserDetailDto>(`/users/${param}`)).data,
  });

  if (isOwn) {
    return {
      user: profile,
      isOwn: true,
      isLoading: false,
      isError: false,
      refetch: () => undefined,
    };
  }
  return {
    user: query.data ?? null,
    isOwn: false,
    isLoading: loading || query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export function useUserPlaylists(userId: string | undefined): UseQueryResult<PlaylistDto[]> {
  return useQuery({
    queryKey: ['user', userId, 'playlists'],
    enabled: Boolean(userId),
    queryFn: async () => (await api.get<PlaylistDto[]>(`/users/${userId}/playlists`)).data,
  });
}

/** Listening stats — only available for the signed-in user (GET /me/stats). */
export function useUserStats(enabled: boolean): UseQueryResult<UserStatsDto> {
  return useQuery({
    queryKey: ['me-stats'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<UserStatsDto>('/me/stats')).data,
  });
}

export function useFollowUser(userId: string): UseMutationResult<void, Error, boolean, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (follow: boolean) => {
      if (follow) await api.post(`/users/${userId}/follow`);
      else await api.del(`/users/${userId}/follow`);
    },
    onMutate: async (follow) => {
      await queryClient.cancelQueries({ queryKey: ['user', userId] });
      const previous = queryClient.getQueryData<UserDetailDto>(['user', userId]);
      queryClient.setQueryData<UserDetailDto>(['user', userId], (old) =>
        old
          ? {
              ...old,
              isFollowing: follow,
              followersCount: Math.max(0, old.followersCount + (follow ? 1 : -1)),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _follow, context) => {
      const ctx = context as { previous?: UserDetailDto } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['user', userId], ctx.previous);
      toast.error('Não foi possível atualizar o seguir.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['user', userId] }),
  });
}

/** PATCH /me — profile edit (SettingsPage account section reuses this). */
export function useUpdateMe(): UseMutationResult<MeDto, Error, UpdateMeInput> {
  return useMutation({
    mutationFn: async (input: UpdateMeInput) => (await api.patch<MeDto>('/me', input)).data,
    onSuccess: () => toast('Perfil atualizado'),
    onError: (error) => toast.error(error.message),
  });
}
