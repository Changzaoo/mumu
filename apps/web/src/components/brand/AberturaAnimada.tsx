/**
 * A ABERTURA — o logo do radinho se desenhando, como num estúdio de motion.
 *
 * Pedido do dono (20/10/2026): uma animação de abertura OBRIGATÓRIA — ela é
 * a tela de carregamento: enquanto corre, o app sobe por baixo (sessão,
 * fontes, biblioteca). Só sai quando as duas coisas acontecem: a cena
 * terminou E o app está pronto. App pronto antes, a cena vai até o fim; app
 * atrasado, o logo final fica parado na tela até ele chegar (com um teto,
 * para nunca prender ninguém numa tela vazia).
 *
 * DIREÇÃO DE ARTE (29/10/2026): no lugar do rádio e da pessoa, um "logo
 * animation concept" no estilo do post de referência do dono
 * (instagram.com/p/De5mKk2MT8P) — o símbolo é CONSTRUÍDO como numa
 * ferramenta de desenho (eixos, círculos guia, âncoras, alças, cursor), um
 * corte em negativo, o contorno percorrido por uma faísca, o nome escrito
 * letra a letra, e uma vitrine rápida da marca antes do logo final. Só preto,
 * branco e cinzas, seguindo o tema (tinta = `currentColor`, fundo = `--color-bg`).
 *
 * O símbolo é o do app (o `Radio` do lucide, ver RadinhoMark): ponto central
 * e dois pares de arcos — e os arcos são pedaços de círculos concêntricos de
 * raio 2, 5,94 e 10,04 em volta de (12, 12). A construção mostra exatamente
 * isso: os círculos guia aparecem e os arcos são traçados por cima deles.
 *
 * Os cinco atos (tempos de cena em `estilos`):
 *   1. CONSTRUÇÃO: o símbolo nasce pequeno, cresce e vira fantasma; eixos e
 *      círculos guia se traçam, âncoras e alças aparecem, o cursor passeia, os
 *      arcos são traçados;
 *   2. NEGATIVO: corte seco para a tela em tinta com o símbolo vazado;
 *   3. CONTORNO: símbolo + "radinho" em contorno; uma faísca corre pelos
 *      arcos, o nome é escrito da esquerda para a direita e tudo se preenche;
 *   4. VITRINE: o nome gigante passando na tela em negativo, depois um cartão
 *      de vidro com o símbolo e um reflexo;
 *   5. FINAL: o logo "radinho.online" pousa no centro e fica.
 *
 * DESEMPENHO (lições do Moto G34, 20/10/2026): nada de câmera nem de zoom de
 * camada de tela inteira — tudo é traço (stroke-dashoffset), opacidade e
 * transform de peças pequenas; o único transform grande é o `translateX` do
 * nome gigante, sem escala. Nenhuma animação infinita; peça que sai some com
 * `visibility: hidden`.
 *
 * "Reduzir movimento" ligado: só o logo final, parado, e sai assim que o app
 * está pronto.
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { anotar } from '@/lib/telemetry/diario';
// Uma vez por sessão: recarga no meio do uso não repete a cena (ver o módulo).
import { aberturaJaVista, marcarAberturaVista } from './aberturaVista';

/**
 * Duração da cena inteira, em ms DE CENA — o mínimo que a abertura fica na
 * tela. A coreografia foi desenhada em 9,5 s; o relógio real anda mais rápido
 * (ver `RITMO`), e é por isso que todo tempo que vai para o navegador passa
 * por `real()` ou `s()`.
 */
export const DURACAO_DA_CENA_MS = 9_500;
/**
 * O RITMO. Pedido do dono (27/10/2026): "a abertura está muito demorada". A
 * cena inteira roda `RITMO` vezes mais rápido do que foi desenhada — 9,5 s
 * viram ~5,3 s — sem mexer na coreografia: cada tempo de cena (delays do CSS,
 * timers) vira tempo real dividindo por este fator.
 */
