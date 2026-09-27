import { useEffect, useRef } from 'react';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { modoLeve } from '@/lib/perf/dispositivo';
import { cn } from '@/lib/utils';

/**
 * A AURA DO PLAY — neblina em volta do botão, que nunca passa duas vezes pelo
 * mesmo desenho.
 *
 * O campo de densidade é RUÍDO 3D (x, y e tempo) com o domínio distorcido por
 * outro ruído — é isso que enrola a névoa em volutas que rasgam e se juntam —,
 * recortado num anel em volta do botão (denso na borda, esgarçando para fora).
 * Semente sorteada a cada montagem; os relógios só andam para a frente: nenhum
 * quadro se repete.
 *
 * DOIS ESTADOS, UMA ANIMAÇÃO SÓ:
 *  • TOCANDO — a névoa GIRA em volta do botão (uma volta a cada ~9 s) enquanto
 *    muda de forma.
 *  • PARADA — o giro freia até parar e fica o VENTO: a névoa quase parada,
 *    levada devagar numa direção que muda aos poucos, com rajadas que a
 *    remexem e a inclinam para um lado — como neblina de verdade numa brisa.
 * A passagem de um para o outro é pela "vivacidade", que sobe e desce com
 * inércia: velocidade do giro, ritmo da forma e peso do vento são todos
 * contínuos nela, e ângulo, forma e deriva do vento são ACUMULADOS — nada
 * recomeça, nada salta, nunca quebra.
 *
 * Custo: campo pequeno (56×56; 36×36 em aparelho fraco) ampliado com
 * suavização — névoa não tem detalhe fino, e o desfoque do CSS esconde os
 * pixels. Parada (e em aparelho fraco) roda a 30 quadros/s. O laço só roda com
 * a aura visível e a aba à vista. Sem movimento pedido, fica um quadro parado.
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
/** O CD pega o giro em ~0,35 s; a névoa, puxada, em ~1,4 s. */
const INERCIA_CD = 0.35;
const INERCIA_NEVOA = 1.4;
/** Uma volta do CD a cada 1,8 s (33⅓ rpm, a do disco); a névoa, ~7 s. */
const VEL_CD = (Math.PI * 2) / 1.8;
const VEL_NEVOA = 0.9;
/** Atraso da névoa de fora em relação à de dentro, com o giro no máximo. */
const ARRASTO = 2.4;

