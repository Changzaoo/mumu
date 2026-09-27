import { useEffect, useRef } from 'react';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { modoLeve } from '@/lib/perf/dispositivo';
import { cn } from '@/lib/utils';

/**
 * A AURA DO PLAY — um halo EM VOLTA do botão, vivo e sem ciclo.
 *
 * Antes era névoa girando por keyframe e, por cima, fumaça subindo num canvas.
 * A fumaça chamava atenção demais (a pessoa pediu "algo como aura em volta"),
 * e o keyframe, por mais que os tempos não fechassem, tem ciclo: o olho acha
 * em meio minuto o mesmo véu passando pelo mesmo lugar.
 *
 * Agora são três camadas da cor de destaque atrás do círculo — um anel que
 * abraça a borda e dois lóbulos que passeiam em volta dela. Cada grandeza de
 * cada camada (ângulo, distância, escala, achatamento, brilho) segue uma
 * `Deriva`: uma curva suave que passa por pontos SORTEADOS, um depois do outro,
 * com trechos de duração também sorteada. Não existe período — o próximo ponto
 * só é tirado quando o anterior é alcançado —, então o conjunto nunca volta ao
 * mesmo quadro. O ângulo dos lóbulos nem é sorteado direto: o que se sorteia é
 * a VELOCIDADE, que ora gira para um lado, ora para o outro, ora quase para.
 *
 * PAUSAR NÃO CORTA. A "vivacidade" desce devagar até zero: o relógio da aura
 * anda cada vez mais devagar e o brilho baixa junto, até ela assentar parada,
 * esmaecida, exatamente onde estava. Só então o laço de quadros para. Voltar a
 * tocar sobe a vivacidade de novo e ela retoma do mesmo ponto, sem salto.
 *
 * Custo: por quadro, só `transform` e `opacity` em três elementos já compostos
 * (o desfoque é fixo, rasterizado uma vez). O laço só roda com a aura visível
 * (a barra do outro tamanho de tela vive montada e escondida), a aba à vista e
 * algo se mexendo. Em aparelho fraco (`data-perf='baixo'`): um lóbulo só, sem
 * desfoque (o CSS cuida) e 30 quadros por segundo. Sem movimento pedido, a
 * aura fica lá, parada — ela também é contorno, não só animação.
 */

const sorteio = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Um valor em -1..1 que vagueia sem se repetir: Catmull-Rom sobre pontos
 * sorteados, um trecho de duração sorteada entre cada par. Velocidade contínua
 * nas emendas — nada de "tranco" quando um ponto novo entra.
 */
class Deriva {
  private p: [number, number, number, number];
  private t = Math.random();
  private dur: number;

  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {
    this.p = [this.ponto(), this.ponto(), this.ponto(), this.ponto()];
    this.dur = sorteio(min, max);
  }

  private ponto() {
    return sorteio(-1, 1);
  }

  avancar(dt: number): number {
    this.t += dt / this.dur;
    while (this.t >= 1) {
      this.t -= 1;
      this.p = [this.p[1], this.p[2], this.p[3], this.ponto()];
      this.dur = sorteio(this.min, this.max);
    }
    const [a, b, c, d] = this.p;
    const t = this.t;
    const t2 = t * t;
    const v =
      0.5 *
      (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t2 * t);
    return Math.max(-1, Math.min(1, v));
  }
}

interface Camada {
  el: HTMLSpanElement | null;
  /** Ângulo acumulado (graus) — integrado a partir de `giro`. */
  angulo: number;
  giro: Deriva;
  /** Graus por segundo no pico da deriva de giro. */
  giroMax: number;
  raio: Deriva;
  /** Afastamento do centro, em % da camada. 0 = presa ao centro (o anel). */
  raioBase: number;
  raioAmp: number;
  escala: Deriva;
  achatar: Deriva;
  brilho: Deriva;
  alfaBase: number;
}

function novaCamada(giroMax: number, raioBase: number, raioAmp: number, alfaBase: number): Camada {
  return {
    el: null,
    angulo: sorteio(0, 360),
    giro: new Deriva(2.5, 6.5),
    giroMax,
    raio: new Deriva(2, 5),
    raioBase,
    raioAmp,
    escala: new Deriva(2.2, 5.5),
    achatar: new Deriva(3, 7),
    brilho: new Deriva(1.8, 4.5),
    alfaBase,
  };
}

/** Quanto tempo (s) a vivacidade leva para andar ~63% do caminho. */
const INERCIA_PAUSA = 0.9;
const INERCIA_PLAY = 0.45;

