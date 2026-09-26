import { useEffect, useRef } from 'react';
import { modoLeve } from '@/lib/perf/dispositivo';

/**
 * A FUMAÇA DO PLAY — desenhada na hora, nunca a mesma duas vezes.
 *
 * Antes eram três (ou cinco) fios de CSS com keyframes fixos: por mais que os
 * tempos não fechassem entre si, o olho acha o ciclo em poucos segundos — o
 * mesmo sopro subindo pelo mesmo caminho. E ao pausar os fios eram DESMONTADOS:
 * a fumaça sumia no meio do ar, de uma vez, como se alguém apagasse a tela.
 *
 * Agora cada baforada é uma partícula com tudo sorteado ao nascer — onde nasce,
 * quanto sobe, quanto dura, o quanto balança e em que ritmo, que forma tem e
 * para que lado gira. As formas também são sorteadas (manchas feitas de várias
 * bolhas de gradiente) e trocadas de tempos em tempos. Por cima de tudo sopra um
 * "vento" que é soma de senos com frequências que não fecham entre si, com fase
 * sorteada por botão: a coluna inteira inclina junto, como fumaça de verdade, e
 * o conjunto nunca volta ao mesmo quadro.
 *
 * PAUSAR NÃO APAGA: com `emitindo` falso, só para de NASCER fumaça. A que já
 * está no ar termina de subir e se desfaz no tempo dela; quando a última some,
 * o laço de quadros para sozinho — canvas parado não custa nada. Voltar a tocar
 * volta a soltar baforadas.
 *
 * Custo: um canvas pequeno (umas três vezes o botão), `drawImage` de manchas
 * pré-desenhadas e nada de `filter`/blur por quadro. O laço só roda com
 * partícula viva ou emissão ligada, e só com o canvas visível (a barra do
 * computador e a do celular vivem montadas; a escondida tem tamanho zero e não
 * anima). Em aparelho fraco (`data-perf='baixo'`): metade das baforadas,
 * resolução 1× e 30 quadros por segundo.
 */

/** Quanto o canvas avança além do botão, em diâmetros do botão. */
const LADO = 0.8;
const TOPO = 2.4;
const BAIXO = 0.4;
/** Tamanho do canvas em diâmetros — daqui sai o diâmetro a partir da medida. */
const LARGURA_EM_B = LADO * 2 + 1;
/** Teto de partículas: com a emissão sorteada, um azar não vira enxurrada. */
const MAXIMO = 48;
const LADO_DA_MANCHA = 64;

interface Particula {
  x0: number;
  y0: number;
  idade: number;
  vida: number;
  /** Subida total, em diâmetros. */
  subida: number;
  r0: number;
  r1: number;
  alfa: number;
  amp: number;
  f1: number;
  f2: number;
  fase1: number;
  fase2: number;
  mancha: number;
  giro0: number;
  giro: number;
}

const sorteio = (min: number, max: number) => min + Math.random() * (max - min);

/** "0 0% 98%" (a variável do tema) → componentes para montar `hsla(...)`. */
function corDoTema(): string[] {
  const bruto = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const partes = bruto.split(/\s+/).filter(Boolean);
  return partes.length >= 3 ? partes.slice(0, 3) : ['0', '0%', '98%'];
}

/**
 * Uma mancha de fumaça: várias bolhas de gradiente sobrepostas em posições
 * sorteadas — borda irregular, miolo mais denso. Nenhuma sai igual à outra.
 */
