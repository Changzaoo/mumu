/**
 * O indicador do "puxar para recarregar" e os ouvintes do gesto.
 *
 * As REGRAS moram em lib/gestos/puxada.ts (testadas sem DOM); aqui só se liga
 * o dedo a elas. Três decisões que importam:
 *
 *  - SÓ NO TOQUE (`pointer: coarse`). No desktop o componente não escuta nada.
 *  - TUDO PASSIVO. Nenhum `preventDefault`: o gesto só OBSERVA o dedo. No
 *    Android o <main> já não rola além do topo (`overscroll-y-none`) e no iOS a
 *    guarda do AppShell já cancela o quique — então não há rolagem nativa para
 *    disputar, e a rolagem comum e os carrosséis seguem com o caminho rápido
 *    do navegador (ouvinte passivo nunca atrasa o scroll).
 *  - SEM RENDER POR QUADRO. O indicador anda por `style` direto, no máximo um
 *    `requestAnimationFrame` por movimento de dedo, e nada roda com o dedo
 *    parado. O React só re-renderiza para o estado "recarregando".
 *
 * Com "menos movimento", o indicador aparece e some sem deslizar e não gira.
 */
import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import {
  LIMIAR_PX,
  decidirEixo,
  disparou,
  distanciaDaPuxada,
  podeComecar,
  progresso,
  type DecisaoDeEixo,
} from '@/lib/gestos/puxada';
import { recarregarPreservandoMusica } from '@/lib/recarregar';
import { cn } from '@/lib/utils';

/** Tamanho do círculo (px) — e quanto ele fica escondido acima da borda. */
const TAMANHO = 40;
const RAIO = 15;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