export function AuraDoPlay({ playing, toque }: { playing: boolean; toque: boolean }) {
  const semMovimento = useSemMovimento();
  const caixaRef = useRef<HTMLSpanElement>(null);
  const camadasRef = useRef<Camada[] | null>(null);
  if (!camadasRef.current) {
    camadasRef.current = [
      // O anel: não passeia, só respira e se deforma um pouco.
      novaCamada(14, 0, 0, 0.75),
      // Os lóbulos: vagueiam em volta, cada um no seu rumo.
      novaCamada(38, 14, 6, 0.7),
      novaCamada(30, 16, 7, 0.55),
    ];
  }
  const tocandoRef = useRef(playing);
  const acordarRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    tocandoRef.current = playing;
    acordarRef.current();
  }, [playing]);

  useEffect(() => {
    const caixa = caixaRef.current;
    const camadas = camadasRef.current!;
    if (!caixa) return;

    // Quem nasce tocando já nasce viva; quem nasce pausado, assentada.
    let viva = tocandoRef.current && !semMovimento ? 1 : 0;
    let raf = 0;
    let ultimo = 0;
    let visivel = true;

    const pintar = (dt: number) => {
      // O relógio da aura anda na velocidade da vivacidade: pausando, ela
      // desacelera até parar em vez de congelar num quadro.
      const passo = dt * viva;
      // Esmaece junto, mas não some: a aura pausada ainda contorna o botão.
      const presenca = 0.45 + 0.55 * viva;
      for (const c of camadas) {
        const giro = c.giro.avancar(passo);
        c.angulo = (c.angulo + giro * c.giroMax * passo) % 360;
        const raio = c.raioBase + c.raio.avancar(passo) * c.raioAmp;
        const escala = 1 + c.escala.avancar(passo) * 0.07;
        const achatar = 1 + c.achatar.avancar(passo) * 0.06;
        const brilho = c.alfaBase * (0.8 + 0.2 * c.brilho.avancar(passo));
        if (!c.el) continue;
        // Gira, afasta do centro, desfaz a rotação do eixo — o lóbulo passeia
        // em volta sem rodar a própria forma — e achata de leve: um halo que
        // estica para um lado e volta, nunca um círculo perfeito girando.
        c.el.style.transform =
          `rotate(${c.angulo.toFixed(2)}deg) translateY(${(-raio).toFixed(2)}%) ` +
          `scale(${(escala * achatar).toFixed(4)}, ${(escala / achatar).toFixed(4)})`;
        c.el.style.opacity = (brilho * presenca).toFixed(3);
      }
    };

    const quadro = (agora: number) => {
      raf = 0;
      if (!visivel || document.hidden) return;
      if (modoLeve() && agora - ultimo < 32) {
        raf = requestAnimationFrame(quadro);
        return;
      }
      // Passo limitado: voltando de uma aba escondida, nada de salto.
      const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000));
      ultimo = agora;
      const alvo = tocandoRef.current ? 1 : 0;
      const inercia = alvo > viva ? INERCIA_PLAY : INERCIA_PAUSA;
      viva += (alvo - viva) * (1 - Math.exp(-dt / inercia));
      if (alvo === 0 && viva < 0.004) viva = 0;
      if (alvo === 1 && viva > 0.996) viva = 1;
      pintar(dt);
      // Assentou (pausada e parada): o laço dorme até o próximo play.
      if (viva > 0 || alvo > 0) raf = requestAnimationFrame(quadro);
    };

    const acordar = () => {
      if (semMovimento) {
        viva = 0;
        pintar(0);
        return;
      }
      if (raf || !visivel || document.hidden) return;
      if (!tocandoRef.current && viva === 0) return;
      ultimo = performance.now();
      raf = requestAnimationFrame(quadro);
    };
    acordarRef.current = acordar;

    // Primeiro quadro na hora: a aura aparece já no lugar, não num canto.
    pintar(0);

    // Sem IntersectionObserver (jsdom dos testes), vale como visível.
    const observador =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entradas) => {
            visivel = entradas.some((e) => e.isIntersecting);
            if (!visivel && raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
            acordar();
          });
    observador?.observe(caixa);
    const aba = () => acordar();
    document.addEventListener('visibilitychange', aba);
    acordar();

    return () => {
      observador?.disconnect();
      document.removeEventListener('visibilitychange', aba);
      if (raf) cancelAnimationFrame(raf);
      acordarRef.current = () => undefined;
    };
  }, [semMovimento]);

  const camadas = camadasRef.current;
  const pegar = (i: number) => (el: HTMLSpanElement | null) => {
    camadas[i]!.el = el;
  };

  return (
    <span
      ref={caixaRef}
      aria-hidden
      className={cn('pointer-events-none absolute', toque ? 'inset-[-48%]' : 'inset-[-42%]')}
    >
      {/* O anel: forte colado à borda do botão, some para fora. O miolo fica
          por baixo do círculo opaco e não aparece. */}
      <span
        ref={pegar(0)}
        className="aura-play-camada"
        style={{
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.5) 52%, hsl(var(--accent) / 0.2) 72%, transparent 100%)',
        }}
      />
      <span
        ref={pegar(1)}
        className="aura-play-camada"
        style={{
          inset: '14%',
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.45) 30%, hsl(var(--accent) / 0.12) 70%, transparent 100%)',
        }}
      />
      <span
        ref={pegar(2)}
        className="aura-play-camada aura-play-lobulo-extra"
        style={{
          inset: '20%',
          background:
            'radial-gradient(closest-side, hsl(var(--accent) / 0.4) 25%, hsl(var(--accent) / 0.1) 70%, transparent 100%)',
        }}
      />
    </span>
  );
}
