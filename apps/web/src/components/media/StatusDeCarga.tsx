/**
 * A linha que conta o que o player está fazendo enquanto a música não sai.
 *
 * O texto vem de `textoDeCarga` (a mesma tradução para barra, mini player e
 * tela cheia). O relógio de 1s existe só enquanto há carga em curso: é ele que
 * faz "Carregando…" virar "está demorando mais que o normal" sem precisar de
 * nenhum evento novo do player — e, sem carga, nada fica acordado à toa.
 *
 * Com a música PAUSADA não diz nada: a carga pode continuar por baixo, mas a
 * pessoa não está esperando som, e um "carregando" ali soaria como defeito.
 */
import { useEffect, useState } from 'react';
import { textoDeCarga } from '@/lib/audio/estadoDeCarga';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

/** O texto de agora, ou `null` — para quem precisa decidir o que TROCAR por ele
 *  (o mini player põe o status no lugar do artista, que é a linha que tem). */
export function useTextoDeCarga(): string | null {
  const carga = usePlayerStore((s) => s.carga);
  const tocando = usePlayerStore((s) => s.isPlaying);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!carga) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [carga]);

  return tocando ? textoDeCarga(carga, agora) : null;
}

export function StatusDeCarga({ className }: { className?: string }) {
  const texto = useTextoDeCarga();
  if (!texto) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      title={texto}
      className={cn('line-clamp-2 text-[12px] leading-snug text-fg-muted', className)}
    >
      <span
        aria-hidden
        className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent align-middle"
      />
      {texto}
    </p>
  );
}
