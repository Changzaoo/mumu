import type { ComponentProps } from 'react';
import { Disc3, Pause, Play } from 'lucide-react';
import { FumacaDoPlay } from '@/components/media/FumacaDoPlay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { cn } from '@/lib/utils';

export interface PlayButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Fumaça viva atrás do botão (tela cheia, barra do player). */
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
 * A AURA — fumaça subindo, não sombra.
 *
 * Embaixo, dois véus da cor de destaque giram em sentidos opostos e respiram
 * (13s e 9s; no toque, o dobro da pressa): a névoa que envolve o botão. Por
 * cima, a FUMAÇA de verdade sobe do círculo — desenhada na hora, sorteada
 * baforada a baforada, sem ciclo que o olho reconheça (ver `FumacaDoPlay`).
 * Tudo fica atrás do círculo opaco do botão — só aparece o que extravasa.
 *
 * O PORQUÊ DE ELA NUNCA TER SE MEXIDO: os @keyframes moravam dentro do
 * `@theme` do Tailwind v4, que descarta no build todo keyframe não usado por
 * uma variável `--animate-*`. Como estes são chamados por estilo inline, o
 * Tailwind não os via e o CSS final saía sem nenhum. Agora vivem no nível de
 * cima de `globals.css`.
 *
 * PAUSAR NÃO CORTA. Antes a pausa arrancava a animação dos véus (que pulavam de
 * volta à posição zero) e desmontava os fios de fumaça no meio do ar. Agora os
 * véus só CONGELAM onde estão (`animation-play-state`) e escurecem devagar, e a
 * fumaça para de nascer mas a que já subiu termina o caminho e se desfaz. Um
 * botão que fumega sem som saindo promete o que não está acontecendo — mas a
 * fumaça que já estava no ar não some por decreto.
 *
 * Sob `prefers-reduced-motion` (ou o ajuste do app) a névoa continua lá, só sem
 * movimento, e não sobe fumaça: sumir com tudo deixava o botão "sem aura
 * nenhuma" para quem desligou as animações do Windows, e movimento não é a
 * única coisa que ela entrega.
 */
function Aura({ playing }: { playing: boolean }) {
  const toque = useMediaQuery('(pointer: coarse)');
  const semMovimento = useSemMovimento();
  const estado = playing ? 'running' : 'paused';
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute transition-opacity duration-[1200ms]',
          toque ? 'inset-[-65%]' : 'inset-[-55%]',
          !playing && 'opacity-45',
        )}
      >
        <span
          className="absolute inset-0 rounded-full blur-xl motion-reduce:!animate-none"
          style={{
            background:
              'radial-gradient(closest-side, hsl(var(--accent) / 0.8) 0%, hsl(var(--accent) / 0.22) 55%, transparent 78%)',
            animation: semMovimento
              ? undefined
              : `aura-drift-a ${toque ? '6s' : '13s'} ease-in-out infinite`,
            animationPlayState: estado,
          }}
        />
        <span
          className="absolute inset-[12%] rounded-full blur-lg motion-reduce:!animate-none"
          style={{
            background:
              'radial-gradient(closest-side at 62% 38%, hsl(var(--accent) / 0.6) 0%, transparent 70%)',
            animation: semMovimento
              ? undefined
              : `aura-drift-b ${toque ? '4.5s' : '9s'} ease-in-out infinite`,
            animationPlayState: estado,
          }}
        />
      </span>
      {/* Fumaça parada no ar não é fumaça, é mancha: sem movimento, nada sobe. */}
      {!semMovimento && <FumacaDoPlay emitindo={playing} toque={toque} />}
    </>
  );
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
