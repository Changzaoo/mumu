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
import { PlayButton, type PlayButtonProps } from '@/components/media/PlayButton';
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

/**
 * A FAIXA JÁ ESTÁ PRONTA, NO PONTO CERTO — só falta o toque que o navegador
 * exige. Acontece ao reabrir o app depois de uma atualização: a página tenta
 * retomar sozinha de onde a música estava, e a política de autoplay recusa
 * sem gesto do usuário (ver `resumeInvite` em `playerStore.ts`).
 *
 * DELIBERADAMENTE FORA de `useTextoDeCarga`: aquele texto alimenta o disco
 * girando do play (`PlayDoPlayer`), e este convite é o oposto — o botão
 * continua parado, mostrando claramente "aperte para tocar". Confundir os
 * dois faria o play girar sem nenhuma carga em curso.
 */
export function useConviteDeRetomada(): string | null {
  const resumeInvite = usePlayerStore((s) => s.resumeInvite);
  return resumeInvite ? 'Toque em play para continuar de onde parou' : null;
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

/**
 * O convite: mesma linha que `StatusDeCarga` ocuparia, sem o ponto pulsante
 * (não há nada "em andamento" — é a pessoa que decide o próximo passo) e sem
 * animação, para não competir com o play logo ao lado, que é quem já resolve.
 */
export function ConviteDeRetomada({ className }: { className?: string }) {
  const texto = useConviteDeRetomada();
  if (!texto) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      title={texto}
      className={cn('line-clamp-2 text-[12px] leading-snug text-accent', className)}
    >
      {texto}
    </p>
  );
}

/**
 * O PLAY DO PLAYER, que vira DISCO GIRANDO enquanto a música é trazida.
 *
 * A regra é a mesma do texto: enquanto há mensagem de carga na tela, o botão
 * gira; a música saiu, o texto some e o botão volta a ser play/pausa. Mora
 * aqui, num componente-folha, porque o relógio de 1s da carga acorda só ele —
 * não a tela cheia inteira, que fica montada o tempo todo.
 *
 * `local`: a carga é a DAQUI; espelhando outro aparelho não há o que girar.
 * `aguardando`: um sinal extra de espera (a barra do computador já trocava o
 * botão durante o `isBuffering`, antes de haver texto — agora troca pelo disco).
 */
export function PlayDoPlayer({
  local,
  aguardando = false,
  ...props
}: Omit<PlayButtonProps, 'carregando'> & { local: boolean; aguardando?: boolean }) {
  const texto = useTextoDeCarga();
  return <PlayButton {...props} carregando={local && (texto !== null || aguardando)} />;
}
