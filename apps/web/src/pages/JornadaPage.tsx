/**
 * SUA JORNADA — o painel do hábito (pedido do dono, 29/10/2026).
 *
 * Em ordem do que mais faz a pessoa voltar amanhã (lição do reel sobre o
 * Duolingo): o foguinho e a semana, a meta de hoje, a liga semanal, o nível,
 * os amigos libertados dos anúncios e do streaming pago, e as conquistas com
 * o quanto falta para cada uma.
 */
import { Check, Copy, Flame, Share2, Shield, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthUser } from '@/hooks/useAuthUser';
import { progressoDeHoje, useJornada } from '@/hooks/useJornada';
import { CONQUISTAS, NOME_DA_RARIDADE, type Conquista } from '@/lib/jornada/conquistas';
import { chaveDoDia, segundaDaSemana, somarDias } from '@/lib/jornada/datas';
import * as jornada from '@/lib/jornada/jornada';
import {
  aoChegarJornada,
  DESCEM,
  enviarJornada,
  LIGAS,
  linkDeConvite,
  PRECO_DO_STREAMING,
  SOBEM,
  ultimaJornada,
} from '@/lib/jornada/servidor';
import { COR_DA_RARIDADE, LARANJA } from '@/lib/jornada/visual';
import { cn } from '@/lib/utils';
import { Desenho } from '@/components/icones/Desenho';

const DIAS_DA_SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const METAS = [10, 15, 30, 60];
const GRUPOS: Conquista['grupo'][] = [
  'Sequência',
  'Hábito',
  'Escuta',
  'Exploração',
  'Amigos',
  'Liga',
  'Coleção',
];

const real = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function Cartao({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border bg-bg-elevated/60 p-5', className)}>
      {children}
    </section>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
      {children}
    </h2>
  );
}