export function AuraDoPlay({ playing, toque }: { playing: boolean; toque: boolean }) {
  const semMovimento = useSemMovimento();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cdRef = useRef<HTMLSpanElement>(null);
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
    const cosDe = new Float32Array(N * N);
    const senDe = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N) * 2 - 1;
        const y = ((j + 0.5) / N) * 2 - 1;
        const k = j * N + i;
        xs[k] = x;
        ys[k] = y;
        raioDe[k] = Math.hypot(x, y);
        const raio = raioDe[k]! || 1e-3;
        // Direção de cada pixel a partir do centro: a névoa é amostrada num
        // CÍRCULO do espaço do ruído (sem emenda em volta do botão).
        cosDe[k] = x / raio;
        senDe[k] = y / raio;
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
    /** Relógio da FORMA da névoa (só anda para a frente). */
    let t = sorteio(0, 100);
    /** Relógio do VENTO (tempo real; nunca desacelera). */
    let tv = sorteio(0, 100);
    /** Ângulo do giro (rad), acumulado — nunca volta a zero, nunca salta. */
    let angulo = sorteio(0, Math.PI * 2);
    // SENTIDO HORÁRIO, como o disco girando (na tela, com y para baixo, o
    // ângulo crescendo é o horário).
    const sentido = 1;
    // O CD E O PUXÃO. A borda do botão é um CD girando (uma volta a cada
    // 1,8 s, a do disco). Ele acelera depressa; a névoa acelera DEPOIS, puxada
    // por ele (inércia maior), e a parte colada ao botão gira mais que a de
    // fora — a espiral arrastada de algo sendo puxado pelo giro. Pausando, o
    // CD freia primeiro e a névoa ainda roda um pouco no embalo.
    let anguloCd = sorteio(0, Math.PI * 2);
    let velCd = tocandoRef.current && !semMovimento ? 1 : 0;
    let velNevoa = velCd;
    /** Relógio da CHAMA: quanto a névoa já escorreu para fora do botão. */
    let fluxo = sorteio(0, 50);
    /** Para onde o vento já levou a névoa (acumulado, vai e volta). */
    let ventoX = 0;
    let ventoY = 0;
    let viva = tocandoRef.current && !semMovimento ? 1 : 0;
    let raf = 0;
    let ultimo = 0;
    let visivel = true;

    const pintar = (dt: number, agora: number) => {
      lerCor(agora);
      const parada = 1 - viva;
      tv += dt;
      // O VENTO: direção e força variam devagar (ruído no tempo real), com
      // rajadas por cima — como névoa num dia de brisa. Pesa só na pausa;
      // tocando, quem manda é o giro.
      const dirVento = (ruido(tv * 0.07, 11.3, 2.7) - 0.5) * Math.PI * 2.4;
      const rajada = ruido(tv * 0.45, 4.1, 9.9);
      const forca = (0.35 + 0.65 * rajada * rajada) * parada;
      const vx = Math.cos(dirVento) * forca;
      const vy = Math.sin(dirVento) * forca;
      ventoX += vx * dt * 0.35;
      ventoY += vy * dt * 0.35;
      // O CD segue o play/pause com pouca inércia; a névoa segue o CD com
      // muita — é o atraso que faz parecer que ele a puxa.
      const alvoGiro = semMovimento ? 0 : tocandoRef.current ? 1 : 0;
      velCd += (alvoGiro - velCd) * (1 - Math.exp(-dt / INERCIA_CD));
      velNevoa += (velCd - velNevoa) * (1 - Math.exp(-dt / INERCIA_NEVOA));
      anguloCd += dt * sentido * velCd * VEL_CD;
      angulo += dt * sentido * velNevoa * VEL_NEVOA;
      const cd = cdRef.current;
      if (cd) cd.style.transform = `rotate(${anguloCd.toFixed(4)}rad)`;
      // Quanto a névoa de fora fica para trás da de dentro (rad por unidade
      // de distância à borda): só existe com o giro — parada, é névoa solta.
      const arrasto = velNevoa * ARRASTO;
      // A forma muda o tempo todo: depressa tocando, devagar parada — e a
      // rajada a remexe um pouco mais.
      t += dt * (0.2 * viva + (0.035 + 0.06 * rajada) * parada);
      // Tocando, as línguas saem do botão com força; parada, quase param.
      fluxo += dt * (0.95 * viva + (0.06 + 0.1 * rajada) * parada);
      // Tocando brilha mais; parada fica mais tênue, mas não some.
      const presenca = 0.62 + 0.38 * viva;
      const cosA = Math.cos(angulo);
      const senA = Math.sin(angulo);
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
        // CHAMA EM VOLTA DO BOTÃO. A amostra é polar: o ângulo (girado pelo
        // relógio do giro, no sentido horário) percorre um círculo do ruído, e a
        // distância à borda vira a terceira coordenada, deslocada pelo `fluxo`
        // — o desenho escorre PARA FORA, como línguas de fogo saindo do
        // círculo, enquanto o conjunto gira.
        const c = cosDe[k]!;
        const sn = senDe[k]!;
        const fora = raio - borda;
        // O giro de ESTE raio: o de dentro acompanha o CD, o de fora atrasa.
        let cg = cosA;
        let sg = senA;
        if (arrasto > 0.001) {
          const atraso = arrasto * Math.max(0, fora);
          const ct = Math.cos(atraso);
          const st = Math.sin(atraso);
          cg = cosA * ct + senA * st; // cos(giro − atraso)
          sg = senA * ct - cosA * st; // sen(giro − atraso)
        }
        const ca = c * cg + sn * sg; // cos(θ − giro)
        const sa = sn * cg - c * sg; // sen(θ − giro)
        const sx = ca * 2.3 + ox - ventoX;
        const sy = sa * 2.3 + oy - ventoY;
        const sz = fora * 4.4 - fluxo;
        // Distorção de domínio: é o que enrola e rasga as línguas.
        const wx = fbm(ruido, sx * 0.8, sy * 0.8, sz * 0.5 + t * 0.6);
        const wy = fbm(ruido, sx * 0.8 + 5.2, sy * 0.8 + 1.3, sz * 0.5 + t * 0.6 + 3.1);
        const d = fbm(ruido, sx + 1.9 * wx, sy + 1.9 * wy, sz + t);
        // Parada, a névoa se inclina para o lado para onde o vento sopra.
        const inclina = 1 + (x * vx + y * vy) * 0.55;
        // As línguas afinam conforme se afastam (a ponta da chama), mais
        // compridas tocando; o contraste abre vazios de verdade entre elas.
        const afina = fora * (0.95 - 0.55 * viva);
        const densidade = Math.max(0, Math.min(1, (d - 0.33 - afina) * 3.8 * inclina)) * janela;
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
      // Parada, o vento é lento: 30 quadros bastam (e poupam bateria).
      const intervalo = leve || viva < 0.05 ? 32 : 0;
      if (intervalo && agora - ultimo < intervalo) {
        raf = requestAnimationFrame(quadro);
        return;
      }
      // Passo limitado: voltando de uma aba escondida, nada de salto.
      const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000));
      ultimo = agora;
      const alvo = tocandoRef.current ? 1 : 0;
      const inercia = alvo > viva ? INERCIA_PLAY : INERCIA_PAUSA;
      viva += (alvo - viva) * (1 - Math.exp(-dt / inercia));
      if (alvo === 0 && viva < 0.001) viva = 0;
      if (alvo === 1 && viva > 0.999) viva = 1;
      pintar(dt, agora);
      // Nunca dorme enquanto visível: parada, ela continua ao vento.
      raf = requestAnimationFrame(quadro);
    };

    const acordar = () => {
      if (semMovimento) {
        viva = 0;
        pintar(0, performance.now());
        return;
      }
      if (raf || !visivel || document.hidden) return;
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
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          'aura-play-nevoa pointer-events-none absolute',
          toque ? 'inset-[-48%] size-[196%]' : 'inset-[-42%] size-[184%]',
        )}
      />
      {/* A borda-CD: por CIMA do botão (z-10), só o anel de fora — o ícone no
          meio fica limpo. Gira pelo mesmo laço da névoa (ver "O CD E O PUXÃO"). */}
      <span
        ref={cdRef}
        aria-hidden
        className="aura-play-cd pointer-events-none absolute inset-0 z-10 rounded-full"
      />
    </>
  );
}
