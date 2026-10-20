/**
 * A ABERTURA — o rádio antigo que manda o sinal para o celular da pessoa.
 *
 * Pedido do dono (20/10/2026): uma animação de abertura OBRIGATÓRIA — ela é
 * a tela de carregamento: enquanto corre, o app sobe por baixo (sessão,
 * fontes, biblioteca). Só sai quando as duas coisas acontecem: a cena
 * terminou E o app está pronto. App pronto antes, a cena vai até o fim; app
 * atrasado, a tela do celular fica pulsando até ele chegar (com um teto,
 * para nunca prender ninguém numa tela preta).
 *
 * DIREÇÃO DE ARTE: ilustração vetorial chapada, como as do Nubank — formas
 * preenchidas com paleta própria (sem contorno), montadas peça a peça com um
 * leve "pop". Nada de desenho de linha.
 *
 * A cena (SVG, 1000×560), em cinco atos — ver os tempos em `estilos`:
 *   1. o RÁDIO de mesa dos anos 50 se monta peça a peça: caixa de baquelite
 *      com brilho, grade cromada com lâminas, vidro do dial com escala e
 *      ponteiro, botões, placa, pés — e a antena telescópica SE ESTENDE gomo
 *      a gomo, por último;
 *   2. a PESSOA se monta: pernas, tronco, braços, cabeça, cabelo com coque, o
 *      celular na mão (com dedos), tudo em formas arredondadas e sem rosto;
 *   3. ONDAS saem da ponta da antena e um PONTO DE SINAL viaja até o celular;
 *      a câmera dá ZOOM no sinal e o acompanha — o rádio SOME nesse zoom;
 *   4. a câmera ABRE sobre a pessoa: a tela do celular acende e NOTAS sobem;
 *   5. ZOOM na tela do celular: o nosso logo aparece nela, a câmera mergulha
 *      no logo, e o app abre por baixo com fade.
 *
 * "Reduzir movimento" ligado: a cena vira um quadro parado e sai assim que o
 * app está pronto.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSemMovimento } from '@/hooks/useSemMovimento';

/** Duração da cena inteira (ms) — o mínimo que a abertura fica na tela. */
export const DURACAO_DA_CENA_MS = 9_500;
/** Teto de espera pelo app (ms): depois disto a abertura sai de qualquer jeito. */
const TETO_DE_ESPERA_MS = 20_000;
/** Saída: o tempo do fade (ms). */
const SAIDA_MS = 700;

/**
 * A PALETA DA ILUSTRAÇÃO — só preto, branco e cinzas (pedido do dono), e
 * SEGUE O TEMA: no escuro a cena é clara sobre o preto; no claro é tinta
 * escura sobre o branco, com a tela do celular acesa em branco.
 */
const COR_ESCURO = {
  madeira: '#3A3A3A',
  madeiraClara: '#4B4B4B',
  madeiraEscura: '#232323',
  cromo: '#D6D6D6',
  cromoClaro: '#F4F4F4',
  cromoEscuro: '#8F8F8F',
  vidro: '#E8E8E8',
  vidroEscuro: '#C4C4C4',
  ponteiro: '#FFFFFF',
  pele: '#D9D9D9',
  peleSombra: '#B8B8B8',
  cabelo: '#161616',
  camisa: '#F2F2F2',
  camisaSombra: 'rgba(0,0,0,0.16)',
  calca: '#4A4A4A',
  sapato: '#1A1A1A',
  celular: '#121212',
  celularBorda: '#3C3C3C',
  tela: '#070707',
  telaAcesaTopo: '#2A2A2A',
  telaAcesaBase: '#0E0E0E',
  logo: '#FFFFFF',
  brilho: '#FFFFFF',
  frente: '#FFFFFF',
  fundoDoRadio: '#000000',
  sinal: '#FFFFFF',
};
type Paleta = typeof COR_ESCURO;