export const RITMO = 1.8;
/** Tempo de cena (ms) → tempo real (ms). */
const real = (ms: number): number => ms / RITMO;
/** Tempo de cena (s) → tempo real para o CSS ("0.306s"). */
const s = (seg: number): string => `${(seg / RITMO).toFixed(3)}s`;
/** Teto de espera pelo app (ms): depois disto a abertura sai de qualquer jeito. */
const TETO_DE_ESPERA_MS = 20_000;
/** Saída: o tempo do fade (ms). */
const SAIDA_MS = 700;

/** O fundo do app (o mesmo token do tema), para vazar a tinta. */
const FUNDO = 'var(--color-bg)';

/** Os arcos do símbolo (coordenadas do ícone 24×24, centro em 12,12). */
const ARCOS = [
  'M4.9 19.1C1 15.2 1 8.8 4.9 4.9',
  'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5',
  'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5',
  'M19.1 4.9C23 8.8 23 15.2 19.1 19.1',
] as const;

/** Raios dos círculos de que os arcos são pedaços. */
const RAIOS = [2, 5.94, 10.04] as const;

/** As pontas dos arcos — as âncoras da construção. */
const ANCORAS = [
  [4.9, 4.9],
  [4.9, 19.1],
  [7.8, 7.7],
  [7.8, 16.2],
  [16.2, 7.8],
  [16.2, 16.3],
  [19.1, 4.9],
  [19.1, 19.1],
] as const;

/** Alças de bézier dos arcos de fora: [âncora, ponto de controle]. */
const ALCAS = [
  [4.9, 19.1, 1, 15.2],
  [4.9, 4.9, 1, 8.8],
  [19.1, 4.9, 23, 8.8],
  [19.1, 19.1, 23, 15.2],
] as const;

/** Escala do símbolo grande da construção (24 → 192 unidades da cena). */
const GRANDE = 8;
/** Escala do símbolo no logo (24 → 62,4). */
const NO_LOGO = 2.6;
/** Espaço entre o símbolo e o nome, e o corpo do nome. */
const VAO = 14;
const CORPO = 50;
/** Largura do nome antes de medir (Inter bold, 50 px ≈ 190). */
const LARGURA_INICIAL = 190;

/** O símbolo em traço, nas coordenadas do ícone. */
function Simbolo({
  largura,
  cor = 'currentColor',
  className,
  comprimento,
}: {
  largura: number;
  cor?: string;
  className?: string;
  /** `pathLength=1` em cada traço, para animar com dash. */
  comprimento?: boolean;
}) {
  const pl = comprimento ? 1 : undefined;
  return (
    <g
      className={className}
      style={{ stroke: cor }}
      strokeWidth={largura}
      strokeLinecap="round"
      fill="none"
    >
      <circle cx="12" cy="12" r="2" pathLength={pl} />
      {ARCOS.map((d) => (
        <path key={d} d={d} pathLength={pl} />
      ))}
    </g>
  );
}

/** Um símbolo solto (SVG próprio) para as peças em HTML. */
function SimboloSolto({ cor, tamanho }: { cor: string; tamanho: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: tamanho, height: tamanho }} aria-hidden>
      <Simbolo largura={2.2} cor={cor} />
    </svg>
  );
}

/** O app está pronto por baixo? Sessão resolvida e fontes carregadas. */
function useAppPronto(): boolean {
  const { loading } = useAuthUser();
  const [fontes, setFontes] = useState(false);
  useEffect(() => {
    let vivo = true;
    const pronto = (): void => {
      if (vivo) setFontes(true);
    };
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(pronto, pronto);
    } else pronto();
    return () => {
      vivo = false;
    };
  }, []);
  return !loading && fontes;
}

/**
 * O logo deitado (símbolo + nome), centrado em (0, 0) pela largura medida do
 * nome. `contorno` desenha o símbolo como tubo (tinta por fora, fundo por
 * dentro) e o nome só em traço — o ato 3 os preenche.
 */
