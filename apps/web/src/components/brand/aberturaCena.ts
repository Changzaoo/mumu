/**
 * A CENA DA ABERTURA — HTML e CSS puros, escritos DENTRO do index.html.
 *
 * Por que aqui e não no React (29/10/2026, Moto G34): a abertura antiga só
 * nascia depois que o bundle inteiro (~1 MB de JS) era baixado e lido, e todas
 * as peças dela eram traços de SVG animados por `stroke-dashoffset` — uma
 * propriedade que só anda na LINHA PRINCIPAL. Justamente a linha principal que,
 * nesses segundos, está montando o app, abrindo a sessão e lendo a biblioteca.
 * No celular fraco a cena inteira travava ("toda lagada, não deu pra ver nada").
 *
 * As duas regras desta versão:
 *  1. A cena está no HTML (o plugin `aberturaNoHtml` do vite.config a injeta):
 *     ela começa no PRIMEIRO quadro, enquanto o JS ainda baixa.
 *  2. Só `transform` e `opacity` em elementos HTML — as duas únicas coisas que
 *     o navegador anima no compositor, sem depender da linha principal. Nada de
 *     traço animado, `visibility`, filtro ou animação dentro do SVG: cada peça é
 *     uma `div` com um SVG parado dentro, e é a `div` que se mexe.
 *
 * O componente `AberturaAnimada` só controla: decide quando ela sai (cena
 * acabou E app pronto), o "Pular", o diário e a remoção.
 *
 * Os cinco atos continuam os do "logo animation concept" (ver AberturaAnimada):
 * construção, negativo, contorno + nome escrito, vitrine e logo final.
 */

/** Duração da cena, em ms reais — o mínimo que a abertura fica na tela. */
export const DURACAO_DA_CENA_MS = 5_000;
/** Chave da sessão: já vista → recarga no meio do uso não repete a cena. */
export const CHAVE_VISTA = 'radinho:abertura-vista';

/** Os arcos do símbolo (ícone 24×24, centro em 12,12) — o `Radio` do lucide. */
const ARCOS_DE_DENTRO = ['M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5', 'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5'];
const ARCOS_DE_FORA = ['M4.9 19.1C1 15.2 1 8.8 4.9 4.9', 'M19.1 4.9C23 8.8 23 15.2 19.1 19.1'];
/** Raios dos círculos de que os arcos são pedaços. */
const RAIOS = [2, 5.94, 10.04];
/** As pontas dos arcos — as âncoras da construção. */
const ANCORAS: Array<[number, number]> = [
  [4.9, 4.9],
  [4.9, 19.1],
  [7.8, 7.7],
  [7.8, 16.2],
  [16.2, 7.8],
  [16.2, 16.3],
  [19.1, 4.9],
  [19.1, 19.1],
];
/** Alças de bézier dos arcos de fora: [âncora, ponto de controle]. */
const ALCAS: Array<[number, number, number, number]> = [
  [4.9, 19.1, 1, 15.2],
  [4.9, 4.9, 1, 8.8],
  [19.1, 4.9, 23, 8.8],
  [19.1, 19.1, 23, 15.2],
];

/** Coordenada do ícone (0..24) → % da caixa do símbolo. */
const pct = (v: number): string => `${((v / 24) * 100).toFixed(2)}%`;

function svg(conteudo: string, cor = 'currentColor', largura = 2.2): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${largura}" stroke-linecap="round" aria-hidden="true">${conteudo}</svg>`;
}
const CENTRO = '<circle cx="12" cy="12" r="2"/>';
const caminhos = (ds: string[]): string => ds.map((d) => `<path d="${d}"/>`).join('');
const SIMBOLO = CENTRO + caminhos(ARCOS_DE_DENTRO) + caminhos(ARCOS_DE_FORA);

/** Atraso de uma peça, em segundos reais. */
const em = (s: number): string => `animation-delay:${s.toFixed(3)}s`;

