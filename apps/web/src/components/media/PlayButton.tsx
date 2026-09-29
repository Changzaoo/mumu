import type { ComponentProps } from 'react';
import { AuraDoPlay } from '@/components/media/AuraDoPlay';
import { IconeDoPlay } from '@/components/media/IconeDoPlay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

export interface PlayButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Aura viva em volta do botão (tela cheia, barra do player). */
  aura?: boolean;
  /** A música está sendo trazida: o ícone vira a seta de download. */
  carregando?: boolean;
}

const sizes = {
  sm: 'size-8 [&_svg]:size-3.5',
  md: 'size-10 [&_svg]:size-4',
  lg: 'size-12 [&_svg]:size-5',
} as const;

/**
 * A AURA — neblina em volta do botão, se movendo em formas que não se repetem.
 *
 * Névoa procedural (ruído 3D com domínio distorcido, semente sorteada) recortada
 * num anel colado ao botão, escorrendo para fora — ver `AuraDoPlay`. Fica atrás
 * do círculo opaco: só aparece o que extravasa.
 *
 * PAUSAR NÃO CORTA: a névoa desacelera e esmaece até assentar parada onde
 * estava. Sem movimento pedido, ela continua lá, só sem se mexer.
 */
function Aura({ playing, carregando }: { playing: boolean; carregando: boolean }) {
  const toque = useMediaQuery('(pointer: coarse)');
  return <AuraDoPlay playing={playing} toque={toque} carregando={carregando} />;
}

/** Accent circle play/pause — transform/opacity-only animations. */
export function PlayButton({
  playing = false,
  size = 'md',
  aura = false,
  carregando = false,
  className,
  ...props
}: PlayButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={playing ? 'Pausar' : 'Reproduzir'}
      aria-busy={carregando || undefined}
      className={cn(
        'grid shrink-0 select-none place-items-center rounded-full bg-accent text-accent-fg',
        'transition-transform duration-200',
        // O BOTÃO NÃO PODE SUMIR.
        //
        // O destaque deste app é preto e branco: no tema escuro o botão é um
        // círculo BRANCO. Sobre capa clara — a tela cheia põe a capa borrada no
        // fundo, o card põe a capa inteira — branco sobre branco é um botão
        // invisível, e a aura, que também é da cor de destaque, só piorava.
        //
        // O anel resolve sem depender de adivinhar o fundo: `accent-fg` é, por
        // definição do tema, a cor legível SOBRE o destaque — ou seja, sempre o
        // oposto do círculo. Fundo igual ao botão, o anel desenha a silhueta;
        // fundo contrastante, ele é só um contorno discreto. A sombra escura
        // por baixo dá a mesma ajuda na direção contrária.
        'ring-1 ring-accent-fg/40 shadow-[0_2px_10px_rgba(0,0,0,0.45)]',
        // Com a aura viva atrás, a sombra COLORIDA vira sujeira: duas camadas
        // da mesma cor disputando a mesma borda.
        // Sem aura (os cards, as capas), a sombra colorida VOLTA — mas junto
        // com a escura, que é o que segura o botão contra uma capa clara.
        aura
          ? 'relative'
          : 'shadow-[0_8px_24px_hsl(var(--accent)/0.35),0_2px_10px_rgba(0,0,0,0.45)]',
        'hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        sizes[size],
        className,
      )}
      {...props}
    >
      {/* Um ícone só, que SE TRANSFORMA entre play, pausa e disco — ver IconeDoPlay. */}
      <IconeDoPlay estado={carregando ? 'carregando' : playing ? 'pausa' : 'play'} />
    </button>
  );

  if (!aura) return button;

  // A aura vem ANTES do botão na ordem do DOM (sem z-index negativo, que
  // escaparia para trás do fundo do painel): assim o círculo opaco pinta por
  // cima dela e sobra só a névoa em volta.
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', sizes[size])}>
      <Aura playing={playing} carregando={carregando} />
      {button}
    </span>
  );
}
