/**
 * /admin/* — moderation console. Guarded by profile.role; inner tabs synced
 * with the URL splat (visão geral, usuários, uploads, fila, logs).
 */
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  Activity,
  Database,
  FileMusic,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { USER_ROLES, type UploadStatus, type UserRole } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { ErrorState } from '@/components/media/ErrorState';
import { Badge, type BadgeProps } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminJobs,
  useAdminLogs,
  useAdminStats,
  useAdminUploads,
  useAdminUsers,
  useBanUser,
  useUpdateUserRole,
  type AdminUserDto,
} from '@/features/admin/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, formatBytes, formatCompactNumber } from '@/lib/utils';

const TABS = [
  { path: '', label: 'Visão geral' },
  { path: 'users', label: 'Usuários' },
  { path: 'uploads', label: 'Uploads' },
  { path: 'jobs', label: 'Fila' },
  { path: 'logs', label: 'Logs' },
] as const;

const UPLOAD_STATUS_VARIANT: Record<UploadStatus, BadgeProps['variant']> = {
  QUEUED: 'default',
  PROBING: 'info',
  TRANSCODING: 'info',
  ANALYZING: 'info',
  READY: 'accent',
  FAILED: 'danger',
};

const ROLE_LABEL: Record<UserRole, string> = {
  USER: 'Usuário',
  MODERATOR: 'Moderador',
  ADMIN: 'Admin',
};

