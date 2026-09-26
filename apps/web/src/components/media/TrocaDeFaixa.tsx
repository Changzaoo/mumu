import type { ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import type { DirecaoDaTroca } from '@/stores/uiStore';

/**
 * A FAIXA NOVA ENTRA PELO LADO DE ONDE A PESSOA APERTOU.
 *
 * "Próxima" empurra a antiga para a esquerda e a nova chega pela direita;
 * "anterior", o contrário — como virar a página de um álbum de fotos. Sem lado
 * claro (clique numa lista), só funde uma na outra.
 *
 * Dois jeitos de trocar:
 *  - `sobreposto` (capas): as duas imagens coexistem por um instante, uma
 *    saindo e outra entrando dentro da mesma moldura — que corta o excesso
 *    (`overflow-hidden` no pai). Os filhos são `absolute inset-0`.
 *  - texto: a antiga sai do fluxo na hora (`popLayout` — o pai precisa ser
 *    `relative`) e some rápido, em 120ms, enquanto a nova entra no lugar dela.
 *    Esperar a antiga sair antes de pôr a nova (`wait`) deixava o bloco do
 *    título com altura zero por um instante e os controles da tela cheia
 *    davam um pulo; texto sobreposto a texto por mais que isso vira borrão.
 *
 * Só `transform` e `opacity`, que o compositor anima sem a thread principal —
 * em celular fraco a troca não custa pintura. Com menos movimento pedido, não
 * há animação nenhuma: a faixa simplesmente troca.
 */
export interface TrocaDeFaixaProps {
  /** Identidade da faixa: mudou a chave, anima. */
  chave: string;
  direcao: DirecaoDaTroca;
  sobreposto?: boolean;
  className?: string;
  /** `span` dentro de botão (onde `div` não é conteúdo válido). */
  como?: 'div' | 'span';
  children: ReactNode;
}

const DESLIZE_CAPA = '100%';
/** Texto não precisa atravessar a tela: um empurrão curto já diz o lado. */
const DESLIZE_TEXTO = 48;

function variantes(sobreposto: boolean): Variants {
  const distancia = sobreposto ? DESLIZE_CAPA : DESLIZE_TEXTO;
  const lado = (d: DirecaoDaTroca) =>
    typeof distancia === 'number' ? d * distancia : `${d * 100}%`;
  return {
    entra: (d: DirecaoDaTroca) => ({ x: lado(d), opacity: d === 0 || !sobreposto ? 0 : 1 }),
    centro: {
      x: 0,
      opacity: 1,
      transition: sobreposto
        ? { x: { type: 'spring', stiffness: 320, damping: 34 }, opacity: { duration: 0.25 } }
        : { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
    },
    // Quem sai vai para o lado OPOSTO ao que a nova entra.
    sai: (d: DirecaoDaTroca) => ({
      x: sobreposto ? lado(-d as DirecaoDaTroca) : -d * (DESLIZE_TEXTO / 2),
      opacity: d === 0 || !sobreposto ? 0 : 1,
      transition: sobreposto
        ? { x: { type: 'spring', stiffness: 320, damping: 34 }, opacity: { duration: 0.25 } }
        : { duration: 0.12, ease: 'easeIn' },
    }),
  };
}

const VARIANTES_CAPA = variantes(true);
const VARIANTES_TEXTO = variantes(false);

export function TrocaDeFaixa({
  chave,
  direcao,
  sobreposto = false,
  className,
  como = 'div',
  children,
}: TrocaDeFaixaProps) {
  const semMovimento = useSemMovimento();

  if (semMovimento) {
    const Caixa = como;
    return (
      <Caixa key={chave} className={className}>
        {children}
      </Caixa>
    );
  }

  const Movel = como === 'span' ? motion.span : motion.div;

  return (
    // `initial={false}`: abrir a tela cheia (ou a barra surgindo) não é troca
    // de faixa — a capa de agora já está no lugar.
    <AnimatePresence initial={false} custom={direcao} mode={sobreposto ? 'sync' : 'popLayout'}>
      <Movel
        key={chave}
        custom={direcao}
        variants={sobreposto ? VARIANTES_CAPA : VARIANTES_TEXTO}
        initial="entra"
        animate="centro"
        exit="sai"
        className={className}
      >
        {children}
      </Movel>
    </AnimatePresence>
  );
}