function desenharMancha(cor: string[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = LADO_DA_MANCHA;
  c.height = LADO_DA_MANCHA;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const [h, s, l] = cor;
  const meio = LADO_DA_MANCHA / 2;
  const bolhas = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < bolhas; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const dist = sorteio(0, meio * 0.35);
    const x = meio + Math.cos(ang) * dist;
    const y = meio + Math.sin(ang) * dist;
    const r = sorteio(meio * 0.4, meio * 0.65);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = sorteio(0.28, 0.5);
    g.addColorStop(0, `hsla(${h}, ${s}, ${l}, ${a})`);
    g.addColorStop(0.5, `hsla(${h}, ${s}, ${l}, ${a * 0.4})`);
    g.addColorStop(1, `hsla(${h}, ${s}, ${l}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LADO_DA_MANCHA, LADO_DA_MANCHA);
  }
  return c;
}

export function FumacaDoPlay({ emitindo, toque }: { emitindo: boolean; toque: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emitindoRef = useRef(emitindo);
  const acordarRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    emitindoRef.current = emitindo;
    if (emitindo) acordarRef.current();
  }, [emitindo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const particulas: Particula[] = [];
    let raf = 0;
    let ultimoQuadro = 0;
    let relogio = 0;
    let proximaBaforada = 0;
    let largura = 0;
    let altura = 0;
    let diametro = 0;
    // Só aquece quem já nasce tocando; quem nasce pausado começa do zero no
    // primeiro play, com a fumaça saindo do botão como deve ser.
    let aquecida = !emitindoRef.current;
    let cor = '';
    let manchas: HTMLCanvasElement[] = [];
    let trocaDeMancha = 0;
    // O vento de cada botão começa num ponto diferente da "partitura".
    const fasesDoVento = [sorteio(0, 100), sorteio(0, 100), sorteio(0, 100)];

    const lerCor = () => {
      const agora = corDoTema();
      const chave = agora.join(' ');
      if (chave === cor) return;
      cor = chave;
      manchas = Array.from({ length: 5 }, () => desenharMancha(agora));
    };

    const medir = () => {
      const caixa = canvas.getBoundingClientRect();
      largura = caixa.width;
      altura = caixa.height;
      diametro = largura / LARGURA_EM_B;
      const escala = modoLeve() ? 1 : Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);
      ctx.setTransform(escala, 0, 0, escala, 0, 0);
    };

    /** Baforadas por segundo. Toque é mais vivo (ver `FIOS_TOQUE` de antes). */
    const ritmo = () => (toque ? 7 : 5) * (modoLeve() ? 0.5 : 1);
    /** Intervalo sorteado (Poisson): sem batida regular para o olho achar. */
    const intervalo = () => Math.max(0.04, -Math.log(1 - Math.random()) / ritmo());

    const nascer = (idade = 0) => {
      if (particulas.length >= MAXIMO || manchas.length === 0) return;
      const B = diametro;
      const rapidez = toque ? 1.3 : 1;
      particulas.push({
        x0: (LADO + 0.5) * B + sorteio(-0.22, 0.22) * B,
        y0: (TOPO + 0.5) * B + sorteio(-0.1, 0.2) * B,
        idade,
        vida: sorteio(2.2, 4.2) / rapidez,
        subida: sorteio(1.6, TOPO + 0.2),
        r0: sorteio(0.3, 0.5) * B,
        r1: sorteio(0.8, 1.35) * B,
        alfa: sorteio(toque ? 0.55 : 0.4, toque ? 0.9 : 0.7),
        amp: sorteio(0.08, 0.3) * B,
        f1: sorteio(1.2, 3.4),
        f2: sorteio(3.5, 7),
        fase1: Math.random() * Math.PI * 2,
        fase2: Math.random() * Math.PI * 2,
        mancha: Math.floor(Math.random() * manchas.length),
        giro0: Math.random() * Math.PI * 2,
        giro: sorteio(-0.8, 0.8),
      });
    };

    /** Brisa comum a todas: senos de períodos que não fecham (≈ 17s, 7s, 3s). */
    const vento = (t: number) =>
      Math.sin(t * 0.37 + fasesDoVento[0]!) +
      0.6 * Math.sin(t * 0.89 + fasesDoVento[1]!) +
      0.3 * Math.sin(t * 2.13 + fasesDoVento[2]!);

    const desenhar = () => {
      ctx.clearRect(0, 0, largura, altura);
      const brisa = vento(relogio) * diametro * 0.35;
      for (const p of particulas) {
        const q = p.idade / p.vida;
        // Sobe rápido e perde força — fumaça desacelera ao esfriar.
        const y = p.y0 - p.subida * diametro * (1 - (1 - q) * (1 - q));
        const x =
          p.x0 +
          p.amp *
            q *
            (Math.sin(p.f1 * p.idade + p.fase1) + 0.5 * Math.sin(p.f2 * p.idade + p.fase2)) +
          brisa * q * q;
        const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - q) * (1 - q));
        // Aparece rápido, some devagar: o que acaba é o rastro, não a borda.
        const entrada = Math.min(1, q / 0.15);
        const a = p.alfa * entrada * Math.pow(1 - q, 1.6);
        const mancha = manchas[p.mancha];
        if (a <= 0.004 || !mancha) continue;
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.giro0 + p.giro * p.idade);
        ctx.drawImage(mancha, -r, -r, r * 2, r * 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const quadro = (agora: number) => {
      raf = 0;
      if (largura === 0) return; // escondido (a barra do outro tamanho de tela)
      // Aparelho fraco: 30 quadros por segundo bastam para fumaça.
      if (modoLeve() && agora - ultimoQuadro < 30) {
        raf = requestAnimationFrame(quadro);
        return;
      }
      // Passo limitado: voltando de uma aba escondida, nada de salto.
      const dt = Math.min(0.05, Math.max(0, (agora - ultimoQuadro) / 1000));
      ultimoQuadro = agora;
      relogio += dt;

      if (emitindoRef.current) {
        while (proximaBaforada <= relogio) {
          nascer();
          proximaBaforada += intervalo();
        }
      } else {
        // Parado, o relógio de baforadas acompanha: ao voltar a tocar, a
        // primeira sai na hora, não uma rajada acumulada.
        proximaBaforada = relogio;
      }

      for (let i = particulas.length - 1; i >= 0; i -= 1) {
        const p = particulas[i]!;
        p.idade += dt;
        if (p.idade >= p.vida) particulas.splice(i, 1);
      }

      // De tempos em tempos uma das formas é redesenhada — nem o repertório de
      // manchas se repete numa sessão longa.
      trocaDeMancha -= dt;
      if (trocaDeMancha <= 0 && cor) {
        trocaDeMancha = sorteio(4, 9);
        const i = Math.floor(Math.random() * manchas.length);
        manchas[i] = desenharMancha(cor.split(' '));
      }

      desenhar();
      if (particulas.length > 0 || emitindoRef.current) raf = requestAnimationFrame(quadro);
    };

    const acordar = () => {
      if (raf || largura === 0) return;
      if (!emitindoRef.current && particulas.length === 0) return;
      lerCor();
      // Abrir a tela cheia com a música tocando não pode mostrar um botão "sem
      // fumaça" que só depois começa a soltar: a coluna já nasce no meio do
      // caminho, com idades sorteadas (o `animation-delay` negativo de antes).
      if (!aquecida && emitindoRef.current) {
        aquecida = true;
        const quantas = Math.round(ritmo() * 2.5);
        for (let i = 0; i < quantas; i += 1) nascer(0);
        for (const p of particulas) p.idade = Math.random() * p.vida * 0.9;
      }
      ultimoQuadro = performance.now();
      raf = requestAnimationFrame(quadro);
    };
    acordarRef.current = acordar;

    // O tamanho segue o botão; e um canvas que estava escondido (tamanho zero)
    // e aparece — girar o celular, abrir a janela — volta a animar aqui.
    const observador = new ResizeObserver(() => {
      medir();
      if (largura === 0 && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      acordar();
    });
    observador.observe(canvas);
    medir();
    acordar();

    // O tema trocou (claro/escuro): a cor de destaque é outra.
    const temas = new MutationObserver(() => {
      cor = '';
      lerCor();
    });
    temas.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observador.disconnect();
      temas.disconnect();
      if (raf) cancelAnimationFrame(raf);
      acordarRef.current = () => undefined;
    };
  }, [toque]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: `${-LADO * 100}%`,
        top: `${-TOPO * 100}%`,
        width: `${LARGURA_EM_B * 100}%`,
        height: `${(TOPO + 1 + BAIXO) * 100}%`,
      }}
    />
  );
}
