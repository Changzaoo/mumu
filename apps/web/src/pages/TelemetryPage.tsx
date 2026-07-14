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

interface FriendlyAction {
  when: string;
  text: string;
  count: number;
}

/**
 * Linha do tempo da sessão em linguagem humana:
 *  - cliques repetidos em sequência viram UMA linha com "×N";
 *  - um clique seguido da abertura da página homônima é redundante — some;
 *  - o offset vira horário de relógio (quando a hora de início é conhecida)
 *    ou "logo ao abrir" / "X min depois".
 */
function humanizeActions(actions: SessionAction[], sessionStartIso?: string): FriendlyAction[] {
  // 1. Remove o clique imediatamente confirmado pela navegação homônima.
  const deduped = actions.filter((a, i) => {
    const next = actions[i + 1];
    return !(
      a.type === 'click' &&
      next?.type === 'nav' &&
      next.atMs - a.atMs < 3000 &&
      next.label.toLowerCase().includes(a.label.toLowerCase().slice(0, 12))
    );
  });

  // 2. Colapsa sequências iguais ("clicou em Adicionar" ×5).
  const collapsed: Array<SessionAction & { count: number }> = [];
  for (const a of deduped) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.type === a.type && last.label === a.label) last.count += 1;
    else collapsed.push({ ...a, count: 1 });
  }

  // 3. Formata o momento de cada ação.
  const start = sessionStartIso ? new Date(sessionStartIso).getTime() : null;
  const when = (atMs: number): string => {
    if (start) {
      return new Date(start + atMs).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    if (atMs < 10_000) return 'logo ao abrir';
    if (atMs < 90_000) return `${Math.round(atMs / 1000)}s depois`;
    return `${Math.round(atMs / 60_000)} min depois`;
  };

  return collapsed.map((a) => ({
    when: when(a.atMs),
    text: a.type === 'nav' ? `abriu ${PAGE_LABEL[a.label] ?? a.label}` : `clicou em “${a.label}”`,
    count: a.count,
  }));
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

// ── categorização automática por comportamento ──────────────────────────────

interface UserSegment {
  /** Rótulo principal (agrupa a visão "Categorias"). */
  primary: string;
  /** Rótulos extras (período do dia, sinais secundários). */
  chips: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rotula o usuário pelo que ele MAIS faz — ordem = prioridade do rótulo. */
function categorize(t: TelemetryDoc): UserSegment {
  const chips: string[] = [];
  const lastSeenMs = t.lastSeenAt ? Date.now() - new Date(t.lastSeenAt).getTime() : Infinity;
  const hours = (t.totalSeconds ?? 0) / 3600;
  const plays = t.totalPlays ?? 0;
  const library = t.libraryCount ?? 0;

  // Período do dia preferido (pelo histograma de horas).
  const peak = peakHour(t.hourHistogram);
  if (peak) {
    const h = Number(peak.replace(/h$/, ''));
    if (h < 6) chips.push('Madrugador');
    else if (h < 12) chips.push('Matutino');
    else if (h < 18) chips.push('Vespertino');
    else chips.push('Noturno');
  }
  if (t.pwaInstalled) chips.push('App instalado');
  if ((t.jsErrors ?? 0) > 0) chips.push('Com erros');

  // Proporção de tempo em busca/descobrir → perfil explorador.
  const pageTotal = Object.values(t.pageSeconds ?? {}).reduce((a, b) => a + b, 0);
  const exploring = (t.pageSeconds?.search ?? 0) + (t.pageSeconds?.discover ?? 0);

  let primary = 'Casual';
  if (lastSeenMs > 7 * DAY_MS) primary = 'Inativo';
  else if ((t.sessions ?? 0) <= 2 && hours < 0.5) primary = 'Novato';
  else if (plays >= 100 || hours >= 10) primary = 'Ouvinte pesado';
  else if (library >= 300) primary = 'Colecionador';
  else if (pageTotal > 0 && exploring / pageTotal >= 0.35) primary = 'Explorador';
  else if ((t.likedCount ?? 0) >= 50) primary = 'Curtidor';
  return { primary, chips };
}

const SEGMENT_STYLE: Record<string, string> = {
  'Ouvinte pesado': 'bg-accent text-accent-fg',
  Colecionador: 'bg-fg/15 text-fg',
  Explorador: 'bg-fg/15 text-fg',
  Curtidor: 'bg-fg/15 text-fg',
  Casual: 'bg-fg/8 text-fg-muted',
  Novato: 'bg-fg/8 text-fg-muted',
  Inativo: 'bg-danger/15 text-danger',
};

function SegmentBadge({ name }: { name: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
        SEGMENT_STYLE[name] ?? 'bg-fg/8 text-fg-muted',
      )}
    >
      {name}
    </span>
  );
}

