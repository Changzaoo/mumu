/**
 * /telemetria — painel do admin com a telemetria de CADA usuário (docs
 * `telemetry/{uid}` no Firestore, escritos pelo próprio app de cada um):
 * velocidade real de internet (↓/↑ medida contra o importer), tempo com o app
 * aberto, sessões, plataforma, o que mais ouve e o histórico recente.
 * Rota protegida por AuthorizedRoute; as regras do Firestore limitam a leitura
 * aos e-mails de admin.
 */
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Clock,
  Gauge,
  Heart,
  Library,
  MonitorSmartphone,
  Music2,
  Users,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { EmptyState } from '@/components/media/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import type { RecentPlay, TopEntry } from '@/lib/telemetry/telemetry';

interface TelemetryDoc {
  uid: string;
  email: string | null;
  displayName: string | null;
  platform?: string;
  lastSeenAt?: string;
  totalSeconds?: number;
  sessions?: number;
  netDownMbps?: number | null;
  netUpMbps?: number | null;
  netMeasuredAt?: string;
  connection?: { effectiveType?: string; downlinkMbps?: number; rttMs?: number };
  libraryCount?: number;
  likedCount?: number;
  topTracks?: TopEntry[];
  topArtists?: TopEntry[];
  recentPlays?: RecentPlay[];
}

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

function Stat({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-fg/4 px-3 py-2">
      <Icon className="size-4 shrink-0 text-fg-muted" />
      <div className="min-w-0">
        <p className="text-[11px] text-fg-subtle">{label}</p>
        <p className="truncate text-[13px] font-semibold text-fg">{value}</p>
      </div>
    </div>
  );
}

function UserCard({ t }: { t: TelemetryDoc }) {
  const [showHistory, setShowHistory] = useState(false);
  const online = t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < 3 * 60_000;

  return (
    <article className="space-y-4 rounded-xl border border-border bg-bg-elevated p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-fg">
            {t.displayName || t.email || t.uid}
          </h2>
          <p className="truncate text-[12px] text-fg-muted">{t.email ?? t.uid}</p>
        </div>
        <Badge variant={online ? 'accent' : 'default'}>
          {online ? 'Online' : `Visto ${formatWhen(t.lastSeenAt)}`}
        </Badge>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          icon={ArrowDown}
          label="Download"
          value={t.netDownMbps != null ? `${t.netDownMbps} Mbps` : '—'}
        />
        <Stat
          icon={ArrowUp}
          label="Upload"
          value={t.netUpMbps != null ? `${t.netUpMbps} Mbps` : '—'}
        />
        <Stat icon={Clock} label="Tempo no app" value={formatHours(t.totalSeconds)} />
        <Stat icon={Activity} label="Sessões" value={String(t.sessions ?? 0)} />
        <Stat icon={MonitorSmartphone} label="Plataforma" value={t.platform ?? '—'} />
        <Stat
          icon={Gauge}
          label="Conexão (navegador)"
          value={
            t.connection?.effectiveType
              ? `${t.connection.effectiveType}${t.connection.downlinkMbps ? ` · ${t.connection.downlinkMbps} Mbps` : ''}`
              : '—'
          }
        />
        <Stat icon={Library} label="Biblioteca" value={`${t.libraryCount ?? 0} faixas`} />
        <Stat icon={Heart} label="Curtidas" value={String(t.likedCount ?? 0)} />
      </div>

      {(t.topArtists?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
            <Users className="size-3.5" /> Mais ouvidos
          </p>
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
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
            <Music2 className="size-3.5" /> Músicas mais tocadas
          </p>
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

      {(t.recentPlays?.length ?? 0) > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[12px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {showHistory ? 'Ocultar histórico' : `Ver histórico (${t.recentPlays!.length})`}
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
        const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as TelemetryDoc);
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
          Velocidade de internet, tempo de uso e o que cada usuário mais escuta — para melhorar a
          plataforma.
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