const COR_CLARO: Paleta = {
  madeira: '#9A9A9A',
  madeiraClara: '#ABABAB',
  madeiraEscura: '#6F6F6F',
  cromo: '#5C5C5C',
  cromoClaro: '#8A8A8A',
  cromoEscuro: '#2E2E2E',
  vidro: '#F7F7F7',
  vidroEscuro: '#DADADA',
  ponteiro: '#111111',
  pele: '#BDBDBD',
  peleSombra: '#9E9E9E',
  cabelo: '#161616',
  camisa: '#2B2B2B',
  camisaSombra: 'rgba(255,255,255,0.12)',
  calca: '#5E5E5E',
  sapato: '#1A1A1A',
  celular: '#1C1C1C',
  celularBorda: '#4A4A4A',
  tela: '#FAFAFA',
  telaAcesaTopo: '#FFFFFF',
  telaAcesaBase: '#E6E6E6',
  logo: '#111111',
  brilho: '#FFFFFF',
  frente: '#FFFFFF',
  fundoDoRadio: '#2A2A2A',
  sinal: '#111111',
};

/** As peças (lâminas, escala, notas) leem a paleta do tema daqui. */
const PaletaCtx = createContext<Paleta>(COR_ESCURO);

/** O tema que o app está mostrando (a classe `dark` no <html>), ao vivo. */
function useTemaEscuro(): boolean {
  const ler = (): boolean =>
    typeof document === 'undefined' || document.documentElement.classList.contains('dark');
  const [escuro, setEscuro] = useState(ler);
  useEffect(() => {
    setEscuro(ler());
    const obs = new MutationObserver(() => setEscuro(ler()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return escuro;
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

/** Lâminas horizontais da grade cromada. */
function Laminas({
  x,
  y,
  w,
  n,
  passo,
}: {
  x: number;
  y: number;
  w: number;
  n: number;
  passo: number;
}) {
  const COR = useContext(PaletaCtx);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          className={`peca r3 lamina`}
          style={{ animationDelay: `${0.9 + i * 0.06}s` }}
          x={x}
          y={y + i * passo}
          width={w}
          height={5}
          rx={2.5}
          fill={COR.cromo}
        />
      ))}
    </>
  );
}

/** A escala do dial: traços e números sobre o vidro. */
function Escala({ x, y, w }: { x: number; y: number; w: number }) {
  const COR = useContext(PaletaCtx);
  const n = 21;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const px = x + (i / (n - 1)) * w;
        const grande = i % 5 === 0;
        return (
          <rect
            key={i}
            x={px - 0.6}
            y={y}
            width={1.2}
            height={grande ? 10 : 5}
            fill={COR.madeiraEscura}
            opacity={0.8}
          />
        );
      })}
      {['88', '92', '96', '100', '104'].map((t, i) => (
        <text
          key={t}
          x={x + (i / 4) * w}
          y={y + 21}
          fontSize="7"
          fontWeight="700"
          textAnchor="middle"
          fill={COR.madeiraEscura}
          opacity={0.85}
        >
          {t}
        </text>
      ))}
    </>
  );
}

/** Uma nota musical chapada — sobe da tela do celular. */
function Nota({ classe, dupla }: { classe: string; dupla: boolean }) {
  const COR = useContext(PaletaCtx);
  return (
    <g className={`nota ${classe}`} fill={COR.sinal}>
      {dupla ? (
        <>
          <path d="M3 0 h4 v-24 l18 -5 v24 h-4 v-18 l-10 3 v15 z" />
          <ellipse cx="2" cy="1" rx="6" ry="4.5" />
          <ellipse cx="20" cy="-4" rx="6" ry="4.5" />
        </>
      ) : (
        <>
          <path d="M3 0 h4 v-22 q12 4 10 14 q-2 -6 -10 -8 v16 z" />
          <ellipse cx="2" cy="1" rx="6" ry="4.5" />
        </>
      )}
    </g>
  );
}

