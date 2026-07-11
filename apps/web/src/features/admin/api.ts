/**
 * Admin feature — moderation hooks (offset pagination per ARCHITECTURE §3).
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminStatsDto,
  AuditLogDto,
  BanUserInput,
  PageMeta,
  UploadDto,
  UserDto,
  UserRole,
} from '@aurial/shared';
import { api } from '@/lib/api';

/** Admin listing includes private fields the public UserDto omits. */
export interface AdminUserDto extends UserDto {
  email?: string | null;
  bannedUntil?: string | null;
  banReason?: string | null;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta | null;
}

export function useAdminStats(): UseQueryResult<AdminStatsDto> {
  return useQuery({
    queryKey: ['admin', 'stats'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<AdminStatsDto>('/admin/stats')).data,
  });
}

export function useAdminUsers(page: number, search: string): UseQueryResult<Paged<AdminUserDto>> {
  return useQuery({
    queryKey: ['admin', 'users', page, search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, meta } = await api.get<AdminUserDto[], PageMeta>('/admin/users', {
        query: { page, perPage: 20, q: search || undefined },
      });
      return { items: data, meta: meta ?? null };
    },
  });
}

export interface UpdateUserRoleInput {
  userId: string;
  role?: UserRole;
  isPremium?: boolean;
}

/** PATCH /admin/users/:id — role / premium flags (adminUpdateUserSchema). */
export function useUpdateUserRole(): UseMutationResult<void, Error, UpdateUserRoleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ...input }: UpdateUserRoleInput) => {
      await api.patch(`/admin/users/${userId}`, input);
    },
    onSuccess: () => {
      toast('Usuário atualizado');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export interface BanUserRequest extends BanUserInput {
  userId: string;
}

export function useBanUser(): UseMutationResult<void, Error, BanUserRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ...input }: BanUserRequest) => {
      await api.post(`/admin/users/${userId}/ban`, input);
    },
    onSuccess: () => {
      toast('Usuário banido');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export interface AdminJobsDto {
  queues: AdminStatsDto['queues'];
  failed: Array<{
    id: string;
    queue: string;
    name: string;
    failedReason: string;
    attemptsMade: number;
    timestamp: string;
  }>;
}

export function useAdminJobs(): UseQueryResult<AdminJobsDto> {
  return useQuery({
    queryKey: ['admin', 'jobs'],
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<AdminJobsDto>('/admin/jobs')).data,
  });
}

/** Admin upload row — UploadDto + uploader info. */
export interface AdminUploadDto extends UploadDto {
  user?: Pick<UserDto, 'id' | 'handle' | 'displayName'> | null;
}

export function useAdminUploads(page: number): UseQueryResult<Paged<AdminUploadDto>> {
  return useQuery({
    queryKey: ['admin', 'uploads', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, meta } = await api.get<AdminUploadDto[], PageMeta>('/admin/uploads', {
        query: { page, perPage: 20 },
      });
      return { items: data, meta: meta ?? null };
    },
  });
}

export function useAdminLogs(page: number): UseQueryResult<Paged<AuditLogDto>> {
  return useQuery({
    queryKey: ['admin', 'logs', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, meta } = await api.get<AuditLogDto[], PageMeta>('/admin/logs', {
        query: { page, perPage: 30 },
      });
      return { items: data, meta: meta ?? null };
    },
  });
}
