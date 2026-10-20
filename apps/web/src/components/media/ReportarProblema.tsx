/**
 * "REPORTAR PROBLEMA" — o botão do player expandido.
 *
 * Quem ouve diz o que aconteceu com UM toque numa lista fechada (som não
 * tocou, demorou, letra fora de sincronia, vídeo não carregou…) e, se quiser,
 * uma linha de texto. O relato leva a faixa, a posição e as últimas linhas do
 * diário de bordo, e vai para o painel de telemetria na hora
 * (ver lib/telemetry/relatos.ts). É a memória do que incomodou de verdade,
 * para consertar o que mais acontece — pedido do dono, 20/10/2026.
 */
import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { usePlayerStore } from '@/stores/playerStore';
import { registrarRelato, TIPOS_DE_RELATO, type TipoDeRelato } from '@/lib/telemetry/relatos';
import { enviarRelatosAgora } from '@/lib/telemetry/telemetry';

export function ReportarProblema() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoDeRelato | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const faixa = usePlayerStore((s) => s.currentTrack);

  const enviar = (): void => {
    if (!tipo) return;
    const estado = usePlayerStore.getState();
    registrarRelato({
      tipo,
      trackId: faixa?.id ?? null,
      titulo: faixa?.title ?? null,
      artista: faixa?.artists[0]?.name ?? null,
      posicaoSeg: estado.progress,
      detalhe,
    });
    enviarRelatosAgora();
    setAberto(false);
    setTipo(null);
    setDetalhe('');
    toast.success('Obrigado! O relato foi registrado.');
  };

  return (
    <>
      <IconButton aria-label="Reportar problema" size="sm" onClick={() => setAberto(true)}>
        <Flag />
      </IconButton>
      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>O que aconteceu?</DialogTitle>
            <DialogDescription>
              {faixa ? `Com "${faixa.title}". ` : ''}Seu relato vai com a posição da música e o que
              o app estava fazendo — é o que nos deixa consertar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Tipo de problema">
            {TIPOS_DE_RELATO.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tipo === t.id}
                onClick={() => setTipo(t.id)}
                className={
                  'rounded-md border px-3 py-2 text-left text-sm ' +
                  (tipo === t.id
                    ? 'border-accent bg-accent/10 text-fg'
                    : 'border-border bg-bg-elevated text-fg-muted hover:text-fg')
                }
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <textarea
            aria-label="Detalhe (opcional)"
            value={detalhe}
            onChange={(e) => setDetalhe(e.target.value)}
            placeholder="Quer contar mais? (opcional)"
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg"
          />
          <Button variant="accent" disabled={!tipo} onClick={enviar}>
            Enviar relato
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