/** Linha compacta (modo Lista) — expande para o card completo ao clicar. */
function UserRow({
  t,
  expanded,
  onToggle,
}: {
  t: TelemetryDoc;
  expanded: boolean;
  onToggle: () => void;
}) {
  const online = t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 3 * 60_000;
  const seg = categorize(t);
  const title = t.displayName || t.email || (t.isAnonymous ? 'Anônimo' : 'Usuário');
  return (
    <div className="rounded-lg border border-border bg-bg-elevated">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fg/4 sm:grid-cols-[minmax(0,2fr)_auto_repeat(4,minmax(0,1fr))]"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span
              className={cn('size-2 shrink-0 rounded-full', online ? 'bg-accent' : 'bg-fg/20')}
              aria-label={online ? 'Online' : 'Offline'}
            />
            <span className="truncate text-[13px] font-semibold text-fg">{title}</span>
          </span>
          <span className="block truncate pl-4 text-[11px] text-fg-muted">
            {t.email ?? `uid ${t.uid.slice(0, 8)}…`}
          </span>
        </span>
        <SegmentBadge name={seg.primary} />
        <span className="hidden text-[12px] text-fg-muted sm:block">
          {formatHours(t.totalSeconds)}
        </span>
        <span className="hidden text-[12px] text-fg-muted sm:block">{t.totalPlays ?? 0} plays</span>
        <span className="hidden text-[12px] text-fg-muted sm:block">
          {t.netDownMbps != null ? `↓ ${t.netDownMbps} Mbps` : '↓ —'}
        </span>
        <span className="text-right text-[12px] text-fg-subtle">{formatWhen(t.lastSeenAt)}</span>
      </button>
      {expanded && (
        <div className="border-t border-border p-1">
          <UserCard t={t} />
        </div>
      )}
    </div>
  );
}

function UserCard({ t }: { t: TelemetryDoc }) {
  const [showHistory, setShowHistory] = useState(false);
  const online = t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 3 * 60_000;
  const title = t.displayName || t.email || (t.isAnonymous ? 'Usuário anônimo' : 'Usuário');
  const peak = peakHour(t.hourHistogram);
  const seg = categorize(t);

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

      {/* Rótulos de comportamento */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SegmentBadge name={seg.primary} />
        {seg.chips.map((chip) => (
          <span key={chip} className="rounded-full bg-fg/6 px-2 py-0.5 text-[11px] text-fg-muted">
            {chip}
          </span>
        ))}
      </div>

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

      {/* O que fez ao abrir o app (última sessão), em linguagem humana */}
      {(t.lastSessionActions?.length ?? 0) > 0 && (
        <div>
          <SectionTitle icon={LogIn}>Ao abrir o app (última sessão)</SectionTitle>
          <ol className="space-y-1 text-[12px] text-fg-muted">
            {humanizeActions(
              t.lastSessionActions!,
              t.recentSessions?.[t.recentSessions.length - 1]?.startedAt,
            ).map((a, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
                  {a.when}
                </span>
                <span className="min-w-0 truncate">
                  {a.text}
                  {a.count > 1 && (
                    <span className="ml-1.5 rounded-full bg-fg/8 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
                      ×{a.count}
                    </span>
                  )}
                </span>
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

type ViewMode = 'lista' | 'categorias' | 'detalhes';

const VIEWS: Array<{ value: ViewMode; label: string }> = [
  { value: 'lista', label: 'Lista' },
  { value: 'categorias', label: 'Categorias' },
  { value: 'detalhes', label: 'Detalhes' },
];

/** Tile de resumo agregado (topo do painel). */
function Summary({ docs }: { docs: TelemetryDoc[] }) {
  const online = docs.filter(
    (t) => t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 3 * 60_000,
  ).length;
  const totalSeconds = docs.reduce((a, t) => a + (t.totalSeconds ?? 0), 0);
  const speeds = docs.map((t) => t.netDownMbps).filter((v): v is number => v != null);
  const avgDown = speeds.length
    ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10
    : null;
  const plays = docs.reduce((a, t) => a + (t.totalPlays ?? 0), 0);
  const tiles = [
    { label: 'Usuários', value: String(docs.length) },
    { label: 'Online agora', value: String(online) },
    { label: 'Tempo somado', value: formatHours(totalSeconds) },
    { label: 'Download médio', value: avgDown != null ? `${avgDown} Mbps` : '—' },
    { label: 'Plays somados', value: String(plays) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
          <p className="text-[11px] text-fg-subtle">{tile.label}</p>
          <p className="text-lg font-bold text-fg">{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function TelemetryPage() {
  const [docs, setDocs] = useState<TelemetryDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<ViewMode>('lista');
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

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
        <>
          <Summary docs={docs} />

          {/* Modo de visualização */}
          <div role="tablist" aria-label="Modo de visualização" className="flex gap-2">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200',
                  view === v.value
                    ? 'bg-fg text-bg'
                    : 'bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Lista compacta — escala para centenas de usuários; clique expande. */}
          {view === 'lista' && (
            <div className="space-y-1.5">
              {docs.map((t) => (
                <UserRow
                  key={t.uid}
                  t={t}
                  expanded={expandedUid === t.uid}
                  onToggle={() => setExpandedUid((cur) => (cur === t.uid ? null : t.uid))}
                />
              ))}
            </div>
          )}

          {/* Agrupado por categoria de comportamento. */}
          {view === 'categorias' && (
            <div className="space-y-6">
              {Object.entries(
                docs.reduce<Record<string, TelemetryDoc[]>>((groups, t) => {
                  const { primary } = categorize(t);
                  (groups[primary] ??= []).push(t);
                  return groups;
                }, {}),
              )
                .sort((a, b) => b[1].length - a[1].length)
                .map(([segment, users]) => (
                  <section key={segment}>
                    <div className="mb-2 flex items-center gap-2">
                      <SegmentBadge name={segment} />
                      <span className="text-[12px] text-fg-subtle">
                        {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {users.map((t) => (
                        <UserRow
                          key={t.uid}
                          t={t}
                          expanded={expandedUid === t.uid}
                          onToggle={() => setExpandedUid((cur) => (cur === t.uid ? null : t.uid))}
                        />
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}

          {/* Cards completos (o modo de estudo profundo). */}
          {view === 'detalhes' && (
            <div className="grid gap-4 xl:grid-cols-2">
              {docs.map((t) => (
                <UserCard key={t.uid} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
