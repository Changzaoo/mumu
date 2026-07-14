/**
 * /telemetria — painel do admin com a telemetria de CADA usuário (docs
 * `telemetry/{uid}` no Firestore, escritos pelo próprio app de cada um):
 * velocidade real (↓/↑ contra o importer), tempo de uso (total, por página,
 * por hora do dia e dia da semana), sessões (quando entrou e por quanto
 * tempo), onde clica, o que faz ao abrir o app, dispositivo completo e o que
 * mais escuta. Rota protegida por AuthorizedRoute; as regras do Firestore
 * limitam a leitura aos e-mails de admin.
 */
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BatteryMedium,
  Clock,
  Cpu,
  Gauge,
  Globe,
  Library,
  ListMusic,
  LogIn,
  MonitorSmartphone,
  MousePointerClick,
  Music2,
  PlayCircle,
  Smartphone,
  Users,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { EmptyState } from '@/components/media/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { cn, formatBytes } from '@/lib/utils';
import type {
  RecentPlay,
  SessionAction,
  SessionLogEntry,
  TopEntry,
} from '@/lib/telemetry/telemetry';

interface TelemetryDoc {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous?: boolean;
  platform?: string;
  browser?: string;
  language?: string | null;
  timezone?: string | null;
  screen?: string;
  pwaInstalled?: boolean;
  deviceMemoryGb?: number | null;
  cpuCores?: number | null;
  touchDevice?: boolean;
  prefersDark?: boolean | null;
  battery?: { level: number; charging: boolean } | null;
  online?: boolean;
  lastSeenAt?: string;
  totalSeconds?: number;
  sessions?: number;
  netDownMbps?: number | null;
  netUpMbps?: number | null;
  netMeasuredAt?: string;
  connection?: { effectiveType?: string; downlinkMbps?: number; rttMs?: number };
  libraryCount?: number;
  libraryBytes?: number;
  likedCount?: number;
  totalPlays?: number;
  totalClicks?: number;
  jsErrors?: number;
  lastError?: string;
  topTracks?: TopEntry[];
  topArtists?: TopEntry[];
  recentPlays?: RecentPlay[];
  pageSeconds?: Record<string, number>;
  clickCounts?: Record<string, number>;
  hourHistogram?: Record<string, number>;
  weekdayHistogram?: Record<string, number>;
  lastSessionActions?: SessionAction[];
  recentSessions?: SessionLogEntry[];
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PAGE_LABEL: Record<string, string> = {
  inicio: 'Início',
  search: 'Buscar',
  library: 'Biblioteca',
  liked: 'Curtidas',
  history: 'Histórico',
  artistas: 'Artistas',
  artista: 'Página de artista',
  genero: 'Página de gênero',
  disco: 'Página de álbum',
  mix: 'Página de mix',
  playlist: 'Playlist',
  dispositivo: 'No dispositivo',
  discover: 'Descobrir',
  settings: 'Configurações',
  telemetria: 'Telemetria',
};

function formatHours(seconds = 0): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 2) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Hora do dia com mais uso ("21h") a partir do histograma. */
function peakHour(hist?: Record<string, number>): string | null {
  if (!hist) return null;
  let best: [number, number] | null = null;
  for (const [key, s] of Object.entries(hist)) {
    const h = Number(key.replace(/^h/, ''));
    if (!Number.isFinite(h)) continue;
    if (!best || s > best[1]) best = [h, s];
  }
  return best ? `${best[0]}h` : null;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-fg/4 px-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <div className="min-w-0">
        <p className="text-[11px] leading-tight text-fg-subtle">{label}</p>
        <p className="wrap-break-word text-[13px] font-semibold leading-snug text-fg">{value}</p>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Gauge; children: string }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
      <Icon className="size-3.5" /> {children}
    </p>
  );
}