function Logo({
  larguraNome,
  contorno,
  textoRef,
  online,
}: {
  larguraNome: number;
  contorno?: boolean;
  textoRef?: Ref<SVGTextElement>;
  online?: boolean;
}) {
  const lado = 24 * NO_LOGO;
  const x0 = -(lado + VAO + larguraNome) / 2;
  const xTexto = x0 + lado + VAO;
  return (
    <g>
      <g transform={`translate(${x0} ${-lado / 2}) scale(${NO_LOGO})`}>
        {contorno ? (
          <>
            <Simbolo largura={2.4} className="tubo-tinta" comprimento />
            <Simbolo largura={1.3} cor={FUNDO} className="tubo-miolo" comprimento />
            <Simbolo largura={4} className="faisca-halo" comprimento />
            <Simbolo largura={1.3} className="faisca" comprimento />
          </>
        ) : (
          <Simbolo largura={2.2} />
        )}
      </g>
      <text
        ref={textoRef}
        className={contorno ? 'nome-contorno' : undefined}
        x={xTexto}
        y={CORPO * 0.36}
        fontSize={CORPO}
        fontWeight={700}
        letterSpacing={-1}
        style={
          contorno ? { fill: 'currentColor', stroke: 'currentColor' } : { fill: 'currentColor' }
        }
      >
        radinho
        {online && (
          <tspan fillOpacity={0.4} fontWeight={500}>
            .online
          </tspan>
        )}
      </text>
    </g>
  );
}

