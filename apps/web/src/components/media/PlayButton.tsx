import type { ComponentProps } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlayButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  playing?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Fumaça viva atrás do botão (tela cheia, barra do player). */
  aura?: boolean;
}

const sizes = {
  sm: 'size-8 [&_svg]:size-3.5',
  md: 'size-10 [&_svg]:size-4',
  lg: 'size-12 [&_svg]:size-5',
} as const;

/**
 * A AURA — fumaça, não sombra.
 *
 * O que havia atrás do botão era uma `box-shadow` colorida: um disco parado,
 * do mesmo tamanho para sempre. Aura é outra coisa — tem que se mexer.
 *
 * São três véus da cor de destaque, cada um borrado a ponto de perder a borda,
 * girando em sentidos opostos e respirando em tempos que não fecham entre si
 * (13s, 9s, 5s): como os ciclos não coincidem, a silhueta nunca se repete e o
 * olho lê névoa, não animação em laço. Fica atrás do círculo opaco do botão, e
 * só se vê o que extravasa — a fumaça ao redor.
 *
 * Fica quieta quando a música está pausada (aura de som que não sai é ruído
 * visual) e some inteira sob `prefers-reduced-motion`.
 */
const PLUMAS = [
  {
    animacao: 'aura-exalar-a',
    duracao: '4.5s',
    atraso: '-0.2s',
    blur: 'blur-lg',
    origem: '50% 60%',
  },
  { animacao: 'aura-exalar-b', duracao: '6s', atraso: '-2.4s', blur: 'blur-xl', origem: '42% 58%' },
  {
    animacao: 'aura-exalar-c',
    duracao: '5.2s',
    atraso: '-3.9s',
    blur: 'blur-lg',
    origem: '58% 62%',
  },
] as const;

function Aura({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-[-55%] hidden motion-safe:block',
        !playing && 'opacity-45',
      )}
    >
      <span
        className="absolute inset-0 rounded-full blur-xl"
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.85) 0%, hsl(var(--accent) / 0.25) 55%, transparent 78%)',
          animation: playing ? 'aura-drift-a 13s ease-in-out infinite' : undefined,
        }}
      />
      <span
        className="absolute inset-[12%] rounded-full blur-lg"
        style={{
          background:
            'radial-gradient(closest-side at 62% 38%, hsl(var(--accent) / 0.7) 0%, transparent 70%)',
          animation: playing ? 'aura-drift-b 9s ease-in-out infinite' : undefined,
        }}
      />
      <span
        className="absolute inset-[22%] rounded-full blur-md"
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.55) 0%, transparent 72%)',
          animation: playing ? 'aura-pulse 5s ease-in-out infinite' : undefined,
        }}
      />
      {/* AS PLUMAS — a fumaça saindo. Só com a música tocando: parado, um botão
          que fumega sozinho promete um som que não está saindo. Os atrasos são
          NEGATIVOS, para que as três já estejam no meio do caminho no primeiro
          quadro em vez de largarem juntas do zero. */}
      {playing &&
        PLUMAS.map((pluma) => (
          <span
            key={pluma.animacao}
            className={cn('absolute inset-[18%] rounded-full', pluma.blur)}
            style={{
              background: `radial-gradient(closest-side at ${pluma.origem}, hsl(var(--accent) / 0.6) 0%, hsl(var(--accent) / 0.18) 50%, transparent 75%)`,
              animation: `${pluma.animacao} ${pluma.duracao} linear infinite`,
              animationDelay: pluma.atraso,
            }}
          />
        ))}
    </span>
  );
}

/** Accent circle play/pause — transform/opacity-only animations. */
export function PlayButton({
  playing = false,
  size = 'md',
  aura = false,
  className,
  ...props
}: PlayButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={playing ? 'Pausar' : 'Reproduzir'}
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
      {playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
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
