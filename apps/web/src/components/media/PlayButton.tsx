import type { ComponentProps } from 'react';
import { Pause, Play } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
 * A AURA — fumaça subindo, não sombra.
 *
 * Embaixo, dois véus da cor de destaque giram em sentidos opostos e respiram
 * (13s e 9s): a névoa que envolve o botão. Por cima, três FIOS DE FUMAÇA nascem
 * colados ao círculo e sobem mais de um diâmetro, balançando para os lados e se
 * abrindo até sumir. Os tempos não fecham entre si e os atrasos são negativos
 * (os fios já estão no meio do caminho no primeiro quadro), então o que se vê
 * é uma coluna contínua, não sopros marcados. Fica atrás do círculo opaco do
 * botão — só aparece o que extravasa.
 *
 * O PORQUÊ DE ELA NUNCA TER SE MEXIDO: os @keyframes moravam dentro do
 * `@theme` do Tailwind v4, que descarta no build todo keyframe não usado por
 * uma variável `--animate-*`. Como estes são chamados por estilo inline, o
 * Tailwind não os via e o CSS final saía sem nenhum. Agora vivem no nível de
 * cima de `globals.css`.
 *
 * Com a música pausada fica só a névoa, parada e mais fraca — um botão que
 * fumega sem som saindo promete o que não está acontecendo. Sob
 * `prefers-reduced-motion` a névoa continua lá, só sem movimento: sumir com ela
 * inteira deixava o botão "sem aura nenhuma" para quem desligou as animações
 * do Windows, e movimento não é a única coisa que ela entrega.
 */
const FIOS = [
  { id: 'a', animacao: 'fumaca-a', duracao: '3.6s', atraso: '-0.4s', blur: 'blur-md', x: '46%' },
  { id: 'b', animacao: 'fumaca-b', duracao: '4.4s', atraso: '-2.1s', blur: 'blur-lg', x: '56%' },
  { id: 'c', animacao: 'fumaca-c', duracao: '4s', atraso: '-3.2s', blur: 'blur-md', x: '40%' },
] as const;

/**
 * NO CELULAR A FUMAÇA É MAIS VIVA. "Tá muito parado" — e tinha razão: o botão
 * é menor, a tela está na mão, e fios lentos de 4s num círculo de 40px quase
 * não se mexem aos olhos. Em tela de toque são cinco fios, mais rápidos (2,2 a
 * 3,2s, também fora de fase), mais fortes e subindo mais; a névoa de baixo gira
 * no dobro da velocidade. Só `transform` e `opacity`, como os outros: o custo é
 * de composição, não de pintura.
 */
const FIOS_TOQUE = [
  { id: 'a', animacao: 'fumaca-a', duracao: '2.4s', atraso: '-0.3s', blur: 'blur-sm', x: '46%' },
  { id: 'b', animacao: 'fumaca-b', duracao: '3.2s', atraso: '-1.5s', blur: 'blur-md', x: '58%' },
  { id: 'c', animacao: 'fumaca-c', duracao: '2.8s', atraso: '-2.2s', blur: 'blur-sm', x: '38%' },
  { id: 'd', animacao: 'fumaca-b', duracao: '2.2s', atraso: '-0.9s', blur: 'blur-md', x: '50%' },
  { id: 'e', animacao: 'fumaca-a', duracao: '3s', atraso: '-2.7s', blur: 'blur-sm', x: '62%' },
] as const;

function Aura({ playing }: { playing: boolean }) {
  const toque = useMediaQuery('(pointer: coarse)');
  const fios = toque ? FIOS_TOQUE : FIOS;
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute',
        toque ? 'inset-[-65%]' : 'inset-[-55%]',
        !playing && 'opacity-45',
      )}
    >
      <span
        className="absolute inset-0 rounded-full blur-xl motion-reduce:!animate-none"
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.8) 0%, hsl(var(--accent) / 0.22) 55%, transparent 78%)',
          animation: playing
            ? `aura-drift-a ${toque ? '6s' : '13s'} ease-in-out infinite`
            : undefined,
        }}
      />
      <span
        className="absolute inset-[12%] rounded-full blur-lg motion-reduce:!animate-none"
        style={{
          background:
            'radial-gradient(closest-side at 62% 38%, hsl(var(--accent) / 0.6) 0%, transparent 70%)',
          animation: playing
            ? `aura-drift-b ${toque ? '4.5s' : '9s'} ease-in-out infinite`
            : undefined,
        }}
      />
      {/* OS FIOS DE FUMAÇA — só com a música tocando e só com movimento
          permitido: fumaça parada no ar não é fumaça, é mancha. */}
      {playing &&
        fios.map((fio) => (
          <span
            key={fio.id}
            className={cn(
              'absolute hidden rounded-full motion-safe:block',
              // No toque os fios são mais grossos: no escuro, fio fino e
              // borrado num botão de 40px quase não se enxerga.
              toque ? 'inset-[14%]' : 'inset-[22%]',
              fio.blur,
            )}
            style={{
              background: `radial-gradient(closest-side at ${fio.x} 55%, hsl(var(--accent) / ${toque ? 0.9 : 0.75}) 0%, hsl(var(--accent) / 0.28) 45%, transparent 72%)`,
              animation: `${fio.animacao} ${fio.duracao} ease-out infinite`,
              animationDelay: fio.atraso,
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