/** Quem está sob o dedo tem rolagem própria fora do topo, ou pede silêncio? */
function alvoRecusa(alvo: EventTarget | null, raiz: HTMLElement): boolean {
  let el = alvo instanceof Element ? alvo : null;
  while (el && el !== raiz) {
    if (el.closest('input, textarea, select, [contenteditable="true"], [data-sem-puxar]')) {
      return true;
    }
    // Lista rolável dentro da página, já rolada: puxar é voltar nela.
    if (el instanceof HTMLElement && el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

export function PuxarParaRecarregar({ scrollEl }: { scrollEl: HTMLElement | null }) {
  const toque = useMediaQuery('(pointer: coarse)');
  const semMovimento = useSemMovimento();
  const [recarregando, setRecarregando] = useState(false);
  const indicadorRef = useRef<HTMLDivElement>(null);
  const arcoRef = useRef<SVGCircleElement>(null);
  const iconeRef = useRef<SVGSVGElement>(null);
  // O ouvinte é ligado uma vez por contêiner; o ajuste de movimento pode mudar
  // no meio — lido por referência para não religar tudo.
  const semMovimentoRef = useRef(semMovimento);
  useEffect(() => {
    semMovimentoRef.current = semMovimento;
  }, [semMovimento]);

  useEffect(() => {
    const raiz = scrollEl;
    if (!raiz || !toque || recarregando) return;

    let ativo = false;
    let eixo: DecisaoDeEixo = 'espera';
    let x0 = 0;
    let y0 = 0;
    let distancia = 0;
    let passouDoLimiar = false;
    let quadro = 0;

    const desenhar = (animar: boolean): void => {
      quadro = 0;
      const el = indicadorRef.current;
      if (!el) return;
      const calmo = semMovimentoRef.current;
      const p = progresso(distancia);
      el.style.transition =
        animar && !calmo ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none';
      // Com menos movimento o círculo não desliza: fica parado no ponto de
      // disparo e só o arco enche.
      const y = calmo ? (distancia > 0 ? LIMIAR_PX : 0) : distancia;
      el.style.transform = `translate3d(-50%, ${y - TAMANHO}px, 0)`;
      el.style.opacity = distancia > 0 ? String(Math.min(1, 0.35 + p)) : '0';
      if (arcoRef.current) {
        arcoRef.current.style.strokeDashoffset = String(CIRCUNFERENCIA * (1 - p));
      }
      if (iconeRef.current) {
        iconeRef.current.style.transform = calmo ? '' : `rotate(${p * 270}deg)`;
      }
      el.dataset.pronto = disparou(distancia) ? 'sim' : 'nao';
    };

    const agendar = (): void => {
      if (quadro) return;
      quadro = requestAnimationFrame(() => desenhar(false));
    };

    const recolher = (): void => {
      if (quadro) cancelAnimationFrame(quadro);
      distancia = 0;
      desenhar(true);
    };

    const onStart = (event: TouchEvent): void => {
      ativo = false;
      const dedo = event.touches[0];
      if (!dedo) return;
      if (
        !podeComecar({
          y: dedo.clientY,
          alturaDaTela: window.innerHeight,
          scrollTop: raiz.scrollTop,
          toques: event.touches.length,
        })
      ) {
        return;
      }
      if (alvoRecusa(event.target, raiz)) return;
      ativo = true;
      eixo = 'espera';
      x0 = dedo.clientX;
      y0 = dedo.clientY;
      distancia = 0;
      passouDoLimiar = false;
    };

    const onMove = (event: TouchEvent): void => {
      if (!ativo) return;
      const dedo = event.touches[0];
      // Segundo dedo ou a página rolou por baixo: não é mais uma puxada.
      if (!dedo || event.touches.length !== 1 || raiz.scrollTop > 0.5) {
        ativo = false;
        recolher();
        return;
      }
      const dx = dedo.clientX - x0;
      const dy = dedo.clientY - y0;
      if (eixo === 'espera') {
        eixo = decidirEixo(dx, dy);
        if (eixo === 'desistir') {
          ativo = false;
          return;
        }
        if (eixo === 'espera') return;
      }
      distancia = distanciaDaPuxada(dy);
      const pronto = disparou(distancia);
      if (pronto && !passouDoLimiar && 'vibrate' in navigator) {
        // Um toque curtinho no Android marca o ponto sem volta (iOS ignora).
        try {
          navigator.vibrate(8);
        } catch {
          /* sem vibração: o arco cheio já avisa */
        }
      }
      passouDoLimiar = pronto;
      agendar();
    };

    const onEnd = (): void => {
      if (!ativo) return;
      ativo = false;
      if (disparou(distancia)) {
        if (quadro) cancelAnimationFrame(quadro);
        distancia = LIMIAR_PX;
        desenhar(true);
        setRecarregando(true);
        return;
      }
      recolher();
    };

    const onCancel = (): void => {
      if (!ativo) return;
      ativo = false;
      recolher();
    };

    raiz.addEventListener('touchstart', onStart, { passive: true });
    raiz.addEventListener('touchmove', onMove, { passive: true });
    raiz.addEventListener('touchend', onEnd, { passive: true });
    raiz.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      if (quadro) cancelAnimationFrame(quadro);
      raiz.removeEventListener('touchstart', onStart);
      raiz.removeEventListener('touchmove', onMove);
      raiz.removeEventListener('touchend', onEnd);
      raiz.removeEventListener('touchcancel', onCancel);
    };
  }, [scrollEl, toque, recarregando]);

  // Deixa o círculo girando aparecer (dois quadros) antes de a página sumir.
  useEffect(() => {
    if (!recarregando) return;
    let segundo = 0;
    const primeiro = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => recarregarPreservandoMusica());
    });
    return () => {
      cancelAnimationFrame(primeiro);
      cancelAnimationFrame(segundo);
    };
  }, [recarregando]);

  if (!toque) return null;

  return (
    <div
      ref={indicadorRef}
      role={recarregando ? 'status' : undefined}
      aria-live={recarregando ? 'polite' : undefined}
      aria-hidden={recarregando ? undefined : true}
      // Nasce escondido acima da borda; quem o move é o gesto (style direto).
      style={{ transform: `translate3d(-50%, ${-TAMANHO}px, 0)`, opacity: 0 }}
      className={cn(
        'pointer-events-none fixed left-1/2 top-[env(safe-area-inset-top)] z-50 grid size-10 place-items-center rounded-full border border-border bg-bg-elevated text-fg-muted shadow-lg will-change-transform',
        'data-[pronto=sim]:text-accent',
      )}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle
          ref={arcoRef}
          cx="20"
          cy="20"
          r={RAIO}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUNFERENCIA}
          strokeDashoffset={CIRCUNFERENCIA}
          className="stroke-accent"
        />
      </svg>
      <RotateCw
        ref={iconeRef}
        aria-hidden="true"
        className={cn('size-4', recarregando && !semMovimento && 'animate-spin')}
      />
      {recarregando && <span className="sr-only">Recarregando</span>}
    </div>
  );
}