// ── Table primitives (border-border, text-sm) ───────────────────

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] text-sm">{children}</table>
    </div>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-border bg-fg/[0.03] px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-fg-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn('border-b border-border px-4 py-2.5 align-middle text-fg', className)}>
      {children}
    </td>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span className="font-mono text-[13px] tabular-nums text-fg-muted">
        {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Próxima
      </Button>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon className="size-4" />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <p className="mt-2 font-mono text-3xl font-bold tabular-nums tracking-tight text-fg">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useAdminStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Usuários"
          value={formatCompactNumber(data.users.total)}
          hint={`${data.users.activeToday} ativos hoje · ${data.users.newThisWeek} novos na semana`}
        />
        <StatCard
          icon={FileMusic}
          label="Faixas"
          value={formatCompactNumber(data.tracks.total)}
          hint={`${data.tracks.processedToday} processadas hoje`}
        />
        <StatCard
          icon={Database}
          label="Armazenamento"
          value={formatBytes(data.storage.usedBytes)}
          hint={`${formatCompactNumber(data.storage.objectCount)} objetos`}
        />
        <StatCard
          icon={Play}
          label="Plays hoje"
          value={formatCompactNumber(data.playback.playsToday)}
          hint={`${Math.round(data.playback.listeningHoursToday)} horas ouvidas`}
        />
      </div>

      <section aria-label="Status das filas">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-fg">
          Filas de processamento
        </h2>
        <Table>
          <thead>
            <tr>
              <Th>Fila</Th>
              <Th className="text-right">Aguardando</Th>
              <Th className="text-right">Ativas</Th>
              <Th className="text-right">Concluídas</Th>
              <Th className="text-right">Falhas</Th>
            </tr>
          </thead>
          <tbody>
            {data.queues.map((queue) => (
              <tr key={queue.name} className="transition-colors hover:bg-fg/[0.03]">
                <Td className="font-medium">{queue.name}</Td>
                <Td className="text-right font-mono tabular-nums">{queue.waiting}</Td>
                <Td className="text-right font-mono tabular-nums">{queue.active}</Td>
                <Td className="text-right font-mono tabular-nums">{queue.completed}</Td>
                <Td
                  className={cn(
                    'text-right font-mono tabular-nums',
                    queue.failed > 0 && 'text-danger',
                  )}
                >
                  {queue.failed}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

// ── Users ───────────────────────────────────────────────────────

function BanDialog({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const banUser = useBanUser();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');

  const submit = (): void => {
    if (!user) return;
    if (reason.trim().length < 3) {
      toast.error('Descreva o motivo (mínimo 3 caracteres).');
      return;
    }
    banUser.mutate(
      {
        userId: user.id,
        reason: reason.trim(),
        until: until ? new Date(until).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setReason('');
          setUntil('');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Banir usuário</DialogTitle>
          <DialogDescription>
            {user ? `@${user.handle} perderá o acesso. Sem data, o banimento é permanente.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ban-reason">Motivo</Label>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Violação dos termos de uso…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ban-until">Até (opcional)</Label>
            <Input
              id="ban-until"
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={banUser.isPending} onClick={submit}>
            {banUser.isPending && <Loader2 className="animate-spin" />}
            Banir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const { data, isLoading, isError, refetch, isFetching } = useAdminUsers(page, debounced);
  const updateRole = useUpdateUserRole();
  const [banTarget, setBanTarget] = useState<AdminUserDto | null>(null);

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Buscar por nome ou e-mail"
          aria-label="Buscar usuários"
          className="pl-9"
        />
      </div>

      {isLoading && <Skeleton className="h-72 rounded-xl" />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data && (
        <div className={cn(isFetching && 'opacity-70')}>
          <Table>
            <thead>
              <tr>
                <Th>Usuário</Th>
                <Th>E-mail</Th>
                <Th>Papel</Th>
                <Th>Premium</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-fg/[0.03]">
                  <Td>
                    <span className="font-medium">{user.displayName}</span>{' '}
                    <span className="text-fg-muted">@{user.handle}</span>
                    {user.bannedUntil && (
                      <Badge variant="danger" className="ml-2">
                        Banido
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{user.email ?? '—'}</Td>
                  <Td>
                    <Select
                      value={user.role}
                      onValueChange={(role) =>
                        updateRole.mutate({ userId: user.id, role: role as UserRole })
                      }
                    >
                      <SelectTrigger className="h-8 w-36" aria-label={`Papel de ${user.handle}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {USER_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Td>
                  <Td>
                    <Switch
                      aria-label={`Premium de ${user.handle}`}
                      checked={user.isPremium}
                      onCheckedChange={(isPremium) =>
                        updateRole.mutate({ userId: user.id, isPremium })
                      }
                    />
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => setBanTarget(user)}
                    >
                      Banir
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {data.items.length === 0 && (
            <EmptyState icon={Users} title="Nenhum usuário encontrado" className="py-10" />
          )}
          <Pagination page={page} totalPages={data.meta?.totalPages ?? 1} onPage={setPage} />
        </div>
      )}

      <BanDialog user={banTarget} onClose={() => setBanTarget(null)} />
    </div>
  );
}

// ── Uploads ─────────────────────────────────────────────────────

function UploadsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useAdminUploads(page);

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>Arquivo</Th>
            <Th>Usuário</Th>
            <Th>Tamanho</Th>
            <Th>Status</Th>
            <Th>Enviado em</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((upload) => (
            <tr key={upload.id} className="transition-colors hover:bg-fg/[0.03]">
              <Td className="max-w-64 truncate font-medium">{upload.fileName}</Td>
              <Td className="text-fg-muted">{upload.user ? `@${upload.user.handle}` : '—'}</Td>
              <Td className="font-mono tabular-nums">{formatBytes(upload.sizeBytes)}</Td>
              <Td>
                <Badge variant={UPLOAD_STATUS_VARIANT[upload.status]}>{upload.status}</Badge>
                {upload.error && <span className="ml-2 text-xs text-danger">{upload.error}</span>}
              </Td>
              <Td className="font-mono text-[13px] tabular-nums text-fg-muted">
                {new Date(upload.createdAt).toLocaleString('pt-BR')}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {data.items.length === 0 && (
        <EmptyState icon={FileMusic} title="Nenhum upload" className="py-10" />
      )}
      <Pagination page={page} totalPages={data.meta?.totalPages ?? 1} onPage={setPage} />
    </div>
  );
}

// ── Jobs ────────────────────────────────────────────────────────

function JobsTab() {
  const { data, isLoading, isError, refetch } = useAdminJobs();

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.queues.map((queue) => (
          <div key={queue.name} className="rounded-xl border border-border bg-bg-elevated p-4">
            <p className="text-[13px] font-medium text-fg-muted">{queue.name}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-fg">
              {queue.waiting + queue.active}
            </p>
            <p className="text-xs text-fg-muted">
              {queue.active} ativas ·{' '}
              {queue.failed > 0 ? (
                <span className="text-danger">{queue.failed} falhas</span>
              ) : (
                'sem falhas'
              )}
            </p>
          </div>
        ))}
      </div>

      <section aria-label="Jobs com falha">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-fg">Falhas recentes</h2>
        {data.failed.length === 0 ? (
          <EmptyState icon={Activity} title="Nenhum job com falha" className="py-10" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fila</Th>
                <Th>Job</Th>
                <Th>Erro</Th>
                <Th className="text-right">Tentativas</Th>
              </tr>
            </thead>
            <tbody>
              {data.failed.map((job) => (
                <tr key={job.id} className="transition-colors hover:bg-fg/[0.03]">
                  <Td className="font-medium">{job.queue}</Td>
                  <Td className="text-fg-muted">{job.name}</Td>
                  <Td className="max-w-80 truncate text-danger">{job.failedReason}</Td>
                  <Td className="text-right font-mono tabular-nums">{job.attemptsMade}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

// ── Logs ────────────────────────────────────────────────────────

function LogsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useAdminLogs(page);

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>Quando</Th>
            <Th>Ator</Th>
            <Th>Ação</Th>
            <Th>Alvo</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((log) => (
            <tr key={log.id} className="transition-colors hover:bg-fg/[0.03]">
              <Td className="whitespace-nowrap font-mono text-[13px] tabular-nums text-fg-muted">
                {new Date(log.createdAt).toLocaleString('pt-BR')}
              </Td>
              <Td className="font-mono text-[13px]">{log.actorId}</Td>
              <Td className="font-medium">{log.action}</Td>
              <Td className="text-fg-muted">
                {log.targetType}
                {log.targetId && <span className="font-mono text-[13px]"> · {log.targetId}</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {data.items.length === 0 && (
        <EmptyState icon={ShieldCheck} title="Nenhum registro de auditoria" className="py-10" />
      )}
      <Pagination page={page} totalPages={data.meta?.totalPages ?? 1} onPage={setPage} />
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function AdminPage() {
  const { profile, loading } = useAuthUser();
  const navigate = useNavigate();
  const location = useLocation();

  const segment = location.pathname.replace(/^\/admin\/?/, '').split('/')[0] ?? '';
  const activeTab = TABS.some((tab) => tab.path === segment) ? segment : '';

  if (loading) {
    return (
      <div className="space-y-6 py-4" aria-busy>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const allowed = profile?.role === 'ADMIN' || profile?.role === 'MODERATOR';
  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-danger/10 text-danger">
          <ShieldAlert className="size-7" />
        </span>
        <div className="space-y-2">
          <p className="font-mono text-sm tabular-nums tracking-widest text-fg-subtle">403</p>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Área restrita</h1>
          <p className="mx-auto max-w-sm text-sm text-fg-muted">
            Este painel é exclusivo para a equipe de moderação do radinho.online.
          </p>
        </div>
        <Button variant="accent" onClick={() => void navigate('/')}>
          Voltar ao início
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <ShieldCheck className="size-7 text-fg-muted" /> Administração
        </h1>
        <Badge variant="info">{profile?.role === 'ADMIN' ? 'Admin' : 'Moderador'}</Badge>
      </header>

      <nav
        aria-label="Seções do painel"
        className="flex gap-1 overflow-x-auto rounded-lg bg-fg/5 p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab.path}
            type="button"
            aria-current={activeTab === tab.path ? 'page' : undefined}
            onClick={() => void navigate(tab.path ? `/admin/${tab.path}` : '/admin')}
            className={cn(
              'shrink-0 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-200',
              activeTab === tab.path
                ? 'bg-bg-elevated text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === '' && <OverviewTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'uploads' && <UploadsTab />}
      {activeTab === 'jobs' && <JobsTab />}
      {activeTab === 'logs' && <LogsTab />}
    </div>
  );
}