export function AberturaAnimada() {
  const pronto = useAppPronto();
  const semMovimento = useSemMovimento();
  const [cenaAcabou, setCenaAcabou] = useState(false);
  const [teto, setTeto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  // Já vista nesta sessão (recarga no meio do uso): nasce fechada, sem cena.
  const [fechada, setFechada] = useState(aberturaJaVista);
  const [pulada, setPulada] = useState(false);
  // O nome é medido de verdade (a fonte pode chegar depois): o logo centra por ele.
  const textoRef = useRef<SVGTextElement>(null);
  const [larguraNome, setLarguraNome] = useState(LARGURA_INICIAL);
  const [larguraOnline, setLarguraOnline] = useState(LARGURA_INICIAL + 150);
  const finalRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    if (fechada) return;
    const medir = (): void => {
      const t = textoRef.current;
      const f = finalRef.current;
      if (t && typeof t.getComputedTextLength === 'function') {
        const l = t.getComputedTextLength();
        if (l > 0) setLarguraNome(l);
      }
      if (f && typeof f.getComputedTextLength === 'function') {
        const l = f.getComputedTextLength();
        if (l > 0) setLarguraOnline(l);
      }
    };
    medir();
    if ('fonts' in document) void document.fonts.ready.then(medir, () => undefined);
  }, [fechada]);

  useEffect(() => {
    const a = setTimeout(() => setCenaAcabou(true), semMovimento ? 0 : real(DURACAO_DA_CENA_MS));
    const b = setTimeout(() => setTeto(true), TETO_DE_ESPERA_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [semMovimento]);

  const podeSair = cenaAcabou && (pronto || teto);
  // Só `podeSair` nas dependências: com `saindo` junto, o próprio setSaindo
  // rodava a limpeza e cancelava o timer do fade — a abertura ficava montada
  // para sempre, invisível (opacity 0), em vez de sair do DOM.
  useEffect(() => {
    if (!podeSair) return;
    setSaindo(true);
    const t = setTimeout(() => setFechada(true), SAIDA_MS);
    return () => clearTimeout(t);
  }, [podeSair]);

  // Registra a decisão no diário de bordo e marca a sessão: a próxima recarga
  // não repete a cena. (Roda uma vez, na montagem.)
  useEffect(() => {
    if (fechada) {
      anotar('app', 'abertura', 'dispensada: já vista nesta sessão');
      return;
    }
    marcarAberturaVista();
    anotar('app', 'abertura', 'mostrada');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  // PULAR. A cena acaba na hora; a abertura sai assim que o app estiver pronto
  // por baixo (ou no teto). O botão e a tecla Esc fazem a mesma coisa.
  const pular = (): void => {
    if (pulada || saindo || fechada) return;
    setPulada(true);
    setCenaAcabou(true);
    anotar('app', 'abertura', 'pulada');
  };
  useEffect(() => {
    if (fechada) return;
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') pular();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pular` lê o estado atual
  }, [fechada, pulada, saindo]);

  // ENQUANTO A ABERTURA COBRE A TELA, O APP NÃO PINTA. Ele continua montando,
  // buscando dados e carregando imagens por baixo (`visibility` não para nada
  // disso), mas o navegador não gasta quadro repintando o que ninguém vê. No
  // Moto G34 (20/10/2026) o app repintando por baixo disputava a GPU com a
  // animação e a tela inteira piscava. Na saída (fade) o app volta a aparecer.
  useEffect(() => {
    if (fechada || saindo) {
      delete document.documentElement.dataset.abrindo;
      return;
    }
    document.documentElement.dataset.abrindo = '1';
    return () => {
      delete document.documentElement.dataset.abrindo;
    };
  }, [fechada, saindo]);

  if (fechada) return null;

  const classe = ['abertura', semMovimento ? 'abertura--parada' : ''].filter(Boolean).join(' ');
  // Atraso de cada peça em segundos de cena, direto no estilo.
  const em = (seg: number): CSSProperties => ({ animationDelay: s(seg) });
  const c = GRANDE * 12; // o centro do símbolo grande, em unidades da cena
  // Onde o nome começa no logo do ato 3: a cortina e a caneta andam sobre ele.
  const xNome = -(24 * NO_LOGO + VAO + larguraNome) / 2 + 24 * NO_LOGO + VAO;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy={!podeSair}
      aria-label="Abrindo o radinho"
      data-testid="abertura"
      data-pronto={pronto ? '1' : '0'}
      className={`${classe} fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-bg text-fg`}
      style={{
        transition: `opacity ${SAIDA_MS}ms ease`,
        opacity: saindo ? 0 : 1,
        pointerEvents: saindo ? 'none' : 'auto',
        // Camada própria e isolada: nada de fora invalida a pintura dela.
        contain: 'strict',
        isolation: 'isolate',
        willChange: 'opacity',
      }}
    >
      <style>{estilos}</style>
      <svg
        viewBox="-170 -140 340 280"
        className="absolute inset-0"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
      >
        {/* ATO 1 — CONSTRUÇÃO */}
        <g className="ato1">
          <g className="semente">
            <g className="cresce">
              <g transform={`translate(${-c} ${-c}) scale(${GRANDE})`}>
                <Simbolo largura={2.4} className="fantasma" />
              </g>
            </g>
          </g>
          <g className="guias">
            <g transform={`translate(${-c} ${-c}) scale(${GRANDE})`}>
              <g style={{ stroke: 'currentColor' }} strokeWidth={0.14} opacity={0.45}>
                {[
                  [-2, 12, 26, 12],
                  [12, -2, 12, 26],
                  [1.5, 1.5, 22.5, 22.5],
                  [1.5, 22.5, 22.5, 1.5],
                ].map(([x1, y1, x2, y2], i) => (
                  <line
                    key={i}
                    className="tracar"
                    style={em(0.9 + i * 0.12)}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    pathLength={1}
                  />
                ))}
                {RAIOS.map((r, i) => (
                  <circle
                    key={r}
                    className="tracar"
                    style={em(1.25 + i * 0.15)}
                    cx="12"
                    cy="12"
                    r={r}
                    pathLength={1}
                  />
                ))}
              </g>
              <g style={{ stroke: 'currentColor' }} strokeWidth={1} opacity={0.7}>
                {ALCAS.map(([ax, ay, cx, cy], i) => (
                  <g key={i} className="pop" style={em(2.05 + i * 0.07)}>
                    <line x1={ax} y1={ay} x2={cx} y2={cy} vectorEffect="non-scaling-stroke" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={0.45}
                      style={{ fill: FUNDO }}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
              {ANCORAS.map(([x, y], i) => (
                <rect
                  key={i}
                  className="pop"
                  style={{ ...em(1.85 + i * 0.05), fill: FUNDO, stroke: 'currentColor' }}
                  x={x - 0.4}
                  y={y - 0.4}
                  width={0.8}
                  height={0.8}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            {/* o cursor da ferramenta passeando pelas âncoras */}
            <g className="cursor">
              <path
                d="M0 0 L0 17 L4.5 13 L7.5 20 L10 19 L7 12 L13 12 Z"
                style={{ fill: 'currentColor', stroke: FUNDO }}
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
            </g>
          </g>
          <g transform={`translate(${-c} ${-c}) scale(${GRANDE})`}>
            <g className="arcos-tracados">
              <Simbolo largura={1.8} comprimento />
            </g>
          </g>
        </g>

        {/* ATO 3 — CONTORNO, FAÍSCA E O NOME ESCRITO */}
        <g className="ato3">
          <Logo larguraNome={larguraNome} contorno textoRef={textoRef} />
          {/* O nome aparece da esquerda para a direita: uma cortina da cor do
              fundo sai de cima dele (clipPath animado não roda no Chrome — a
              animação de peça dentro de <defs> não anda). */}
          <rect
            className="cortina"
            x={xNome - 6}
            y={-CORPO}
            width={larguraNome + 12}
            height={CORPO * 2}
            style={{ fill: FUNDO, '--ate': `${larguraNome + 12}px` } as CSSProperties}
          />
          {/* a ponta da caneta que vai escrevendo o nome */}
          <circle
            className="caneta"
            r={3}
            cy={-CORPO * 0.12}
            style={
              {
                fill: 'currentColor',
                '--de': `${xNome - 6}px`,
                '--ate': `${xNome + larguraNome + 6}px`,
              } as CSSProperties
            }
          />
        </g>

        {/* ATO 5 — O LOGO FINAL */}
        <g className="final">
          {/* com o ".online" o logo fica largo: 72% cabe no celular em pé */}
          <g transform="scale(0.72)">
            <Logo larguraNome={larguraOnline} textoRef={finalRef} online />
          </g>
        </g>
      </svg>

      {/* ATO 2 — NEGATIVO: a tela em tinta, o símbolo vazado. */}
      <div
        aria-hidden
        className="negativo absolute inset-0 grid place-items-center"
        style={{ background: 'currentColor' }}
      >
        <div className="pop-html">
          <SimboloSolto cor={FUNDO} tamanho="34vmin" />
        </div>
      </div>

      {/* ATO 4a — O NOME GIGANTE PASSANDO, EM NEGATIVO */}
      <div
        aria-hidden
        className="letreiro absolute inset-0 flex items-center"
        style={{ background: 'var(--color-fg)', color: FUNDO }}
      >
        <div
          className="passa flex items-center whitespace-nowrap font-bold"
          style={{
            fontSize: '36vmin',
            letterSpacing: '-0.05em',
            gap: '0.12em',
            paddingLeft: '20vw',
          }}
        >
          <SimboloSolto cor={FUNDO} tamanho="0.8em" />
          radinho
        </div>
      </div>

      {/* ATO 4b — O CARTÃO DE VIDRO */}
      <div aria-hidden className="vitrine absolute inset-0 grid place-items-center">
        <div
          className="cartao relative grid place-items-center overflow-hidden"
          style={{
            width: 'min(56vmin, 320px)',
            aspectRatio: '1',
            borderRadius: '22%',
            background: 'color-mix(in srgb, currentColor 7%, transparent)',
            border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
          }}
        >
          <div className="grid place-items-center gap-3">
            <SimboloSolto cor="currentColor" tamanho="min(24vmin, 136px)" />
            <span className="text-lg font-bold tracking-tight">radinho</span>
          </div>
          <div
            className="reflexo absolute inset-y-0 left-0"
            style={{
              width: '40%',
              background:
                'linear-gradient(90deg, transparent, color-mix(in srgb, currentColor 20%, transparent), transparent)',
            }}
          />
        </div>
      </div>

      {!saindo && !pulada && (
        <button
          type="button"
          onClick={pular}
          data-testid="abertura-pular"
          className="absolute right-5 z-10 rounded-full px-4 py-2 text-sm font-medium text-fg"
          style={{
            bottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))',
            border: '1px solid currentColor',
            // Fundo próprio: no negativo (tela em tinta) o botão continua legível.
            background: FUNDO,
            opacity: 0.8,
          }}
        >
          Pular
        </button>
      )}
    </div>,
    document.body,
  );
}

/**
 * Os tempos da cena, em segundos DE CENA (9,5 s no total; o tempo real é
 * o de cena dividido por `RITMO`, via `s()`):
 *   0,0–0,5  o símbolo nasce pequeno      0,5–1,1  cresce até o tamanho grande
 *   0,9–1,8  eixos e círculos guia         1,1      o símbolo vira fantasma
 *   1,8–2,4  âncoras e alças; o cursor passeia (1,6–3,0)
 *   2,2–3,0  os arcos são traçados         3,0–3,3  as guias somem
 *   3,4–4,0  NEGATIVO (corte seco)
 *   4,0–4,8  o símbolo em contorno se traça; 4,3–5,4 a faísca corre pelos arcos
 *   4,8–6,0  o nome é escrito (cortina + caneta)
 *   6,0–6,6  tudo se preenche              7,0–7,7  o nome gigante passa
 *   7,7–8,6  o cartão de vidro e o reflexo 8,6–9,5  o logo final pousa e fica
 */
const estilos = `
.abertura .semente { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: ab-pop ${s(0.45)} cubic-bezier(.2,.9,.3,1.3) ${s(0.05)} forwards }
.abertura .cresce { transform-box: fill-box; transform-origin: 50% 50%; transform: scale(.25); animation: ab-crescer ${s(0.6)} cubic-bezier(.6,0,.2,1) ${s(0.5)} forwards }
.abertura .fantasma { animation: ab-fantasma ${s(0.5)} ease ${s(1.1)} forwards }
.abertura .tracar { stroke-dasharray: 1.02; stroke-dashoffset: 1.02; opacity: 0; animation: ab-tracar ${s(0.5)} cubic-bezier(.5,0,.2,1) forwards }
.abertura .pop { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: ab-pop ${s(0.3)} cubic-bezier(.2,.9,.3,1.4) forwards }
.abertura .arcos-tracados > g > * { stroke-dasharray: 1.02; stroke-dashoffset: 1.02; opacity: 0; animation: ab-tracar ${s(0.5)} cubic-bezier(.5,0,.2,1) forwards }
.abertura .arcos-tracados circle { animation-delay: ${s(2.2)} }
.abertura .arcos-tracados path:nth-of-type(1) { animation-delay: ${s(2.35)} }
.abertura .arcos-tracados path:nth-of-type(2) { animation-delay: ${s(2.45)} }
.abertura .arcos-tracados path:nth-of-type(3) { animation-delay: ${s(2.55)} }
.abertura .arcos-tracados path:nth-of-type(4) { animation-delay: ${s(2.65)} }
.abertura .cursor { opacity: 0; animation: ab-cursor ${s(1.4)} cubic-bezier(.45,0,.3,1) ${s(1.6)} forwards }
.abertura .guias { animation: ab-sumir-de-vez ${s(0.3)} ease ${s(3.0)} forwards }
.abertura .ato1 { animation: ab-sumir-de-vez ${s(0.02)} linear ${s(3.4)} forwards }

.abertura .negativo { opacity: 0; visibility: hidden; animation: ab-entrar ${s(0.01)} linear ${s(3.4)} forwards, ab-sumir-de-vez ${s(0.02)} linear ${s(3.98)} forwards }
.abertura .pop-html { opacity: 0; animation: ab-pop ${s(0.4)} cubic-bezier(.2,.9,.3,1.3) ${s(3.4)} forwards }

.abertura .ato3 { opacity: 0; visibility: hidden; animation: ab-entrar ${s(0.01)} linear ${s(3.95)} forwards, ab-sumir-de-vez ${s(0.02)} linear ${s(7.0)} forwards }
.abertura .tubo-tinta > *, .abertura .tubo-miolo > * { stroke-dasharray: 1.02; stroke-dashoffset: 1.02; opacity: 0; animation: ab-tracar ${s(0.8)} cubic-bezier(.5,0,.2,1) ${s(4.0)} forwards }
.abertura .tubo-miolo { animation: ab-sumir-de-vez ${s(0.5)} ease ${s(6.0)} forwards }
.abertura .faisca > *, .abertura .faisca-halo > * { stroke-dasharray: .09 2; stroke-dashoffset: .09; opacity: 0; animation: ab-faisca ${s(1.1)} cubic-bezier(.4,0,.6,1) ${s(4.3)} forwards }
.abertura .faisca-halo { opacity: .25 }
.abertura .nome-contorno { fill-opacity: 0; stroke-width: 1; stroke-dasharray: 70; stroke-dashoffset: 70; animation: ab-tracar ${s(1.2)} ease-out ${s(4.8)} forwards, ab-preencher ${s(0.5)} ease ${s(6.0)} forwards }
.abertura .cortina { animation: ab-abrir-cortina ${s(1.3)} cubic-bezier(.45,0,.4,1) ${s(4.6)} forwards }
.abertura .caneta { opacity: 0; transform: translate(var(--de), 0); animation: ab-caneta ${s(1.3)} cubic-bezier(.45,0,.4,1) ${s(4.6)} forwards }

.abertura .letreiro { opacity: 0; visibility: hidden; animation: ab-entrar ${s(0.01)} linear ${s(7.0)} forwards, ab-sumir-de-vez ${s(0.02)} linear ${s(7.7)} forwards }
.abertura .passa { transform: translateX(0); animation: ab-passar ${s(0.75)} linear ${s(7.0)} forwards }

.abertura .vitrine { opacity: 0; visibility: hidden; animation: ab-entrar ${s(0.01)} linear ${s(7.7)} forwards, ab-sumir-de-vez ${s(0.25)} ease ${s(8.45)} forwards }
.abertura .cartao { opacity: 0; animation: ab-cartao ${s(0.55)} cubic-bezier(.2,.8,.2,1) ${s(7.7)} forwards }
.abertura .reflexo { transform: translateX(-120%) skewX(-20deg); animation: ab-reflexo ${s(0.55)} ease-in-out ${s(7.95)} forwards }

.abertura .final { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: ab-pousar ${s(0.6)} cubic-bezier(.2,.8,.2,1) ${s(8.6)} forwards }

@keyframes ab-pop { from { opacity: 0; transform: scale(0.6) } to { opacity: 1; transform: none } }
@keyframes ab-crescer { to { transform: scale(1) } }
@keyframes ab-fantasma { to { opacity: 0.14 } }
@keyframes ab-tracar { from { opacity: 1 } to { opacity: 1; stroke-dashoffset: 0 } }
@keyframes ab-entrar { to { opacity: 1; visibility: visible } }
/* Sumiu: fora da pintura (visibility), não só transparente — o celular fraco agradece. */
@keyframes ab-sumir-de-vez { 99% { visibility: visible } to { opacity: 0; visibility: hidden } }
@keyframes ab-cursor {
  0% { opacity: 0; transform: translate(150px, 110px) }
  12% { opacity: 1 }
  35% { transform: translate(-56.8px, -56.8px) }
  65% { transform: translate(-56.8px, 56.8px) }
  90% { opacity: 1; transform: translate(56.8px, -56.8px) }
  100% { opacity: 0; transform: translate(70px, -40px) }
}
@keyframes ab-faisca { 0% { opacity: 1 } 90% { opacity: 1 } to { opacity: 0; stroke-dashoffset: -1 } }
@keyframes ab-preencher { to { fill-opacity: 1; stroke-opacity: 0 } }
@keyframes ab-abrir-cortina { 99% { visibility: visible } to { transform: translateX(var(--ate)); visibility: hidden } }
@keyframes ab-caneta {
  0% { opacity: 0; transform: translate(var(--de), 0) }
  10% { opacity: 1 }
  90% { opacity: 1 }
  100% { opacity: 0; transform: translate(var(--ate), 0) }
}
@keyframes ab-passar { to { transform: translateX(-120%) } }
@keyframes ab-cartao {
  from { opacity: 0; transform: perspective(800px) rotateX(28deg) rotateY(-22deg) translateY(10%) scale(0.9) }
  to { opacity: 1; transform: perspective(800px) }
}
@keyframes ab-reflexo { to { transform: translateX(320%) skewX(-20deg) } }
@keyframes ab-pousar { from { opacity: 0; transform: scale(0.94) } to { opacity: 1; transform: none } }

/* O app por baixo não pinta enquanto a abertura cobre a tela (ver o efeito). */
html[data-abrindo] #root { visibility: hidden }

/* Reduzir movimento: só o logo final, parado. */
.abertura--parada * { animation: none !important }
.abertura--parada .ato1, .abertura--parada .ato3, .abertura--parada .negativo,
.abertura--parada .letreiro, .abertura--parada .vitrine { visibility: hidden }
.abertura--parada .final { opacity: 1; transform: none }
`;
