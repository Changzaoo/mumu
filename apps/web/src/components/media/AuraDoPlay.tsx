import { useEffect, useRef } from 'react';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { modoLeve } from '@/lib/perf/dispositivo';
import { cn } from '@/lib/utils';

/**
 * A AURA DO PLAY — uma NEBLINA em volta do botão, que nunca passa duas vezes
 * pelo mesmo desenho.
 *
 * Histórico: fumaça subindo (chamava atenção demais), depois três manchas
 * redondas da cor de destaque passeando em volta — que liam como "halo", não
 * como névoa: borda redonda, sempre a mesma forma. A pessoa pediu neblina se
 * movendo de formas inéditas.
 *
 * Agora é névoa de verdade: um campo de densidade calculado por RUÍDO 3D
 * (x, y e tempo) com o domínio distorcido por outro ruído — é isso que faz as
 * volutas se enrolarem, rasgarem e se juntarem, em vez de manchas que só
 * andam. O campo é recortado num anel em volta do botão (denso colado à
 * borda, esgarçando para fora) e gira devagar em volta dele enquanto muda de
 * forma. A semente é sorteada a cada montagem e o tempo só anda para a
 * frente, sem período: nenhum quadro se repete.
 *
 * PAUSAR NÃO CORTA. A "vivacidade" desce devagar até zero: o relógio da névoa
 * anda cada vez mais devagar e ela esmaece junto, até assentar parada onde
 * estava. Só então o laço de quadros para. Voltar a tocar retoma do mesmo
 * ponto, sem salto.
 *
 * Custo: o campo é pequeno (56×56; 36×36 em aparelho fraco, a 30 quadros/s)
 * e o navegador o amplia com suavização — neblina não tem detalhe fino, e o
 * desfoque do CSS esconde os pixels. O laço só roda com a aura visível, a aba
 * à vista e algo se mexendo. Sem movimento pedido, a névoa fica parada — ela
 * também é contorno, não só animação.
 */

const sorteio = (min: number, max: number) => min + Math.random() * (max - min);

/** Ruído de valor 3D, suave (fade quíntico), com tabela embaralhada por montagem. */
function criarRuido(): (x: number, y: number, z: number) => number {
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
  const valor = new Float32Array(256);
  for (let i = 0; i < 256; i++) valor[i] = Math.random();
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const h = (x: number, y: number, z: number) => valor[p[p[p[x]! + y]! + z]!]!;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(X, Y, Z), h(X + 1, Y, Z), u), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u), v),
      l(
        l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u),
        l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u),
        v,
      ),
      w,
    );
  };
}

