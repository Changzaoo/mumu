/**
 * O CABEÇALHO DA CONTA nos menus (o da fotinha no topo e o "Mais" do celular):
 * foto, NOME em cima de tudo (pedido do dono, 29/10/2026) e, logo abaixo, a
 * jornada — nível, foguinho, protetores e amigos libertados. Tocar leva para
 * a página da jornada.
 */
import { Flame, Shield } from 'lucide-react';
import { Link } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import * as jornada from '@/lib/jornada/jornada';
import { progressoDeHoje, useJornada } from '@/hooks/useJornada';
import { LARANJA } from '@/lib/jornada/visual';

export function CabecalhoDaConta({
  nome,
  foto,
  aoIr,
}: {
  nome: string;
  foto?: string | null;
  aoIr?: () => void;
}) {
  const e = useJornada();
  const { nivel, base, proximo } = jornada.nivelDoXp(e.xp);
  const aceso = progressoDeHoje(e) >= 1;
  return (
    <Link
      to="/jornada"
      onClick={aoIr}
      data-testid="cabecalho-da-conta"
      className="block rounded-xl p-2 transition-colors hover:bg-fg/5"
    >
      <span className="flex items-center gap-3">
        <Avatar className="size-11">
          {foto && <AvatarImage src={foto} alt="" />}
          <AvatarFallback>{nome.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-fg">{nome}</span>
          <span className="block truncate text-xs text-fg-muted">
            Nível {nivel} · {jornada.tituloDoNivel(nivel)}
          </span>
        </span>
      </span>
      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-fg/10">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${((e.xp - base) / (proximo - base)) * 100}%` }}
        />
      </span>
      <span className="mt-2 flex items-center gap-3 text-xs font-semibold tabular-nums">
        <span className="flex items-center gap-1" style={{ color: aceso ? LARANJA : undefined }}>
          <Flame className={aceso ? 'size-4 fill-current' : 'size-4 text-fg-muted'} />
          <span className={aceso ? undefined : 'text-fg-muted'}>
            {e.sequencia} {e.sequencia === 1 ? 'dia' : 'dias'}
          </span>
        </span>
        <span className="flex items-center gap-1 text-fg-muted">
          <Shield className="size-4" /> {e.protetores}
        </span>
        <span className="text-fg-muted">🏆 {Object.keys(e.conquistas).length}</span>
        {e.amigos > 0 && <span className="text-fg-muted">🕊️ {e.amigos}</span>}
      </span>
    </Link>
  );
}
