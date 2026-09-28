/**
 * /receber — o destino do "Compartilhar → radinho" no celular (Web Share
 * Target, ver `share_target` em vite.config.ts). O app do Spotify/YouTube
 * manda `?title=&text=&url=`; o link sai de onde vier (ver `prepararLink`).
 *
 * PEDE UM TOQUE ANTES DE ENFILEIRAR. Qualquer site pode abrir
 * `/receber?url=…` num link; se isto enfileirasse sozinho, uma página
 * qualquer encheria a biblioteca de alguém sem ele pedir. A confirmação mostra
 * DE ONDE vem o link — o mesmo cuidado de "você quer abrir este app?".
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Link2 } from 'lucide-react';
import { RadinhoLogo } from '@/components/brand/RadinhoMark';
import { enfileirarLink } from '@/components/media/ColarLink';
import { Button } from '@/components/ui/button';
import { prepararLink } from '@/lib/local/linkColado';

export default function ReceberLinkPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const recebido = [params.get('url'), params.get('text'), params.get('title')]
    .filter(Boolean)
    .join(' ');
  const preparado = useMemo(() => prepararLink(recebido), [recebido]);
  const sair = (): void => void navigate('/', { replace: true });

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-bg px-5 text-center">
      <RadinhoLogo />
      {preparado.ok ? (
        <>
          <div className="max-w-sm space-y-2">
            <h1 className="text-xl font-semibold text-fg">Adicionar ao radinho?</h1>
            <p className="flex items-center justify-center gap-2 text-sm text-fg-muted">
              <Link2 className="size-4 shrink-0" aria-hidden />
              <span className="break-all">{new URL(preparado.url).hostname}</span>
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={sair}>
              Cancelar
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                if (enfileirarLink(preparado.url)) sair();
              }}
            >
              Adicionar
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="max-w-sm text-sm text-fg-muted">{preparado.message}</p>
          <Button variant="accent" onClick={sair}>
            Ir para o início
          </Button>
        </>
      )}
    </div>
  );
}