export function AberturaAnimada() {
  const COR = useTemaEscuro() ? COR_ESCURO : COR_CLARO;
  const pronto = useAppPronto();
  const semMovimento = useSemMovimento();
  // CELULAR EM PÉ: a cena é larga (rádio à esquerda, pessoa à direita); com
  // `slice` as duas pontas ficariam fora da tela. Em retrato a janela é só a
  // faixa que importa (x 100–880) e cabe inteira (`meet`); a câmera usa as
  // mesmas coordenadas, então o zoom continua caindo no lugar certo.
  const retrato = useMediaQuery('(orientation: portrait)');
  const [cenaAcabou, setCenaAcabou] = useState(false);
  const [teto, setTeto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [fechada, setFechada] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setCenaAcabou(true), semMovimento ? 0 : DURACAO_DA_CENA_MS);
    const b = setTimeout(() => setTeto(true), TETO_DE_ESPERA_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [semMovimento]);

  const podeSair = cenaAcabou && (pronto || teto);
  useEffect(() => {
    if (!podeSair || saindo) return;
    setSaindo(true);
    const t = setTimeout(() => setFechada(true), SAIDA_MS);
    return () => clearTimeout(t);
  }, [podeSair, saindo]);

  if (fechada) return null;

  const classe = [
    'abertura',
    semMovimento ? 'abertura--parada' : '',
    cenaAcabou && !pronto ? 'abertura--esperando' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!podeSair}
      aria-label="Abrindo o radinho"
      data-testid="abertura"
      data-pronto={pronto ? '1' : '0'}
      className="fixed inset-0 z-[200] grid place-items-center bg-bg text-fg"
      style={{
        transition: `opacity ${SAIDA_MS}ms ease`,
        opacity: saindo ? 0 : 1,
        pointerEvents: saindo ? 'none' : 'auto',
      }}
    >
      <style>{estilos}</style>
      <PaletaCtx.Provider value={COR}>
        <svg
          viewBox={retrato ? '100 0 780 560' : '0 0 1000 560'}
          className={classe}
          width="100%"
          height="100%"
          preserveAspectRatio={retrato ? 'xMidYMid meet' : 'xMidYMid slice'}
          fill="none"
        >
          <defs>
            <linearGradient id="ab-caixa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COR.madeiraClara} />
              <stop offset="1" stopColor={COR.madeira} />
            </linearGradient>
            <linearGradient id="ab-cromo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={COR.cromoClaro} />
              <stop offset="0.5" stopColor={COR.cromo} />
              <stop offset="1" stopColor={COR.cromoEscuro} />
            </linearGradient>
            <linearGradient id="ab-vidro" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COR.vidro} />
              <stop offset="1" stopColor={COR.vidroEscuro} />
            </linearGradient>
            <radialGradient id="ab-brilho" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor={COR.brilho} stopOpacity="0.45" />
              <stop offset="1" stopColor={COR.brilho} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="ab-tela-acesa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COR.telaAcesaTopo} />
              <stop offset="1" stopColor={COR.telaAcesaBase} />
            </linearGradient>
            <clipPath id="ab-dial-clip">
              <rect x="344" y="296" width="96" height="46" rx="8" />
            </clipPath>
          </defs>

          <g className="cena">
            {/* chão e sombras */}
            <rect
              className="peca r0"
              x="0"
              y="470"
              width="1000"
              height="90"
              fill="currentColor"
              fillOpacity="0.05"
            />
            <ellipse
              className="peca r0"
              cx="290"
              cy="472"
              rx="190"
              ry="8"
              fill="currentColor"
              fillOpacity="0.14"
            />
            <ellipse
              className="peca p0"
              cx="776"
              cy="472"
              rx="90"
              ry="7"
              fill="currentColor"
              fillOpacity="0.14"
            />

            {/* ── 1. O RÁDIO DE MESA (anos 50) ─────────────────────────── */}
            <g className="radio">
              {/* pés */}
              <rect
                className="peca r1"
                x="150"
                y="456"
                width="36"
                height="14"
                rx="6"
                fill={COR.madeiraEscura}
              />
              <rect
                className="peca r1"
                x="394"
                y="456"
                width="36"
                height="14"
                rx="6"
                fill={COR.madeiraEscura}
              />
              {/* caixa de baquelite com brilho no topo */}
              <rect
                className="peca r1"
                x="120"
                y="250"
                width="340"
                height="212"
                rx="30"
                fill="url(#ab-caixa)"
              />
              <rect
                className="peca r2"
                x="134"
                y="258"
                width="312"
                height="18"
                rx="9"
                fill={COR.frente}
                fillOpacity="0.12"
              />
              <rect
                className="peca r2"
                x="120"
                y="420"
                width="340"
                height="42"
                rx="18"
                fill={COR.fundoDoRadio}
                fillOpacity="0.16"
              />
              {/* grade cromada com lâminas */}
              <rect
                className="peca r2"
                x="140"
                y="286"
                width="190"
                height="124"
                rx="14"
                fill={COR.madeiraEscura}
              />
              <rect
                className="peca r2"
                x="146"
                y="292"
                width="178"
                height="112"
                rx="11"
                fill="url(#ab-cromo)"
                fillOpacity="0.35"
              />
              <Laminas x={154} y={300} w={162} n={10} passo={10.5} />
              {/* vidro do dial com escala e ponteiro */}
              <rect
                className="peca r3"
                x="344"
                y="296"
                width="96"
                height="46"
                rx="8"
                fill={COR.madeiraEscura}
              />
              <rect
                className="peca r3"
                x="348"
                y="300"
                width="88"
                height="38"
                rx="6"
                fill="url(#ab-vidro)"
              />
              <g className="peca r4">
                <Escala x={356} y={304} w={72} />
                <g clipPath="url(#ab-dial-clip)">
                  <rect
                    className="ponteiro"
                    x="391"
                    y="298"
                    width="2.4"
                    height="42"
                    fill={COR.ponteiro}
                  />
                </g>
                <rect
                  x="348"
                  y="300"
                  width="88"
                  height="12"
                  rx="6"
                  fill={COR.frente}
                  fillOpacity="0.18"
                />
              </g>
              {/* botões */}
              <g className="peca r5">
                <circle cx="372" cy="384" r="19" fill={COR.madeiraEscura} />
                <circle cx="372" cy="384" r="15" fill="url(#ab-cromo)" />
                <circle cx="372" cy="384" r="8" fill={COR.cromoEscuro} />
                <rect x="371" y="368" width="2.4" height="8" rx="1.2" fill={COR.madeiraEscura} />
              </g>
              <g className="peca r5" style={{ animationDelay: '1.95s' }}>
                <circle cx="418" cy="384" r="19" fill={COR.madeiraEscura} />
                <circle cx="418" cy="384" r="15" fill="url(#ab-cromo)" />
                <circle cx="418" cy="384" r="8" fill={COR.cromoEscuro} />
                <rect x="417" y="368" width="2.4" height="8" rx="1.2" fill={COR.madeiraEscura} />
              </g>
              {/* placa com o nome */}
              <g className="peca r6">
                <rect x="356" y="350" width="72" height="14" rx="4" fill={COR.cromo} />
                <text
                  x="392"
                  y="360.5"
                  fontSize="8"
                  fontWeight="800"
                  letterSpacing="2.2"
                  textAnchor="middle"
                  fill={COR.madeiraEscura}
                >
                  RADINHO
                </text>
              </g>
              {/* antena telescópica: três gomos que SE ESTENDEM, base no canto da caixa */}
              <g className="antena" transform="translate(432 266) rotate(-122)">
                <rect
                  className="gomo g1"
                  x="-4"
                  y="-2"
                  width="8"
                  height="58"
                  rx="4"
                  fill={COR.cromoEscuro}
                />
                <rect
                  className="gomo g2"
                  x="-3"
                  y="50"
                  width="6"
                  height="56"
                  rx="3"
                  fill={COR.cromo}
                />
                <rect
                  className="gomo g3"
                  x="-2"
                  y="100"
                  width="4"
                  height="50"
                  rx="2"
                  fill={COR.cromoClaro}
                />
                <circle className="gomo g3" cx="0" cy="152" r="5" fill={COR.cromo} />
              </g>
            </g>

            {/* ── 2. A PESSOA (ilustração chapada, estilo Nubank) ─────────── */}
            <g className="pessoa">
              {/* sapatos e pernas */}
              <ellipse className="peca p1" cx="748" cy="466" rx="24" ry="8" fill={COR.sapato} />
              <ellipse className="peca p1" cx="806" cy="466" rx="24" ry="8" fill={COR.sapato} />
              <path className="peca p1" d="M734 340 h40 v120 h-40 z" fill={COR.calca} />
              <path className="peca p1" d="M782 340 h40 v120 h-40 z" fill={COR.calca} />
              <rect
                className="peca p1"
                x="734"
                y="330"
                width="88"
                height="34"
                rx="10"
                fill={COR.calca}
              />
              {/* tronco (camisa) */}
              <path
                className="peca p2"
                d="M722 350 V250 Q722 200 778 200 Q834 200 834 250 V350 Q778 362 722 350 Z"
                fill={COR.camisa}
              />
              <path
                className="peca p2"
                d="M722 350 V300 Q778 318 834 300 V350 Q778 362 722 350 Z"
                fill={COR.camisaSombra}
              />
              {/* pescoço */}
              <rect
                className="peca p3"
                x="764"
                y="178"
                width="28"
                height="36"
                rx="12"
                fill={COR.peleSombra}
              />
              {/* braço direito (da pessoa): ombro → cotovelo → mão com o celular */}
              <path
                className="peca p3"
                d="M730 226 Q690 250 700 306"
                stroke={COR.camisa}
                strokeWidth="26"
                strokeLinecap="round"
              />
              <path
                className="peca p3"
                d="M700 306 Q708 338 740 318"
                stroke={COR.pele}
                strokeWidth="22"
                strokeLinecap="round"
              />
              {/* braço esquerdo relaxado */}
              <path
                className="peca p3"
                d="M826 226 Q860 262 850 316"
                stroke={COR.camisa}
                strokeWidth="26"
                strokeLinecap="round"
              />
              <path
                className="peca p3"
                d="M850 316 Q846 352 840 372"
                stroke={COR.pele}
                strokeWidth="22"
                strokeLinecap="round"
              />
              <ellipse className="peca p3" cx="839" cy="380" rx="12" ry="14" fill={COR.pele} />
              {/* cabeça, orelha, cabelo com coque e franja */}
              <circle className="peca p4" cx="778" cy="138" r="46" fill={COR.pele} />
              <circle className="peca p4" cx="823" cy="142" r="8" fill={COR.peleSombra} />
              <path
                className="peca p5"
                d="M730 136 Q730 84 778 84 Q826 84 826 136 Q812 112 778 112 Q744 112 730 136 Z"
                fill={COR.cabelo}
              />
              <path
                className="peca p5"
                d="M730 136 q-6 20 6 36 q-2 -22 8 -40 z"
                fill={COR.cabelo}
              />
              <circle className="peca p5" cx="810" cy="82" r="20" fill={COR.cabelo} />

              {/* ── O CELULAR na mão (detalhado) ── */}
              <g className="celular" transform="translate(726 262) rotate(-10)">
                <rect
                  className="peca p6"
                  x="0"
                  y="0"
                  width="60"
                  height="118"
                  rx="12"
                  fill={COR.celularBorda}
                />
                <rect
                  className="peca p6"
                  x="3"
                  y="3"
                  width="54"
                  height="112"
                  rx="10"
                  fill={COR.celular}
                />
                <rect
                  className="peca p6"
                  x="-2"
                  y="30"
                  width="3"
                  height="10"
                  rx="1.5"
                  fill={COR.celularBorda}
                />
                <rect
                  className="peca p6"
                  x="-2"
                  y="46"
                  width="3"
                  height="14"
                  rx="1.5"
                  fill={COR.celularBorda}
                />
                <rect
                  className="peca p6"
                  x="59"
                  y="36"
                  width="3"
                  height="20"
                  rx="1.5"
                  fill={COR.celularBorda}
                />
                <rect
                  className="peca p6"
                  x="7"
                  y="10"
                  width="46"
                  height="98"
                  rx="7"
                  fill={COR.tela}
                />
                <rect
                  className="tela"
                  x="7"
                  y="10"
                  width="46"
                  height="98"
                  rx="7"
                  fill="url(#ab-tela-acesa)"
                />
                <rect
                  className="peca p6"
                  x="21"
                  y="13"
                  width="18"
                  height="4"
                  rx="2"
                  fill={COR.celularBorda}
                />
                <circle className="peca p6" cx="43" cy="15" r="1.6" fill={COR.celularBorda} />
                <rect
                  className="peca p6"
                  x="22"
                  y="103"
                  width="16"
                  height="2"
                  rx="1"
                  fill={COR.celularBorda}
                />
                {/* dedos sobre a lateral do celular */}
                <rect
                  className="peca p6"
                  x="-8"
                  y="52"
                  width="16"
                  height="9"
                  rx="4.5"
                  fill={COR.pele}
                />
                <rect
                  className="peca p6"
                  x="-8"
                  y="64"
                  width="16"
                  height="9"
                  rx="4.5"
                  fill={COR.pele}
                />
                <rect
                  className="peca p6"
                  x="-8"
                  y="76"
                  width="16"
                  height="9"
                  rx="4.5"
                  fill={COR.pele}
                />
                <circle className="brilho" cx="30" cy="59" r="74" fill="url(#ab-brilho)" />
                {/* o nosso logo, na tela */}
                {/* a posição fica num grupo próprio: o CSS do `.logo` anima `transform`,
                  e isso substituiria um `transform` escrito no mesmo elemento. */}
                <g transform="translate(30 59)">
                  <g className="logo">
                    <g
                      transform="translate(-14 -24) scale(1.1667)"
                      stroke={COR.logo}
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                      <circle cx="12" cy="12" r="2" />
                      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                    </g>
                    <text
                      x="0"
                      y="22"
                      textAnchor="middle"
                      fontSize="7.5"
                      fontWeight="700"
                      fill={COR.logo}
                      letterSpacing="0.3"
                    >
                      radinho
                    </text>
                  </g>
                </g>
                <g className="notas">
                  <Nota classe="n1" dupla />
                  <Nota classe="n2" dupla={false} />
                  <Nota classe="n3" dupla />
                  <Nota classe="n4" dupla={false} />
                </g>
              </g>
            </g>

            {/* ── 3. O SINAL (sem arcos na antena: pedido do Vinicius, 20/10) ── */}
            <path
              id="trilha"
              className="trilha"
              pathLength={1}
              d="M561 185 C 640 40, 700 80, 722 180 S 742 262, 752 272"
              stroke={COR.sinal}
              strokeWidth="2.5"
              strokeDasharray="1"
              strokeLinecap="round"
            />
            <g className="sinal" fill={COR.sinal}>
              <circle r="18" className="halo">
                <animateMotion
                  dur="2s"
                  begin="3.9s"
                  fill="freeze"
                  calcMode="spline"
                  keySplines="0.4 0 0.6 1"
                  keyTimes="0;1"
                >
                  <mpath href="#trilha" />
                </animateMotion>
              </circle>
              <circle r="7">
                <animateMotion
                  dur="2s"
                  begin="3.9s"
                  fill="freeze"
                  calcMode="spline"
                  keySplines="0.4 0 0.6 1"
                  keyTimes="0;1"
                >
                  <mpath href="#trilha" />
                </animateMotion>
              </circle>
            </g>
          </g>
        </svg>
      </PaletaCtx.Provider>
    </div>
  );
}