function construcao(): string {
  const eixos = [0, 90, 45, -45]
    .map(
      (a, i) =>
        `<div class="ab-eixo" style="transform:rotate(${a}deg)"><i style="${em(0.45 + i * 0.08)}"></i></div>`,
    )
    .join('');
  const circulos = RAIOS.map(
    (r, i) =>
      `<div class="ab-guia" style="width:${pct(r * 2)};height:${pct(r * 2)};${em(0.62 + i * 0.1)}"></div>`,
  ).join('');
  const alcas = ALCAS.map(([ax, ay, cx, cy], i) => {
    const dx = cx - ax;
    const dy = cy - ay;
    const comprimento = Math.hypot(dx, dy);
    const angulo = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      `<div class="ab-alca" style="left:${pct(ax)};top:${pct(ay)};width:${pct(comprimento)};transform:rotate(${angulo.toFixed(1)}deg)">` +
      `<i style="${em(1.05 + i * 0.05)}"></i></div>` +
      `<b class="ab-ponto ab-controle" style="left:${pct(cx)};top:${pct(cy)};${em(1.1 + i * 0.05)}"></b>`
    );
  }).join('');
  const ancoras = ANCORAS.map(
    ([x, y], i) =>
      `<b class="ab-ponto" style="left:${pct(x)};top:${pct(y)};${em(0.98 + i * 0.035)}"></b>`,
  ).join('');
  // O símbolo traçado peça por peça, do centro para fora (como uma onda).
  const pecas = [CENTRO, caminhos(ARCOS_DE_DENTRO), caminhos(ARCOS_DE_FORA)]
    .map(
      (p, i) =>
        `<div class="ab-peca" style="${em(1.22 + i * 0.13)}">${svg(p, 'currentColor', 1.9)}</div>`,
    )
    .join('');
  return `
<div class="ab-ato ab-ato1">
  <div class="ab-simbolo">
    <div class="ab-semente"><div class="ab-cresce">${svg(SIMBOLO, 'currentColor', 2.4)}</div></div>
    <div class="ab-guias">${eixos}${circulos}${alcas}${ancoras}</div>
    ${pecas}
    <div class="ab-cursor"><svg viewBox="0 0 14 21" aria-hidden="true"><path d="M1 1 L1 18 L5.5 14 L8.5 21 L11 20 L8 13 L14 13 Z" fill="currentColor" stroke="var(--color-bg,#0a0a0c)" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
  </div>
</div>`;
}

/** O logo deitado: símbolo + nome. `escrito` = o nome aparece sendo escrito. */
function logo(escrito: boolean): string {
  const pecas = [CENTRO, caminhos(ARCOS_DE_DENTRO), caminhos(ARCOS_DE_FORA)]
    .map((p, i) => `<div class="ab-peca2" style="${em(2.2 + i * 0.1)}">${svg(p)}</div>`)
    .join('');
  if (!escrito) {
    return `<div class="ab-logo"><div class="ab-logo-simbolo">${svg(SIMBOLO)}</div><span class="ab-nome">radinho<span class="ab-online">.online</span></span></div>`;
  }
  return `<div class="ab-logo">
  <div class="ab-logo-simbolo">${pecas}<div class="ab-faisca"><i></i></div></div>
  <span class="ab-nome ab-nome-escrito">
    <span class="ab-nome-contorno">radinho</span>
    <span class="ab-nome-cheio" aria-hidden="true">radinho</span>
    <span class="ab-cortina" aria-hidden="true"><i class="ab-caneta"></i></span>
  </span>
</div>`;
}

/** O HTML da cena (vai logo depois do `#root`). */
export function htmlDaCena(): string {
  return `
<div id="abertura" class="abertura" role="status" aria-live="polite" aria-label="Abrindo o radinho" data-testid="abertura">
  ${construcao()}
  <div class="ab-ato ab-negativo" aria-hidden="true"><div class="ab-vazado">${svg(SIMBOLO, 'var(--color-bg,#0a0a0c)')}</div></div>
  <div class="ab-ato ab-ato3" aria-hidden="true">${logo(true)}</div>
  <div class="ab-ato ab-letreiro" aria-hidden="true"><div class="ab-passa">${svg(SIMBOLO, 'var(--color-bg,#0a0a0c)')}radinho</div></div>
  <div class="ab-ato ab-vitrine" aria-hidden="true"><div class="ab-cartao">${svg(SIMBOLO)}<span>radinho</span><i class="ab-reflexo"></i></div></div>
  <div class="ab-ato ab-final">${logo(false)}</div>
  <button type="button" class="ab-pular" data-testid="abertura-pular">Pular</button>
</div>`;
}

