import { useEffect, useRef } from 'react';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { posicaoDoQueToca } from '@/lib/devices/presence';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { modoLeve } from '@/lib/perf/dispositivo';
import { cn } from '@/lib/utils';
import {
  criarGeometria,
  espiralDe,
  pintarCampo,
  suavizarAlfa,
  type Geometria,
  type QuadroDaNevoa,
} from './auraDoPlay/campo';
import {
  avancar,
  emRepouso,
  estadoInicial,
  type EstadoDaNevoa,
  type SinaisDaNevoa,
} from './auraDoPlay/maquina';
import { campoDaFaixa, type CampoDaFaixa } from './auraDoPlay/ruido';

/**
 * A AURA DO PLAY — a névoa em volta do botão, que reage ao que o player faz e
 * nunca passa duas vezes pelo mesmo desenho.
 *
 *  • BAIXANDO (a faixa foi pedida e o som ainda não saiu): a névoa nasce
 *    espalhada e é SUGADA para o botão, cada vez mais depressa ao chegar perto
 *    — e se acumula na borda.
 *  • TOCANDO: a sucção vira giro, sem salto, no ritmo e na fase do GUIA (a
 *    borda-CD: uma volta a cada 1,8 s, presa ao relógio da música).
 *  • PAUSADO: desacelera até repousar; o laço dorme.
 *  • TROCOU A FAIXA: a atual se dissipa, a semente muda com a névoa invisível e a
 *    nova é reunida.
 *
 * Quem decide tudo isso é a MÁQUINA DE ESTADOS PURA (`auraDoPlay/maquina.ts`);
 * o desenho (`auraDoPlay/campo.ts`) só transforma parâmetros em pixels; este
 * arquivo é a cola: laço de quadros, canvas, visibilidade, modo leve.
 *
 * NÃO REPETE: ruído 3D contínuo (x, y e TEMPO) com domínio distorcido, hash de
 * inteiros sem tabela (sem período) e SEMENTE POR FAIXA (o id): cada música tem
 * a sua névoa, igual em todo aparelho.
 *
 * CUSTO: canvas de 48×48 ampliado pelo CSS (névoa não tem detalhe fino); 30
 * quadros/s no máximo, sem alocar por quadro (ImageData e vetores reaproveitados).
 * O laço só roda com a aura visível, a aba à vista e algo mudando.
 *
 * MODO LEVE (`data-perf="baixo"`): nenhum JavaScript por quadro. A névoa são 4
 * camadas pintadas UMA vez por faixa (64×64, semente da faixa) e animadas só por
 * `transform`/`opacity` em CSS, com durações primas entre si (31 s, 17 s, 13 s,
 * 3,1 s, 2,3 s) para o conjunto não repetir. O guia é o único giro sincronizado.
 */

const DOIS_PI = Math.PI * 2;
/** Resolução da névoa (CSS amplia). */
const N_NORMAL = 48;
const N_LEVE = 64;
/** Quanto tempo (ms) as camadas do modo leve ficam andando depois de já invisíveis. */
const ESPERA_QUIETO = 1000;
/** Fade da troca de faixa no modo leve (ms). */
const TROCA_LEVE = 380;

type CorRgb = readonly [number, number, number];