/** Mini gráfico de barras (24h ou 7 dias) só com divs — sem libs. */
function BarChart({
  data,
  labelFor,
}: {
  data: Array<{ key: string; value: number }>;
  labelFor: (key: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-16 items-end gap-0.75">
      {data.map((d) => (
        <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <div
            title={`${labelFor(d.key)} · ${formatHours(d.value)}`}
            className={cn(
              'w-full rounded-sm',
              d.value === max && d.value > 0 ? 'bg-accent' : 'bg-fg/25',
            )}
            style={{ height: `${Math.max(3, (d.value / max) * 48)}px` }}
          />
          <span className="text-[8px] leading-none text-fg-subtle">{labelFor(d.key)}</span>
        </div>
      ))}
    </div>
  );
}

function UserCard({ t }: { t: TelemetryDoc }) {
  const [showHistory, setShowHistory] = useState(false);
  const online = t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 3 * 60_000;
  const title = t.displayName || t.email || (t.isAnonymous ? 'Usuário anônimo' : 'Usuário');
  const peak = peakHour(t.hourHistogram);

  const hours = Array.from({ length: 24 }, (_, h) => ({
    key: `h${h}`,
    value: t.hourHistogram?.[`h${h}`] ?? 0,
  }));
  const weekdays = Array.from({ length: 7 }, (_, d) => ({
    key: `d${d}`,
    value: t.weekdayHistogram?.[`d${d}`] ?? 0,
  }));
  const topPages = Object.entries(t.pageSeconds ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const topClicks = Object.entries(t.clickCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const sessionsLog = [...(t.recentSessions ?? [])].reverse().slice(0, 8);

  return (
    <article className="space-y-4 rounded-xl border border-border bg-bg-elevated p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-fg">{title}</h2>
          <p className="truncate text-[12px] text-fg-muted">
            {t.email ?? `uid ${t.uid.slice(0, 8)}…`}
            {t.pwaInstalled ? ' · app instalado' : ''}
          </p>
        </div>
        <Badge variant={online ? 'accent' : 'default'}>
          {online ? 'Online agora' : `Visto ${formatWhen(t.lastSeenAt)}`}
        </Badge>
      </header>

      {/* Rede + uso */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={ArrowDown}
          label="Download (medido)"
          value={t.netDownMbps != null ? `${t.netDownMbps} Mbps` : 'não medido'}
        />
        <Stat
          icon={ArrowUp}
          label="Upload (medido)"
          value={t.netUpMbps != null ? `${t.netUpMbps} Mbps` : 'não medido'}
        />
        <Stat icon={Clock} label="Tempo total no app" value={formatHours(t.totalSeconds)} />
        <Stat
          icon={LogIn}
          label="Sessões"
          value={`${t.sessions ?? 0}${peak ? ` · pico às ${peak}` : ''}`}
        />
      </div>

      {/* Dispositivo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={MonitorSmartphone}
          label="Plataforma"
          value={`${t.platform ?? '—'}${t.browser ? ` · ${t.browser}` : ''}`}
        />
        <Stat
          icon={Smartphone}
          label="Tela / toque"
          value={`${t.screen ?? '—'}${t.touchDevice ? ' · touch' : ''}`}
        />
        <Stat
          icon={Cpu}
          label="Hardware"
          value={
            [
              t.cpuCores ? `${t.cpuCores} núcleos` : null,
              t.deviceMemoryGb ? `${t.deviceMemoryGb}GB RAM` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'
          }
        />
        <Stat
          icon={BatteryMedium}
          label="Bateria"
          value={
            t.battery ? `${t.battery.level}%${t.battery.charging ? ' · carregando' : ''}` : '—'
          }
        />
        <Stat
          icon={Globe}
          label="Idioma / fuso"
          value={[t.language, t.timezone].filter(Boolean).join(' · ') || '—'}
        />
        <Stat
          icon={Gauge}
          label="Conexão (navegador)"
          value={
            t.connection?.effectiveType
              ? `${t.connection.effectiveType}${t.connection.rttMs ? ` · ${t.connection.rttMs}ms` : ''}`
              : '—'
          }
        />
        <Stat
          icon={Library}
          label="Biblioteca"
          value={`${t.libraryCount ?? 0} faixas${t.libraryBytes ? ` · ${formatBytes(t.libraryBytes)}` : ''}`}
        />
        <Stat
          icon={PlayCircle}
          label="Reproduções / curtidas"
          value={`${t.totalPlays ?? 0} plays · ${t.likedCount ?? 0} ♥`}
        />
      </div>

      {/* Uso por hora do dia */}
      {t.hourHistogram && (
        <div>
          <SectionTitle icon={Clock}>
            {`Uso por hora do dia${peak ? ` — mais usa às ${peak}` : ''}`}
          </SectionTitle>
          <BarChart data={hours} labelFor={(k) => k.replace(/^h/, '')} />
        </div>
      )}

      {/* Uso por dia da semana */}
      {t.weekdayHistogram && (
        <div>
          <SectionTitle icon={Activity}>Uso por dia da semana</SectionTitle>
          <BarChart data={weekdays} labelFor={(k) => WEEKDAYS[Number(k.replace(/^d/, ''))] ?? k} />
        </div>
      )}

      {/* Tempo por página */}
      {topPages.length > 0 && (
        <div>
          <SectionTitle icon={ListMusic}>Tempo por página</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {topPages.map(([page, s]) => (
              <span key={page} className="rounded-full bg-fg/6 px-2.5 py-1 text-[12px] text-fg">
                {PAGE_LABEL[page] ?? page}{' '}
                <span className="text-fg-subtle">· {formatHours(s)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Onde clica */}
      {topClicks.length > 0 && (
        <div>
          <SectionTitle icon={MousePointerClick}>
            {`Onde mais clica${t.totalClicks ? ` — ${t.totalClicks} cliques no total` : ''}`}
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {topClicks.map(([label, n]) => (
              <span key={label} className="rounded-full bg-fg/6 px-2.5 py-1 text-[12px] text-fg">
                {label} <span className="text-fg-subtle">· {n}x</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* O que fez ao abrir o app (última sessão) */}
      {(t.lastSessionActions?.length ?? 0) > 0 && (
        <div>
          <SectionTitle icon={LogIn}>Ao abrir o app (última sessão)</SectionTitle>
          <ol className="space-y-0.5 text-[12px] text-fg-muted">
            {t.lastSessionActions!.map((a, i) => (
              <li key={i} className="truncate">
                <span className="text-fg-subtle">+{Math.round(a.atMs / 1000)}s</span>{' '}
                {a.type === 'nav' ? 'abriu' : 'clicou em'}{' '}
                <span className="text-fg">{PAGE_LABEL[a.label] ?? a.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Entradas no app */}
      {sessionsLog.length > 0 && (
        <div>
          <SectionTitle icon={Clock}>Últimas entradas no app</SectionTitle>
          <ul className="space-y-0.5 text-[12px] text-fg-muted">
            {sessionsLog.map((s, i) => (
              <li key={`${s.startedAt}:${i}`} className="flex justify-between gap-3">
                <span>{formatClock(s.startedAt)}</span>
                <span className="text-fg-subtle">
                  {s.durationSec > 0 ? formatHours(s.durationSec) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* O que mais escuta */}
      {(t.topArtists?.length ?? 0) > 0 && (
        <div>
          <SectionTitle icon={Users}>Artistas mais ouvidos</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {t.topArtists!.map((a) => (
              <span key={a.name} className="rounded-full bg-fg/6 px-2.5 py-1 text-[12px] text-fg">
                {a.name} <span className="text-fg-subtle">· {a.plays}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(t.topTracks?.length ?? 0) > 0 && (
        <div>
          <SectionTitle icon={Music2}>Músicas mais tocadas</SectionTitle>
          <ol className="space-y-0.5 text-[13px] text-fg-muted">
            {t.topTracks!.slice(0, 5).map((track, i) => (
              <li key={track.name} className="truncate">
                <span className="text-fg-subtle">{i + 1}.</span> {track.name}{' '}
                <span className="text-fg-subtle">({track.plays}x)</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {(t.jsErrors ?? 0) > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {t.jsErrors} erro(s) de JavaScript{t.lastError ? ` — último: "${t.lastError}"` : ''}
        </div>
      )}

      {(t.recentPlays?.length ?? 0) > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[12px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {showHistory
              ? 'Ocultar histórico de músicas'
              : `Ver histórico de músicas (${t.recentPlays!.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-[12px] text-fg-muted">
              {t.recentPlays!.map((p, i) => (
                <li key={`${p.at}:${i}`} className="flex justify-between gap-3">
                  <span className="truncate">
                    {p.title} <span className="text-fg-subtle">· {p.artist}</span>
                  </span>
                  <span className="shrink-0 text-fg-subtle">{formatWhen(p.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

export default function TelemetryPage() {
  const [docs, setDocs] = useState<TelemetryDoc[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!db) {
      setError(true);
      return;
    }
    return onSnapshot(
      collection(db, 'telemetry'),
      (snap) => {
        const rows = snap.docs.map((d) => ({ ...(d.data() as TelemetryDoc), uid: d.id }));
        rows.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
        setDocs(rows);
      },
      () => setError(true),
    );
  }, []);

  return (
    <div className="space-y-6 py-4">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">Admin</p>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Telemetria</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Rede, tempo de uso por página/horário, sessões, cliques, dispositivo e o que cada usuário
          mais escuta — para melhorar a plataforma.
        </p>
      </header>

      {error && (
        <EmptyState
          icon={Activity}
          title="Sem acesso à telemetria"
          description="Publique as firestore.rules atualizadas e confirme que sua conta é admin."
        />
      )}

      {!error && docs === null && (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      )}

      {!error && docs !== null && docs.length === 0 && (
        <EmptyState
          icon={Activity}
          title="Nenhum dado ainda"
          description="Os dados aparecem alguns minutos depois que cada usuário abre o app atualizado."
        />
      )}

      {!error && docs !== null && docs.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {docs.map((t) => (
            <UserCard key={t.uid} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
