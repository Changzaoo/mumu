/**
 * Os créditos de UMA faixa, no player: "Produção: A, B · Composição: C".
 * Cada nome é um link — para a ficha do artista quando ele está no acervo,
 * para a página da pessoa (/pessoa/:chave) quando não, para a gravadora
 * quando é selo. Some sem crédito nenhum.
 */
import { Link } from 'react-router';
import type { TrackDto } from '@radinho/shared';
import { anotar } from '@/lib/telemetry/diario';
import {
  destinoDoCredito,
  porPapel,
  ROTULO_DO_PAPEL,
  useCreditosDaFaixa,
  type Credito,
} from '@/lib/mundo/creditos';
import { cn } from '@/lib/utils';

export function NomeCreditado({ credito, className }: { credito: Credito; className?: string }) {
  return (
    <Link
      to={destinoDoCredito(credito)}
      aria-label={`crédito: ${credito.nome}`}
      onClick={() =>
        anotar('mundo', 'credito', {
          papel: credito.papel,
          nome: credito.nome,
          fonte: credito.fonte,
        })
      }
      className={cn('hover:text-accent hover:underline', className)}
    >
      {credito.nome}
    </Link>
  );
}

export function CreditosDaFaixa({
  track,
  ligado = true,
  className,
}: {
  track: TrackDto | null | undefined;
  ligado?: boolean;
  className?: string;
}) {
  const { data } = useCreditosDaFaixa(track, ligado);
  const grupos = data ? porPapel(data.creditos) : [];
  if (grupos.length === 0) return null;
  return (
    <div className={cn('space-y-0.5 text-[11px] leading-relaxed text-fg-subtle', className)}>
      {grupos.map((g) => (
        <p key={g.papel}>
          {ROTULO_DO_PAPEL[g.papel]}:{' '}
          {g.nomes.map((c, i) => (
            <span key={c.chave}>
              {i > 0 && ', '}
              <NomeCreditado credito={c} />
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