export function AuraDoPlay({
  playing,
  toque,
  carregando = false,
  faixa = '',
}: {
  playing: boolean;
  toque: boolean;
  /** A música está sendo baixada: a névoa é SUGADA para dentro do botão. */
  carregando?: boolean;
  /** Id da faixa: a semente da névoa. */
  faixa?: string;
}) {
  const semMovimento = useSemMovimento();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leveRef = useRef<HTMLSpanElement>(null);
  const cdRef = useRef<HTMLSpanElement>(null);
  const sinaisRef = useRef<SinaisDaNevoa>({
    tocando: playing,
    carregando,
    semMovimento,
    faixa,
    posicao: null,
    rajada: 0.5,
  });
  const acordarRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    sinaisRef.current.tocando = playing;
    sinaisRef.current.carregando = carregando;
    sinaisRef.current.faixa = faixa;
    acordarRef.current();
  }, [playing, carregando, faixa]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sinais = sinaisRef.current;
    sinais.semMovimento = semMovimento;

    canvas.width = N_NORMAL;
    canvas.height = N_NORMAL;
    const geo = criarGeometria(N_NORMAL);
    const imagem = ctx.createImageData(N_NORMAL, N_NORMAL);
    const px = imagem.data;
    let campo: CampoDaFaixa = campoDaFaixa(sinais.faixa);
    let campoDe = sinais.faixa;
    const est: EstadoDaNevoa = estadoInicial(sinais);
    /** Borda do botão: ~54% do raio da caixa (inset -42%/-48%). */
    const borda = toque ? 0.51 : 0.54;

    // A COR: a de destaque do tema, relida de tempos em tempos.
    let cor: CorRgb = [255, 255, 255];
    let teto = 230;
    let corLidaEm = -Infinity;
    /** Lê a cor; devolve true se mudou. */
    const lerCor = (agora: number): boolean => {
      if (agora - corLidaEm < 1000) return false;
      corLidaEm = agora;
      const hsl = getComputedStyle(canvas).getPropertyValue('--accent').trim();
      if (!hsl) return false;
      ctx.fillStyle = '#000';
      ctx.fillStyle = `hsl(${hsl})`;
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(ctx.fillStyle));
      if (!m) return false;
      const nova: CorRgb = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
      const mudou = nova[0] !== cor[0] || nova[1] !== cor[1] || nova[2] !== cor[2];
      cor = nova;
      // MESMA PRESENÇA NOS DOIS TEMAS: névoa escura sobre fundo claro pesa mais.
      const luz = (0.2126 * nova[0] + 0.7152 * nova[1] + 0.0722 * nova[2]) / 255;
      teto = luz < 0.5 ? 130 : 230;
      return mudou;
    };

    /** Relógio do VENTO (tempo real) e o quanto ele já levou a névoa. */
    let tv = campo.ox % 100;
    let ventoX = 0;
    let ventoY = 0;
    let vx = 0;
    let vy = 0;
    let raf = 0;
    let ultimo = 0;
    let visivel = true;

    /** Quadro reaproveitado: nenhum objeto novo por quadro. */
    const quadro: QuadroDaNevoa = {
      ang: 0,
      t: 0,
      fluxo: 0,
      viva: 0,
      suga: 0,
      giro: 0,
      densidade: 0.5,
      raio: 0.98,
      opacidade: 1,
      vx: 0,
      vy: 0,
      ventoX: 0,
      ventoY: 0,
      borda,
      cor,
      teto,
      braco: 0,
      espiral: 7,
    };

    const trocarCampo = () => {
      if (campoDe === est.faixa) return;
      campo = campoDaFaixa(est.faixa);
      campoDe = est.faixa;
    };

    /** Os parâmetros da máquina viram o quadro do desenho. */
    const preencher = () => {
      quadro.ang = est.ang;
      quadro.t = est.t;
      quadro.fluxo = est.fluxo;
      quadro.viva = est.viva;
      quadro.suga = est.suga;
      quadro.giro = est.giro;
      quadro.densidade = est.densidade;
      quadro.raio = est.raio;
      quadro.opacidade = est.opacidade;
      quadro.vx = vx;
      quadro.vy = vy;
      quadro.ventoX = ventoX;
      quadro.ventoY = ventoY;
      quadro.cor = cor;
      quadro.teto = teto;
      // O braço do tornado se firma com o giro e com a sucção (que enrola a espiral).
      quadro.braco = 0.35 + 0.65 * Math.max(est.giro, est.suga * 0.85);
      quadro.espiral = espiralDe(est.suga);
    };

    const aplicarCd = () => {
      const cd = cdRef.current;
      if (cd) cd.style.transform = `rotate(${est.ang.toFixed(4)}rad)`;
    };

    /** Avança a máquina (dt) e desenha. `dt = 0` só redesenha. */
    const passo = (dt: number, agora: number) => {
      lerCor(agora);
      tv += dt;
      // VENTO: direção e força variam devagar (ruído no tempo real), com
      // rajadas. Pesa só parada.
      const dirVento = (campo.ruido(tv * 0.07, 11.3, 2.7) - 0.5) * Math.PI * 2.4;
      const rajada = campo.ruido(tv * 0.45, 4.1, 9.9);
      sinais.rajada = rajada;
      sinais.posicao =
        sinais.tocando && !sinais.carregando && !semMovimento
          ? (() => {
              const p = posicaoDoQueToca(() => audioEngine.getPosition());
              return p !== null && Number.isFinite(p) ? p : null;
            })()
          : null;
      avancar(est, sinais, dt, est);
      trocarCampo();
      const forca = (0.35 + 0.65 * rajada * rajada) * (1 - est.viva);
      vx = Math.cos(dirVento) * forca;
      vy = Math.sin(dirVento) * forca;
      ventoX += vx * dt * 0.35;
      ventoY += vy * dt * 0.35;
      preencher();
      pintarCampo(px, geo, campo, quadro);
      ctx.putImageData(imagem, 0, 0);
      aplicarCd();
    };

    // ── MODO LEVE ─────────────────────────────────────────────────────────
    let geoLeve: Geometria | null = null;
    let imagemLeve: ImageData | null = null;
    let tmpLeve: Uint8ClampedArray | null = null;
    /** Faixa e cor com que as camadas estão pintadas agora. */
    let leveFaixa: string | null = null;
    let leveCor = '';
    let timerQuieto: ReturnType<typeof setTimeout> | undefined;
    let timerTroca: ReturnType<typeof setTimeout> | undefined;

    /** Pinta as 4 camadas (UMA vez por faixa/cor): guia, difusa e duas de sucção. */
    const pintarCamadas = (nome: string) => {
      const raiz = leveRef.current;
      if (!raiz) return;
      const telas = Array.from(raiz.querySelectorAll('canvas'));
      const c0 = telas[0]?.getContext('2d');
      if (!c0) return;
      geoLeve ??= criarGeometria(N_LEVE);
      imagemLeve ??= c0.createImageData(N_LEVE, N_LEVE);
      const campoLeve = nome === campoDe ? campo : campoDaFaixa(nome);
      const base: QuadroDaNevoa = {
        ...quadro,
        ang: 0,
        vx: 0,
        vy: 0,
        ventoX: 0,
        ventoY: 0,
        borda,
        cor,
        teto,
        opacidade: 0.62,
        raio: 0.98,
        suga: 0,
        giro: 0,
        viva: 0,
        densidade: 0.9,
        fluxo: 3,
        t: 5,
        braco: 0,
        espiral: espiralDe(0),
      };
      const camadas: QuadroDaNevoa[] = [
        // 0 — o GUIA: o braço do tornado, que gira com o CD.
        { ...base, viva: 1, giro: 1, braco: 1, t: 9, fluxo: 7 },
        // 1 — a névoa difusa, assentada.
        { ...base, t: 41, fluxo: 19, densidade: 0.8 },
        // 2 e 3 — a sucção: espirais apertadas, de fatias diferentes do ruído.
        { ...base, suga: 1, braco: 1, espiral: espiralDe(1), t: 73, fluxo: 31, densidade: 1 },
        { ...base, suga: 1, braco: 1, espiral: espiralDe(1), t: 113, fluxo: 47, densidade: 1 },
      ];
      telas.forEach((tela, i) => {
        const c = tela.getContext('2d');
        const q = camadas[i];
        if (!c || !q || !imagemLeve || !geoLeve) return;
        tela.width = N_LEVE;
        tela.height = N_LEVE;
        pintarCampo(imagemLeve.data, geoLeve, campoLeve, q);
        suavizarAlfa(
          imagemLeve.data,
          N_LEVE,
          (tmpLeve ??= new Uint8ClampedArray(N_LEVE * N_LEVE * 4)),
          2,
        );
        c.putImageData(imagemLeve, 0, 0);
      });
      leveFaixa = nome;
      leveCor = cor.join(',');
    };

    /**
     * Estado das camadas em CSS: `data-fase` decide a opacidade de cada uma (com
     * transição — a passagem baixando→tocando é um fade contínuo, nunca um corte)
     * e `data-quieto` pausa as animações que já ficaram invisíveis.
     */
    const fixarFase = (fase: 'reunindo' | 'girando' | 'repouso', parado: boolean) => {
      const raiz = leveRef.current;
      if (!raiz) return;
      // Mesma fase: nada a mexer (e o relógio do quieto em andamento segue).
      if (raiz.dataset.fase === fase && (!parado || raiz.dataset.quieto === 'tudo')) return;
      if (timerQuieto) clearTimeout(timerQuieto);
      timerQuieto = undefined;
      raiz.dataset.fase = fase;
      raiz.dataset.girando = String(fase === 'girando');
      if (parado) {
        raiz.dataset.quieto = 'tudo';
        return;
      }
      raiz.dataset.quieto = 'nao';
      if (fase === 'reunindo') return;
      timerQuieto = setTimeout(() => {
        raiz.dataset.quieto = fase === 'repouso' ? 'tudo' : 'puxa';
      }, ESPERA_QUIETO);
    };

    /**
     * MODO LEVE: zero JavaScript por quadro. Repinta só quando o estado muda
     * (toca/pausa/baixa/troca de faixa); o resto é CSS na composição.
     */
    const pintarLeve = () => {
      lerCor(performance.now());
      const nome = sinais.faixa || est.faixa;
      const cdEl = cdRef.current;
      const gira = sinais.tocando && !sinais.carregando && !semMovimento;
      const fase: 'reunindo' | 'girando' | 'repouso' = semMovimento
        ? 'repouso'
        : sinais.carregando
          ? 'reunindo'
          : sinais.tocando
            ? 'girando'
            : 'repouso';
      est.faixa = nome;
      est.viva = est.giro = gira ? 1 : 0;
      est.suga = fase === 'reunindo' ? 1 : 0;
      const corAgora = cor.join(',');
      if (leveFaixa === null || corAgora !== leveCor) {
        pintarCamadas(nome);
      } else if (leveFaixa !== nome && timerTroca === undefined) {
        // Troca de faixa: a névoa atual se dissipa (opacity) e a nova é pintada
        // com ela invisível; depois reúne.
        const raiz = leveRef.current;
        if (raiz) raiz.dataset.troca = 'true';
        timerTroca = setTimeout(() => {
          timerTroca = undefined;
          pintarCamadas(sinais.faixa || est.faixa);
          if (leveRef.current) delete leveRef.current.dataset.troca;
        }, TROCA_LEVE);
      }
      fixarFase(fase, semMovimento);
      if (cdEl) {
        cdEl.style.transform = '';
        if (!semMovimento) {
          cdEl.dataset.estatica = 'true';
          cdEl.dataset.girando = String(gira);
        }
      }
    };

    /**
     * O laço dorme em repouso (ver `emRepouso`): pausada, sem baixar, tudo
     * assentado — nada muda de um quadro para o outro. Tocar ou baixar acorda.
     */
    const loop = (agora: number) => {
      raf = 0;
      if (!visivel || document.hidden) return;
      if (modoLeve()) {
        pintarLeve();
        return;
      }
      // 30 QUADROS POR SEGUNDO, SEMPRE: névoa desfocada não ganha nada com 60.
      if (agora - ultimo < 32) {
        raf = requestAnimationFrame(loop);
        return;
      }
      // Passo limitado: voltando de uma aba escondida, nada de salto.
      const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000));
      ultimo = agora;
      passo(dt, agora);
      if (emRepouso(est, sinais)) return;
      raf = requestAnimationFrame(loop);
    };

    const acordar = () => {
      if (semMovimento) {
        avancar(est, sinais, 0, est);
        trocarCampo();
        if (modoLeve()) {
          pintarLeve();
          return;
        }
        passo(0, performance.now());
        return;
      }
      if (modoLeve()) {
        pintarLeve();
        return;
      }
      if (raf || !visivel || document.hidden) return;
      if (emRepouso(est, sinais)) return;
      ultimo = performance.now();
      raf = requestAnimationFrame(loop);
    };
    acordarRef.current = acordar;

    // Primeiro quadro na hora: a névoa aparece já no lugar (no modo leve, o
    // `acordar` abaixo pinta as camadas).
    if (!modoLeve()) passo(0, performance.now());

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
    // Trocou o tema: a cor da névoa muda (relida na hora; o modo leve repinta).
    const tema =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            corLidaEm = -Infinity;
            if (modoLeve() && lerCor(performance.now())) pintarLeve();
          });
    tema?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    acordar();

    return () => {
      observador?.disconnect();
      tema?.disconnect();
      document.removeEventListener('visibilitychange', aba);
      if (raf) cancelAnimationFrame(raf);
      if (timerQuieto) clearTimeout(timerQuieto);
      if (timerTroca) clearTimeout(timerTroca);
      acordarRef.current = () => undefined;
    };
  }, [semMovimento, toque]);

  const caixa = toque ? 'inset-[-48%] size-[196%]' : 'inset-[-42%] size-[184%]';
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn('aura-play-nevoa aura-play-surge pointer-events-none absolute', caixa)}
      />
      {/* Modo leve: as camadas animadas só por transform/opacity (ver o CSS). */}
      <span
        ref={leveRef}
        aria-hidden
        data-fase="inicio"
        data-girando="false"
        data-quieto="nao"
        className={cn('aura-play-leve aura-play-surge pointer-events-none absolute', caixa)}
      >
        <span className="aura-play-camada aura-play-c-braco">
          <canvas />
        </span>
        <span className="aura-play-camada aura-play-c-difusa">
          <canvas />
        </span>
        <span className="aura-play-camada aura-play-c-puxa">
          <canvas />
        </span>
        <span className="aura-play-camada aura-play-c-puxa aura-play-c-puxa-2">
          <canvas />
        </span>
      </span>
      {/* A borda-CD: por CIMA do botão (z-10), só o anel de fora — o ícone no
          meio fica limpo. Gira pelo mesmo ângulo da névoa. */}
      <span
        ref={cdRef}
        aria-hidden
        data-oculto={carregando}
        className="aura-play-cd pointer-events-none absolute inset-0 z-10 rounded-full"
      />
    </>
  );
}