/**
 * Os tempos da cena, em segundos (9,5 s no total):
 *   0,0–2,6  o rádio se monta (pés, caixa, grade, lâminas, dial, botões, placa)
 *   2,6–3,4  a antena se estende, gomo a gomo
 *   2,2–3,6  a pessoa se monta (pernas, tronco, braços, cabeça, cabelo, celular)
 *   3,5–4,1  (sem ondas)               3,9–5,9  sinal viaja; ZOOM no sinal; o rádio some
 *   5,9–6,8  câmera ABRE na pessoa     6,4–7,8  tela acende, notas sobem
 *   7,6–8,5  ZOOM na tela, o logo aparece
 *   8,5–9,5  ZOOM no logo; o app abre por baixo com fade
 *
 * A câmera é o <g class="cena"> com transform; a origem é o centro do
 * viewBox (500, 280): para centrar um ponto P na escala s, o translate é
 * −s·(P − C). Pontos: ponta da antena (538, 98); meio do caminho (660, 60);
 * pessoa (778, 300); centro da tela do celular ≈ (748, 316).
 */
const estilos = `
.abertura .peca { opacity: 0; transform-box: fill-box; transform-origin: 50% 100%; animation: ab-pop 0.55s cubic-bezier(.2,.9,.3,1.3) forwards }
.abertura .r0 { animation-delay: 0.05s } .abertura .r1 { animation-delay: 0.2s }
.abertura .r2 { animation-delay: 0.55s } .abertura .r3 { animation-delay: 0.9s }
.abertura .r4 { animation-delay: 1.45s } .abertura .r5 { animation-delay: 1.8s }
.abertura .r6 { animation-delay: 2.15s }
.abertura .lamina { transform-origin: 0% 50% }
.abertura .gomo { transform-box: fill-box; transform-origin: 50% 0%; transform: scaleY(0); opacity: 0; animation-name: ab-estender, ab-aparecer; animation-duration: 0.45s, 0.05s; animation-fill-mode: forwards, forwards; animation-timing-function: cubic-bezier(.3,.8,.3,1), linear }
.abertura .g1 { animation-delay: 2.5s } .abertura .g2 { animation-delay: 2.8s } .abertura .g3 { animation-delay: 3.1s }
.abertura .p0 { animation-delay: 2.2s } .abertura .p1 { animation-delay: 2.3s } .abertura .p2 { animation-delay: 2.55s }
.abertura .p3 { animation-delay: 2.8s } .abertura .p4 { animation-delay: 3.05s } .abertura .p5 { animation-delay: 3.25s }
.abertura .p6 { animation-delay: 3.45s }
.abertura .ponteiro { transform-box: fill-box; transform-origin: 50% 50%; animation: ab-ponteiro 2.6s ease-in-out 2.2s infinite alternate }
.abertura .radio { animation: ab-sumir 0.9s ease-in 4.5s forwards }
.abertura .trilha { stroke-dashoffset: 1; opacity: 0; animation: ab-tracar 2s cubic-bezier(.4,0,.6,1) 3.9s forwards, ab-meia 0.05s linear 3.9s forwards, ab-sumir 0.6s ease 6.4s forwards }
.abertura .sinal { opacity: 0; animation: ab-aparecer 0.2s linear 3.9s forwards, ab-sumir 0.5s ease 6.1s forwards }
.abertura .halo { opacity: 0.35; animation: ab-halo 0.9s ease-out 3.9s infinite }
.abertura .tela { opacity: 0; animation: ab-acender 0.6s ease-out 6.3s forwards }
.abertura .brilho { opacity: 0; animation: ab-aparecer 0.8s ease-out 6.4s forwards, ab-pulsar 2s ease-in-out 7.2s infinite }
.abertura .nota { opacity: 0; transform: translate(30px, 70px); animation: ab-nota 1.7s ease-out forwards }
.abertura .n1 { animation-delay: 6.6s } .abertura .n2 { animation-delay: 6.9s }
.abertura .n3 { animation-delay: 7.2s } .abertura .n4 { animation-delay: 7.5s }
.abertura .logo { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: ab-logo 0.8s cubic-bezier(.2,.8,.2,1) 7.8s forwards }
.abertura .cena {
  transform-box: view-box; transform-origin: 500px 280px;
  animation: ab-camera 9.5s linear forwards;
}

@keyframes ab-pop { from { opacity: 0; transform: scale(0.7) translateY(14px) } to { opacity: 1; transform: none } }
@keyframes ab-estender { to { transform: scaleY(1) } }
@keyframes ab-tracar { to { stroke-dashoffset: 0 } }
@keyframes ab-aparecer { to { opacity: 1 } }
@keyframes ab-meia { to { opacity: 0.45 } }
@keyframes ab-sumir { to { opacity: 0 } }
@keyframes ab-acender { to { opacity: 1 } }
@keyframes ab-pulsar { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }
@keyframes ab-ponteiro { from { transform: translateX(-34px) } to { transform: translateX(36px) } }
@keyframes ab-halo { from { transform: scale(0.5); opacity: 0.5 } to { transform: scale(1.9); opacity: 0 } }
@keyframes ab-logo { from { opacity: 0; transform: scale(0.4) } to { opacity: 1; transform: scale(1) } }
@keyframes ab-nota {
  0% { opacity: 0; transform: translate(30px, 70px) scale(0.6) }
  20% { opacity: 1 }
  100% { opacity: 0; transform: translate(-14px, -72px) scale(1.1) rotate(-14deg) }
}
/* A câmera, por cento dos 9,5 s. Pontos (P − C), com C = (500, 280):
   ponta da antena (61, -95); meio do caminho (160, −220); pessoa (278, 50);
   centro da tela do celular (266, 35), já com a rotação do celular. */
@keyframes ab-camera {
  0%, 41% { transform: translate(0px, 0px) scale(1) }
  49% { transform: translate(-134px, 209px) scale(2.2) }
  59% { transform: translate(-352px, 484px) scale(2.2) }
  68% { transform: translate(-445px, -80px) scale(1.6) }
  80% { transform: translate(-445px, -80px) scale(1.6) }
  90% { transform: translate(-2126px, -279px) scale(8) }
  100% { transform: translate(-4784px, -628px) scale(18) }
}

/* Esperando o app: o brilho da tela continua, nada mais mexe. */
.abertura--esperando .brilho { animation-duration: 1.2s }

/* Reduzir movimento: a cena pronta, parada. */
.abertura--parada * { animation: none !important }
.abertura--parada .peca, .abertura--parada .sinal, .abertura--parada .tela, .abertura--parada .logo, .abertura--parada .brilho { opacity: 1; transform: none }
.abertura--parada .gomo { transform: scaleY(1) }
.abertura--parada .trilha { stroke-dashoffset: 0 }
.abertura--parada .nota { opacity: 1; transform: translate(10px, -20px) }
.abertura--parada .cena { transform: none }
.abertura--parada .radio { opacity: 1 }
`;