/** Três oitavas: grande forma + fiapos. 0..1. */
function fbm(ruido: (x: number, y: number, z: number) => number, x: number, y: number, z: number) {
  return (
    ruido(x, y, z) * 0.57 +
    ruido(x * 2.03 + 17.1, y * 2.03 - 9.3, z * 1.7) * 0.29 +
    ruido(x * 4.11 - 31.7, y * 4.11 + 5.2, z * 2.9) * 0.14
  );
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Quanto tempo (s) a vivacidade leva para andar ~63% do caminho. */
const INERCIA_PAUSA = 0.9;
const INERCIA_PLAY = 0.45;

export function AuraDoPlay({ playing, toque }: { playing: boolean; toque: boolean }) {
  const semMovimento = useSemMovimento();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tocandoRef = useRef(playing);
  const acordarRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    tocandoRef.current = playing;
    acordarRef.current();
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const leve = modoLeve();
    const N = leve ? 36 : 56;
    canvas.width = N;
    canvas.height = N;
    const imagem = ctx.createImageData(N, N);
    const px = imagem.data;
    const ruido = criarRuido();

    // Onde cada pixel está: raio e ângulo, calculados uma vez.
    const raioDe = new Float32Array(N * N);
    const xs = new Float32Array(N * N);
    const ys = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N) * 2 - 1;
        const y = ((j + 0.5) / N) * 2 - 1;
        const k = j * N + i;
        xs[k] = x;
        ys[k] = y;
        raioDe[k] = Math.hypot(x, y);
      }
    }
    // O botão ocupa ~54% do raio da caixa (inset -42%/-48%).
    const borda = toque ? 0.51 : 0.54;

    // A COR: a de destaque do tema, relida de tempos em tempos (a cor da capa
    // muda o destaque a cada faixa).
    let cor: [number, number, number] = [255, 255, 255];
    let corLidaEm = -Infinity;
    const lerCor = (agora: number) => {
      if (agora - corLidaEm < 1000) return;
      corLidaEm = agora;
      const hsl = getComputedStyle(canvas).getPropertyValue('--accent').trim();
      if (!hsl) return;
      ctx.fillStyle = '#000';
      ctx.fillStyle = `hsl(${hsl})`;
      const hex = String(ctx.fillStyle);
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (m) cor = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
    };

    // Deslocamentos sorteados: duas montagens nunca começam no mesmo desenho.
    const ox = sorteio(0, 200);
    const oy = sorteio(0, 200);
    let t = sorteio(0, 100);
    const giro = (Math.random() < 0.5 ? -1 : 1) * sorteio(0.25, 0.5);
    let viva = tocandoRef.current && !semMovimento ? 1 : 0;
    let raf = 0;
    let ultimo = 0;
    let visivel = true;

    const pintar = (dt: number, agora: number) => {
      lerCor(agora);
      // O relógio da névoa anda na velocidade da vivacidade: pausando, ela
      // desacelera até parar em vez de congelar num quadro.
      t += dt * viva * 0.22;
      // Esmaece junto, mas não some: a névoa pausada ainda contorna o botão.
      const presenca = 0.5 + 0.5 * viva;
      const [r, g, b] = cor;
      for (let k = 0; k < N * N; k++) {
        const raio = raioDe[k]!;
        // Anel: nasce na borda do botão, esgarça até a beira da caixa.
        const janela =
          smooth(borda - 0.08, borda + 0.04, raio) * (1 - smooth(borda + 0.05, 0.98, raio));
        const o = k * 4;
        if (janela <= 0.001) {
          px[o + 3] = 0;
          continue;
        }
        const x = xs[k]!;
        const y = ys[k]!;
        // Deriva: a névoa gira devagar em volta do botão (o sentido e a
        // velocidade vêm do sorteio) enquanto o tempo muda a forma — girar
        // sozinho teria ciclo; junto com a forma que muda, não tem.
        const cosA = Math.cos(t * giro);
        const senA = Math.sin(t * giro);
        const sx = (x * cosA - y * senA) * 2.9 + ox;
        const sy = (x * senA + y * cosA) * 2.9 + oy;
        // Distorção de domínio: é o que enrola a névoa em volutas.
        const wx = fbm(ruido, sx * 0.9, sy * 0.9, t * 0.6);
        const wy = fbm(ruido, sx * 0.9 + 5.2, sy * 0.9 + 1.3, t * 0.6 + 3.1);
        const d = fbm(ruido, sx + 2.6 * wx, sy + 2.6 * wy, t);
        // Contraste: vazios de verdade entre os fiapos.
        const densidade = Math.max(0, Math.min(1, (d - 0.4) * 3)) * janela;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = Math.round(densidade * presenca * 230);
      }
      ctx.putImageData(imagem, 0, 0);
    };

    const quadro = (agora: number) => {
      raf = 0;
      if (!visivel || document.hidden) return;
      if (leve && agora - ultimo < 32) {
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
      pintar(dt, agora);
      // Assentou (pausada e parada): o laço dorme até o próximo play.
      if (viva > 0 || alvo > 0) raf = requestAnimationFrame(quadro);
    };

    const acordar = () => {
      if (semMovimento) {
        viva = 0;
        pintar(0, performance.now());
        return;
      }
      if (raf || !visivel || document.hidden) return;
      if (!tocandoRef.current && viva === 0) return;
      ultimo = performance.now();
      raf = requestAnimationFrame(quadro);
    };
    acordarRef.current = acordar;

    // Primeiro quadro na hora: a névoa aparece já no lugar.
    pintar(0, performance.now());

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
    observador?.observe(canvas);
    const aba = () => acordar();
    document.addEventListener('visibilitychange', aba);
    acordar();

    return () => {
      observador?.disconnect();
      document.removeEventListener('visibilitychange', aba);
      if (raf) cancelAnimationFrame(raf);
      acordarRef.current = () => undefined;
    };
  }, [semMovimento, toque]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        'aura-play-nevoa pointer-events-none absolute',
        toque ? 'inset-[-48%] size-[196%]' : 'inset-[-42%] size-[184%]',
      )}
    />
  );
}