function Semana({ e }: { e: jornada.EstadoJornada }) {
  const hoje = chaveDoDia();
  const segunda = segundaDaSemana(hoje);
  return (
    <div className="mt-5 grid grid-cols-7 gap-2">
      {DIAS_DA_SEMANA.map((letra, i) => {
        const dia = somarDias(segunda, i);
        const feito = (e.dias[dia] ?? 0) >= e.metaMin * 60;
        const protegido = e.protegidos.includes(dia);
        const futuro = dia > hoje;
        return (
          <div key={dia} className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                'text-[11px] font-semibold',
                dia === hoje ? 'text-fg' : 'text-fg-subtle',
              )}
            >
              {letra}
            </span>
            <span
              className={cn(
                'grid size-9 place-items-center rounded-full border-2',
                feito
                  ? 'border-transparent text-white'
                  : protegido
                    ? 'border-transparent bg-sky-500/20 text-sky-400'
                    : dia === hoje
                      ? 'border-dashed border-fg/40 text-fg-muted'
                      : futuro
                        ? 'border-fg/10'
                        : 'border-fg/10 text-fg-subtle',
              )}
              style={feito ? { background: LARANJA } : undefined}
            >
              {feito ? (
                <Flame className="size-4 fill-current" />
              ) : protegido ? (
                <Shield className="size-4" />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Liga({ logado }: { logado: boolean }) {
  const [dados, setDados] = useState(ultimaJornada);
  useEffect(() => aoChegarJornada(setDados), []);
  useEffect(() => {
    if (logado) void enviarJornada();
  }, [logado]);
  const fimDaSemana = useMemo(() => {
    const segunda = segundaDaSemana(chaveDoDia());
    const fim = new Date(`${somarDias(segunda, 7)}T00:00:00`);
    const ms = fim.getTime() - Date.now();
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  }, []);

  if (!logado) {
    return (
      <Cartao>
        <Titulo>Liga semanal</Titulo>
        <p className="text-lg font-semibold">
          <Desenho nome="trofeu" /> Dispute com quem ouve tanto quanto você
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          Toda semana, grupos de até 30 pessoas. Os {SOBEM} primeiros sobem de liga — do Bronze ao
          Diamante.
        </p>
        <Link
          to="/login"
          className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-fg"
        >
          Entrar para competir
        </Link>
      </Cartao>
    );
  }
  const liga = LIGAS[dados?.liga ?? 0]!;
  const grupo = dados?.grupo ?? [];
  return (
    <Cartao>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Titulo>Liga semanal</Titulo>
          <p className="text-2xl font-bold" style={{ color: liga.cor }}>
            <Desenho nome={liga.icone} /> Liga {liga.nome}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {dados ? `Você está em ${dados.posicao}º · ` : ''}acaba em {fimDaSemana}
          </p>
        </div>
        <div className="flex gap-1 text-xl" aria-hidden>
          {LIGAS.map((l, i) => (
            <span key={l.nome} className={i === (dados?.liga ?? 0) ? '' : 'opacity-25 grayscale'}>
              <Desenho nome={l.icone} />
            </span>
          ))}
        </div>
      </div>
      {grupo.length > 0 && (
        <ol className="mt-4 space-y-1">
          {grupo.map((m, i) => {
            const pos = m.eu && dados ? dados.posicao : i + 1;
            const sobe = pos <= SOBEM && m.xp > 0;
            const desce =
              (dados?.liga ?? 0) > 0 && grupo.length >= 10 && pos > grupo.length - DESCEM;
            return (
              <li
                key={m.handle}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm',
                  m.eu && 'bg-accent/12 ring-1 ring-accent/40',
                )}
              >
                <span
                  className={cn(
                    'w-6 text-center font-bold tabular-nums',
                    sobe ? 'text-emerald-400' : desce ? 'text-rose-400' : 'text-fg-muted',
                  )}
                >
                  {pos}
                </span>
                <Avatar className="size-8">
                  {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                  <AvatarFallback>{m.displayName.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {m.displayName}
                  {m.eu && <span className="ml-1 text-fg-muted">(você)</span>}
                </span>
                {m.sequencia > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs font-semibold"
                    style={{ color: LARANJA }}
                  >
                    <Flame className="size-3.5 fill-current" />
                    {m.sequencia}
                  </span>
                )}
                <span className="w-16 text-right font-semibold tabular-nums">{m.xp} XP</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-fg-subtle">
        <span className="text-emerald-400">●</span> top {SOBEM} sobem ·{' '}
        <span className="text-rose-400">●</span> últimos {DESCEM} descem · 1 XP por minuto ouvido
      </p>
    </Cartao>
  );
}

function Amigos({
  handle,
  logado,
  amigos,
}: {
  handle: string | null;
  logado: boolean;
  amigos: number;
}) {
  const link = handle ? linkDeConvite(handle) : null;
  const [copiado, setCopiado] = useState(false);
  const texto =
    'Larguei o streaming pago: no radinho.online tem música de graça, sem anúncio e sem cadastro. Vem ouvir comigo:';
  const compartilhar = async (): Promise<void> => {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'radinho.online', text: texto, url: link });
        return;
      } catch {
        /* cancelou: copia */
      }
    }
    await navigator.clipboard?.writeText(`${texto} ${link}`).catch(() => undefined);
    setCopiado(true);
    toast('Link copiado', { description: 'Mande no grupo da família, da firma, do futebol…' });
  };
  const proximoMarco = [1, 5, 25, 100].find((m) => m > amigos) ?? amigos + 100;
  return (
    <Cartao className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #34d399, transparent 70%)' }}
      />
      <Titulo>Liberte seus amigos</Titulo>
      <p
        className="text-5xl font-black tabular-nums tracking-tight"
        data-testid="amigos-libertados"
      >
        {amigos}
      </p>
      <p className="mt-1 text-sm font-medium">
        {amigos === 1 ? 'amigo libertado' : 'amigos libertados'} dos anúncios e do streaming pago
      </p>
      {amigos > 0 ? (
        <p className="mt-1 text-sm text-emerald-400">
          ≈ {real(amigos * PRECO_DO_STREAMING)} por mês que ficam no bolso deles ·{' '}
          {real(amigos * PRECO_DO_STREAMING * 12)} por ano
        </p>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">
          Cada amigo que entra pelo seu link para de pagar ≈ {real(PRECO_DO_STREAMING)} por mês.
        </p>
      )}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-fg/10">
        <div
          className="h-full rounded-full bg-emerald-400"
          style={{ width: `${Math.min(100, (amigos / proximoMarco) * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-fg-subtle">
        Próximo marco: {proximoMarco} {proximoMarco === 1 ? 'amigo' : 'amigos'}
      </p>
      {logado && link ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void compartilhar()}
            className="flex items-center gap-2 rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-black"
          >
            <Share2 className="size-4" /> Convidar amigos
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopiado(true));
            }}
            className="flex min-w-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm"
          >
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            <span className="truncate">{link.replace('https://', '')}</span>
          </button>
        </div>
      ) : (
        <Link
          to="/login"
          className="mt-4 inline-block rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-black"
        >
          Entrar para ganhar seu link
        </Link>
      )}
    </Cartao>
  );
}

function Conquistas({ e }: { e: jornada.EstadoJornada }) {
  const ctx = jornada.contexto(e);
  const [aberta, setAberta] = useState<string | null>(null);
  const ganhas = Object.keys(e.conquistas).length;
  return (
    <Cartao>
      <div className="mb-3 flex items-baseline justify-between">
        <Titulo>Conquistas</Titulo>
        <span className="text-sm font-semibold text-fg-muted">
          {ganhas}/{CONQUISTAS.length}
        </span>
      </div>
      <div className="space-y-5">
        {GRUPOS.map((g) => (
          <div key={g}>
            <p className="mb-2 text-sm font-semibold">{g}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {CONQUISTAS.filter((q) => q.grupo === g).map((q) => {
                const quando = e.conquistas[q.id];
                const [tem, alvo] = q.progresso(ctx);
                const cor = COR_DA_RARIDADE[q.raridade];
                const detalhe = aberta === q.id;
                return (
                  <button
                    type="button"
                    key={q.id}
                    onClick={() => setAberta(detalhe ? null : q.id)}
                    className={cn(
                      'flex flex-col items-center rounded-2xl border p-3 text-center transition-colors',
                      detalhe && 'col-span-3 sm:col-span-4 lg:col-span-6',
                      quando ? 'border-transparent' : 'border-border',
                    )}
                    style={
                      quando
                        ? { background: `${cor}1a`, boxShadow: `0 0 0 1px ${cor}55 inset` }
                        : undefined
                    }
                  >
                    <span
                      className={cn(
                        'grid size-12 place-items-center rounded-full text-2xl',
                        !quando && 'opacity-40 grayscale',
                      )}
                      style={
                        quando
                          ? { boxShadow: `0 0 0 2px ${cor}` }
                          : { background: 'rgb(127 127 127 / .12)' }
                      }
                    >
                      <Desenho nome={q.icone} />
                    </span>
                    <span
                      className={cn(
                        'mt-2 text-xs font-semibold leading-tight',
                        !quando && 'text-fg-muted',
                      )}
                    >
                      {q.nome}
                    </span>
                    {!quando && (
                      <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-fg/10">
                        <span
                          className="block h-full rounded-full bg-fg/40"
                          style={{ width: `${Math.min(100, (tem / alvo) * 100)}%` }}
                        />
                      </span>
                    )}
                    {detalhe && (
                      <span className="mt-2 block text-sm text-fg-muted">
                        {q.descricao}
                        <span className="mt-2 flex flex-wrap justify-center gap-2 text-[11px] font-medium">
                          <span
                            className="rounded-full px-2 py-0.5"
                            style={{ background: `${cor}26`, color: cor }}
                          >
                            {NOME_DA_RARIDADE[q.raridade]}
                          </span>
                          <span className="rounded-full bg-fg/10 px-2 py-0.5">+{q.xp} XP</span>
                          <span className="rounded-full bg-fg/10 px-2 py-0.5">
                            {quando
                              ? `Ganha em ${new Date(quando).toLocaleDateString('pt-BR')}`
                              : `${Math.min(tem, alvo)}/${alvo}`}
                          </span>
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Cartao>
  );
}

export default function JornadaPage() {
  const e = useJornada();
  const { user, profile } = useAuthUser();
  const logado = Boolean(user && !user.isAnonymous);
  const servidor = useSyncExternalStore(aoChegarJornada, ultimaJornada, () => null);
  const handle = profile?.handle ?? servidor?.handle ?? null;
  const p = progressoDeHoje(e);
  const ouvidoHoje = Math.floor((e.dias[chaveDoDia()] ?? 0) / 60);
  const { nivel, base, proximo } = jornada.nivelDoXp(e.xp);
  const aceso = p >= 1;
  const r = 52;
  const volta = 2 * Math.PI * r;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-10 pt-4 md:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Sua jornada</h1>

      {/* O foguinho */}
      <Cartao className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle, ${LARANJA}${aceso ? '55' : '22'}, transparent 70%)`,
          }}
        />
        <div className="relative flex items-center gap-5">
          <div className="relative grid size-32 shrink-0 place-items-center">
            <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeWidth={8}
              />
              <circle
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={LARANJA}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={`${volta * p} ${volta}`}
              />
            </svg>
            <div className="text-center" style={{ color: aceso ? LARANJA : undefined }}>
              <Flame className={cn('mx-auto size-9', aceso ? 'fill-current' : 'text-fg-muted')} />
              <span className="block text-4xl font-black tabular-nums leading-none">
                {e.sequencia}
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold">
              {e.sequencia === 0
                ? 'Acenda seu foguinho'
                : `${e.sequencia} ${e.sequencia === 1 ? 'dia seguido' : 'dias seguidos'}`}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {aceso
                ? 'Meta de hoje batida. Volte amanhã para manter a chama.'
                : `Hoje: ${ouvidoHoje} de ${e.metaMin} min. Faltam ${Math.max(1, e.metaMin - ouvidoHoje)} min.`}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1 font-semibold">
                <Trophy className="size-4 text-amber-400" /> Recorde: {e.recorde}
              </span>
              <span className="flex items-center gap-1" title="Protetores de sequência">
                {[0, 1].map((i) => (
                  <Shield
                    key={i}
                    className={cn(
                      'size-4',
                      i < e.protetores ? 'fill-sky-400 text-sky-400' : 'text-fg-subtle',
                    )}
                  />
                ))}
                <span className="text-fg-muted">protetores</span>
              </span>
            </p>
          </div>
        </div>
        <Semana e={e} />
        <p className="mt-4 text-xs text-fg-subtle">
          A cada 7 dias seguidos você ganha um protetor (até 2). Se um dia passar sem música, ele
          segura a sequência.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">Meta diária:</span>
          {METAS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => jornada.definirMeta(m)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-medium',
                e.metaMin === m
                  ? 'border-transparent bg-fg text-bg'
                  : 'border-border text-fg-muted hover:text-fg',
              )}
            >
              {m} min
            </button>
          ))}
        </div>
      </Cartao>

      <Liga logado={logado} />

      {/* Nível */}
      <Cartao>
        <Titulo>Nível</Titulo>
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold">
            Nível {nivel}{' '}
            <span className="text-base font-medium text-fg-muted">
              · {jornada.tituloDoNivel(nivel)}
            </span>
          </p>
          <p className="text-sm tabular-nums text-fg-muted">
            {e.xp - base}/{proximo - base} XP
          </p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-fg/10">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${((e.xp - base) / (proximo - base)) * 100}%` }}
          />
        </div>
        <p className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <span>
            <b className="block text-lg tabular-nums">{e.xpSemana}</b>
            <span className="text-fg-muted">XP na semana</span>
          </span>
          <span>
            <b className="block text-lg tabular-nums">{e.faixas}</b>
            <span className="text-fg-muted">músicas</span>
          </span>
          <span>
            <b className="block text-lg tabular-nums">{e.artistas.length}</b>
            <span className="text-fg-muted">artistas</span>
          </span>
        </p>
      </Cartao>

      <div id="amigos" className="scroll-mt-20">
        <Amigos handle={handle} logado={logado} amigos={servidor?.amigos ?? e.amigos} />
      </div>

      <Conquistas e={e} />
    </div>
  );
}