/**
 * O script do `<head>`: roda antes de qualquer pintura. Decide se a cena
 * aparece (sessão) e aplica o TEMA guardado já no primeiro quadro — antes, o
 * tema só chegava com o JS, e a cena começava escura num app claro.
 */
export function scriptDoHead(): string {
  return `(function(){var h=document.documentElement;try{var s=(JSON.parse(localStorage.getItem('aurial:settings')||'{}').state)||{};var t=s.theme;if(t==='light'||t==='dark'){h.classList.toggle('dark',t==='dark')}else if(window.matchMedia){h.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches)}var m=s.reducedMotion;if(m==='on'||(m!=='off'&&window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){h.setAttribute('data-abertura-parada','1')}if(sessionStorage.getItem('${CHAVE_VISTA}')==='1'){h.setAttribute('data-sem-abertura','1')}else{h.setAttribute('data-abrindo','1');sessionStorage.setItem('${CHAVE_VISTA}','1')}}catch(e){h.setAttribute('data-abrindo','1')}window.__aberturaT0=performance.now()})();`;
}

/**
 * O script do fim da cena: "Pular" funciona mesmo antes do app carregar —
 * a cena vai direto ao logo final, que fica até o app estar pronto.
 */
export function scriptDaCena(): string {
  return `(function(){var b=document.querySelector('#abertura .ab-pular');if(b)b.addEventListener('click',function(){document.documentElement.setAttribute('data-abertura-pulada','1')})})();`;
}

/**
 * A JANELA de uma peça: aparece em `inicio`, some em `fim`, numa animação SÓ.
 * Duas animações de opacidade no mesmo elemento (uma para entrar, outra para
 * sair) o Chrome não compõe juntas — e as duas caíam na linha principal
 * (medido pela sonda e2e/abertura.probe.mjs).
 */
function janela(
  seletor: string,
  nome: string,
  inicio: number,
  fim: number,
  entra: number,
  sai: number,
): string {
  const total = fim - inicio;
  const a = ((entra / total) * 100).toFixed(2);
  const b = (((total - sai) / total) * 100).toFixed(2);
  return `${seletor}{animation:${nome} ${total.toFixed(3)}s linear ${inicio.toFixed(3)}s both}
@keyframes ${nome}{0%{opacity:0}${a}%{opacity:1}${b}%{opacity:1}100%{opacity:0}}`;
}

/**
 * Os tempos (segundos reais):
 *   0,00–0,60 o símbolo nasce pequeno e cresce; vira fantasma
 *   0,45–1,30 eixos, círculos guia, âncoras e alças; cursor 0,85–1,65
 *   1,22–1,60 o símbolo é traçado do centro para fora; guias somem 1,60
 *   1,80–2,15 NEGATIVO (tela em tinta, símbolo vazado)
 *   2,15–3,75 logo: peças, faísca dando a volta, nome escrito e preenchido
 *   3,75–4,20 o nome gigante passa   4,20–4,70 o cartão de vidro e o reflexo
 *   4,70–5,00 o logo final pousa e fica
 */
