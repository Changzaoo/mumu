import type { ComponentProps } from 'react';
import { Disc3, Pause, Play } from 'lucide-react';
import { AuraDoPlay } from '@/components/media/AuraDoPlay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { cn } from '@/lib/utils';

export interface PlayButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Aura viva em volta do botão (tela cheia, barra do player). */
  aura?: boolean;
  /** A música está sendo trazida: o botão vira o disco girando. */
  carregando?: boolean;
}

const sizes = {
  sm: 'size-8 [&_svg]:size-3.5',
  md: 'size-10 [&_svg]:size-4',
  lg: 'size-12 [&_svg]:size-5',
} as const;

/**
 * A AURA — halo em volta, não fumaça subindo.
 *
 * Um anel e dois lóbulos da cor de destaque atrás do círculo, se mexendo por
 * derivas sorteadas que nunca fecham um ciclo (ver `AuraDoPlay`). Tudo fica
 * atrás do círculo opaco do botão — só aparece o que extravasa.
 *
 * A fumaça que subia do botão (`FumacaDoPlay`) saiu: era demais, tomava o
 * espaço acima do play e disputava atenção com a capa. A aura fica colada ao
 * botão, ao redor dele.
 *
 * PAUSAR NÃO CORTA: a aura desacelera e esmaece até assentar parada onde
 * estava. Sem movimento pedido, ela continua lá, só sem se mexer — sumir com
 * tudo deixava o botão "sem aura nenhuma" para quem desligou as animações.
 */
function Aura({ playing }: { playing: boolean }) {
  const toque = useMediaQuery('(pointer: coarse)');
  return <AuraDoPlay playing={playing} toque={toque} />;
}

/**
 * O DISCO GIRANDO — o botão enquanto a música está sendo trazida.
 *
 * Enquanto o player conta o que está fazendo ("Preparando a música…",
 * "Buscando a música na fonte original…"), o play vira o mesmo disco que o app
 * usa para álbum (o `Disc3` das páginas de disco e do "Ir para o álbum"),
 * rodando dentro do mesmo círculo — a 33⅓ rotações, 1,8s por volta. Diz "está
 * vindo" sem trocar o botão por um spinner genérico; o círculo, o anel e a aura
 * continuam, e tocar nele continua pausando. Sem movimento pedido, o disco fica
 * parado — ainda diz "carregando" pela forma.
 */
function DiscoGirando() {
  // O ajuste do app vence o do sistema (ver `useSemMovimento`) — por isso a
  // decisão é daqui, e não um `motion-safe:` que só enxerga o sistema.
  const semMovimento = useSemMovimento();
  return (
    <Disc3
      aria-hidden
      className={cn('!size-[72%]', !semMovimento && 'animate-[disco-gira_1.8s_linear_infinite]')}
    />
  );
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
      {carregando ? (
        <DiscoGirando />
      ) : playing ? (
        <Pause className="fill-current" />
      ) : (
        <Play className="ml-0.5 fill-current" />
      )}
    </button>
  );

  if (!aura) return button;

  // A aura vem ANTES do botão na ordem do DOM (sem z-index negativo, que
  // escaparia para trás do fundo do painel): assim o círculo opaco pinta por
  // cima dela e sobra só a névoa em volta.
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', sizes[size])}>
      <Aura playing={playing} />
      {button}
    </span>
  );
}
