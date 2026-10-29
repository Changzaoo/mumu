/**
 * O FOGUINHO — a sequência de dias sempre à vista (no topo, ao lado da foto).
 * Aceso (laranja) quando a meta de hoje já foi batida; apagado (cinza) quando
 * ainda falta — e o anel em volta mostra quanto falta para acender.
 */
import { Flame } from 'lucide-react';
import { Link } from 'react-router';
import { progressoDeHoje, useJornada } from '@/hooks/useJornada';
import { LARANJA } from '@/lib/jornada/visual';
import { cn } from '@/lib/utils';

export function Foguinho({ className }: { className?: string }) {
  const e = useJornada();
  const p = progressoDeHoje(e);
  const aceso = p >= 1;
  const r = 15;
  const volta = 2 * Math.PI * r;
  return (
    <Link
      to="/jornada"
      data-testid="foguinho"
      aria-label={`${e.sequencia} ${e.sequencia === 1 ? 'dia seguido' : 'dias seguidos'}${aceso ? ', meta de hoje batida' : ''}`}
      className={cn(
        'relative flex h-9 items-center gap-1 rounded-full pl-1 pr-2.5 text-sm font-bold tabular-nums transition-colors hover:bg-fg/5',
        className,
      )}
      style={{ color: aceso ? LARANJA : undefined }}
    >
      <span className="relative grid size-8 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={2.5}
          />
          {!aceso && p > 0 && (
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              stroke={LARANJA}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={`${volta * p} ${volta}`}
            />
          )}
        </svg>
        <Flame
          className={cn('size-[18px]', aceso ? 'fill-current' : 'text-fg-muted')}
          strokeWidth={2.2}
        />
      </span>
      <span className={aceso ? undefined : 'text-fg-muted'}>{e.sequencia}</span>
    </Link>
  );
}