export const CSS_DA_CENA = `
html[data-abrindo] #root{visibility:hidden}
html[data-sem-abertura] #abertura{display:none}
.abertura{position:fixed;inset:0;z-index:200;overflow:hidden;contain:strict;isolation:isolate;background:var(--color-bg,#0a0a0c);color:var(--color-fg,#f5f5f5);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transition:opacity .7s ease;--S:min(76vmin,440px)}
.abertura.ab-saindo{opacity:0;pointer-events:none}
.abertura *{box-sizing:border-box}
.abertura svg{display:block;width:100%;height:100%;overflow:visible}
.ab-ato{position:absolute;inset:0;display:grid;place-items:center;opacity:0;pointer-events:none}
.abertura .ab-ato,.abertura .ab-ato *,.abertura .ab-ato *::before{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
@keyframes ab-mostra{to{opacity:1}}
@keyframes ab-some{to{opacity:0}}
@keyframes ab-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
@keyframes ab-pop-peca{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:none}}
@keyframes ab-risca{from{transform:scaleX(0)}to{transform:none}}

/* ATO 1 — construção */
${janela('.ab-ato1', 'ab-j1', 0, 1.84, 0.01, 0.12)}
.ab-simbolo{position:relative;width:var(--S);height:var(--S)}
.ab-simbolo>div{position:absolute;inset:0}
.ab-semente{animation:ab-pop .3s cubic-bezier(.2,.9,.3,1.3) .02s both}
.ab-cresce{width:100%;height:100%;transform:scale(.25);opacity:1;animation:ab-crescer .4s cubic-bezier(.6,0,.2,1) .28s both,ab-fantasma .35s ease .62s both}
@keyframes ab-crescer{to{transform:none}}
@keyframes ab-fantasma{to{opacity:.13}}
.ab-guias{animation:ab-some .2s ease 1.55s both}
.ab-eixo{position:absolute;left:-8%;right:-8%;top:50%;height:1px;margin-top:-.5px}
.ab-eixo i{display:block;width:100%;height:100%;background:currentColor;opacity:.4;transform:scaleX(0);animation:ab-risca .38s cubic-bezier(.5,0,.2,1) both}
.ab-guia{position:absolute;left:50%;top:50%;translate:-50% -50%;border:1px solid currentColor;border-radius:50%;opacity:0;animation:ab-guia-entra .38s cubic-bezier(.5,0,.2,1) both}
@keyframes ab-guia-entra{from{opacity:0;transform:scale(.2)}to{opacity:.45;transform:none}}
.ab-alca{position:absolute;height:1px;transform-origin:0 50%;margin-top:-.5px}
.ab-alca i{display:block;width:100%;height:100%;background:currentColor;opacity:.7;transform:scaleX(0);transform-origin:0 50%;animation:ab-risca .22s ease-out both}
.ab-ponto{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border:1.5px solid currentColor;background:var(--color-bg,#0a0a0c);animation:ab-pop .22s cubic-bezier(.2,.9,.3,1.4) both}
.ab-controle{border-radius:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px}
.ab-peca{animation:ab-pop-peca .32s cubic-bezier(.2,.9,.3,1.3) both}
.ab-cursor{inset:auto!important;left:0;top:0;width:calc(var(--S)*.06);height:calc(var(--S)*.09);animation:ab-cursor .8s cubic-bezier(.45,0,.3,1) .85s both}
@keyframes ab-cursor{
0%{opacity:0;transform:translate(calc(var(--S)*1.05),calc(var(--S)*1.1))}
15%{opacity:1}
40%{transform:translate(calc(var(--S)*.204),calc(var(--S)*.204))}
70%{transform:translate(calc(var(--S)*.204),calc(var(--S)*.796))}
90%{opacity:1;transform:translate(calc(var(--S)*.796),calc(var(--S)*.204))}
100%{opacity:0;transform:translate(calc(var(--S)*.9),calc(var(--S)*.3))}}

/* ATO 2 — negativo */
.ab-negativo{background:currentColor}
${janela('.ab-negativo', 'ab-j2', 1.8, 2.17, 0.02, 0.02)}
.ab-vazado{width:calc(var(--S)*.5);height:calc(var(--S)*.5);animation:ab-pop .3s cubic-bezier(.2,.9,.3,1.3) 1.8s both}

/* ATO 3 — logo, faísca e o nome escrito */
${janela('.ab-ato3', 'ab-j3', 2.15, 3.8, 0.02, 0.12)}
.ab-logo{display:flex;align-items:center;gap:calc(var(--S)*.045);font-weight:700;letter-spacing:-.03em;font-size:calc(var(--S)*.17);line-height:1}
.ab-logo-simbolo{position:relative;flex:none;width:1.2em;height:1.2em}
.ab-logo-simbolo>div{position:absolute;inset:0}
.ab-peca2{animation:ab-pop-peca .3s cubic-bezier(.2,.9,.3,1.3) both}
.ab-faisca{animation:ab-faisca .75s cubic-bezier(.4,0,.6,1) 2.4s both}
.ab-faisca i{position:absolute;left:50%;top:8%;width:.13em;height:.13em;margin-left:-.065em;border-radius:50%;background:currentColor;box-shadow:0 0 .25em .06em currentColor}
@keyframes ab-faisca{0%{opacity:0;transform:rotate(-120deg)}12%{opacity:1}85%{opacity:1}100%{opacity:0;transform:rotate(240deg)}}
.ab-nome{position:relative;white-space:nowrap}
.ab-nome-contorno{color:transparent;-webkit-text-stroke:1.5px var(--color-fg,#f5f5f5)}
.ab-nome-cheio{position:absolute;left:0;top:0;opacity:0;animation:ab-mostra .35s ease 3.3s both}
.ab-cortina{position:absolute;left:-.1em;right:-.1em;top:-.2em;bottom:-.25em;background:var(--color-bg,#0a0a0c);transform-origin:100% 50%;animation:ab-cortina .7s cubic-bezier(.45,0,.4,1) 2.55s both}
@keyframes ab-cortina{from{transform:none}to{transform:translateX(105%)}}
.ab-caneta{position:absolute;left:0;top:45%;width:.12em;height:.12em;margin:-.06em 0 0 -.06em;border-radius:50%;background:currentColor}
${janela('.ab-caneta', 'ab-jc', 2.55, 3.3, 0.1, 0.1)}

/* ATO 4a — o nome gigante passando, em negativo */
.ab-letreiro{background:var(--color-fg,#f5f5f5);color:var(--color-bg,#0a0a0c);justify-items:start}
${janela('.ab-letreiro', 'ab-j4', 3.75, 4.22, 0.02, 0.02)}
.ab-passa{display:flex;align-items:center;gap:.12em;white-space:nowrap;font-weight:700;letter-spacing:-.05em;font-size:36vmin;line-height:1;padding-left:100vw;animation:ab-passar .45s linear 3.75s both}
.ab-passa svg{width:.8em;height:.8em;flex:none}
@keyframes ab-passar{from{transform:translateX(0)}to{transform:translateX(-100%)}}

/* ATO 4b — o cartão de vidro */
${janela('.ab-vitrine', 'ab-j5', 4.2, 4.82, 0.02, 0.2)}
.ab-cartao{position:relative;display:grid;place-items:center;align-content:center;gap:12px;overflow:hidden;width:min(56vmin,320px);aspect-ratio:1;border-radius:22%;background:color-mix(in srgb,currentColor 7%,transparent);border:1px solid color-mix(in srgb,currentColor 22%,transparent);font-weight:700;font-size:18px;animation:ab-cartao .42s cubic-bezier(.2,.8,.2,1) 4.2s both}
.ab-cartao svg{width:min(24vmin,136px);height:min(24vmin,136px)}
@keyframes ab-cartao{from{opacity:0;transform:perspective(800px) rotateX(28deg) rotateY(-22deg) translateY(10%) scale(.9)}to{opacity:1;transform:perspective(800px)}}
.ab-reflexo{position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(90deg,transparent,color-mix(in srgb,currentColor 20%,transparent),transparent);transform:translateX(-120%) skewX(-20deg);animation:ab-reflexo .42s ease-in-out 4.3s both}
@keyframes ab-reflexo{to{transform:translateX(320%) skewX(-20deg)}}

/* ATO 5 — o logo final */
.ab-final{animation:ab-pousar .4s cubic-bezier(.2,.8,.2,1) 4.66s both}
.ab-final .ab-logo{font-size:min(calc(var(--S)*.13),11vw)}
.ab-online{opacity:.4;font-weight:500}
@keyframes ab-pousar{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}

.ab-pular{position:absolute;right:20px;bottom:max(1.25rem,env(safe-area-inset-bottom,0px));z-index:2;border-radius:999px;padding:8px 16px;font:500 14px/1.2 inherit;color:inherit;border:1px solid currentColor;background:var(--color-bg,#0a0a0c);opacity:.8}

/* Pulada ou sem movimento: só o logo final, parado. */
html[data-abertura-pulada] .abertura .ab-ato,html[data-abertura-parada] .abertura .ab-ato{animation:none!important;opacity:0}
html[data-abertura-pulada] .abertura .ab-final,html[data-abertura-parada] .abertura .ab-final{opacity:1}
html[data-abertura-pulada] .abertura .ab-pular{display:none}
`;
