/**
 * "Seguir" e "Tocar as melhores" de um artista do ACERVO (a ficha /artista/:nome).
 *
 * Peças soltas de propósito: a página do artista encaixa as duas na fileira de
 * ações do HeroHeader; a lateral usa o hook e o "tocar". Seguir é o que põe o
 * artista como círculo na lateral (ver lib/local/artistasSeguidos).
 */
import { Play, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSegueArtista } from '@/hooks/useSegueArtista';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import {
  prepararMelhoresDoArtista,
  tocarMelhoresDoArtista,
} from '@/lib/reco/tocarMelhoresDoArtista';
import { cn } from '@/lib/utils';

export function SeguirArtistaButton({
  nome,
  capaUrl,
  className,
}: {
  nome: string;
  /** Capa de reserva para a lateral enquanto a foto não chega. */
  capaUrl?: string | null;
  className?: string;
}) {
  const segue = useSegueArtista(nome);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={segue}
      onClick={() => artistasSeguidos.alternar(nome, capaUrl)}
      className={cn('rounded-full', segue && 'border-accent/50 text-accent', className)}
    >
      {segue ? <UserCheck /> : <UserPlus />}
      {segue ? 'Seguindo' : 'Seguir'}
    </Button>
  );
}

/** "This is <artista>": toca as mais populares dele que existem no acervo. */
export function TocarMelhoresButton({ nome, className }: { nome: string; className?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onPointerEnter={() => prepararMelhoresDoArtista(nome)}
      onFocus={() => prepararMelhoresDoArtista(nome)}
      onClick={() => tocarMelhoresDoArtista(nome)}
      className={cn('rounded-full', className)}
    >
      <Play className="fill-current" />
      Tocar as melhores
    </Button>
  );
}
