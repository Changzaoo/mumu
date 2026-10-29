/**
 * Ícones desenhados para o radinho — no lugar de emoji.
 *
 * Pedido do Vinicius (29/10/2026): nada de emoji na interface; tudo desenhado
 * por nós. Cada desenho é um SVG 24×24 de traço (`currentColor`, 1,75 px,
 * pontas redondas) com um preenchimento leve (`.2`) onde dá volume — assim
 * herda a cor do texto, a cor da raridade/liga e o tema claro/escuro.
 *
 * Os dados (conquistas, ligas, categorias) guardam só o NOME do desenho.
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const F = { fill: 'currentColor', fillOpacity: 0.2 } as const;

const DESENHOS = {
  // ── Jornada ──────────────────────────────────────────────────────
  chama: (
    <>
      <path
        {...F}
        d="M12 21.5c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.2 3.6-7.6.5 1.5 1.2 2.4 2.1 2.9C11 7 12.2 4.3 14.6 2.5c-.2 2.9 1 4.8 2.3 6.6 1 1.4 1.6 3 1.6 5.2 0 4.2-2.7 7.2-6.5 7.2Z"
      />
      <path d="M12 21.5c-1.7 0-2.9-1.2-2.9-2.9 0-1.6 1.2-2.5 1.8-3.8.4.8 1 1.2 1.6 1.3.1-1 .5-1.8 1.3-2.5.2 1.5 1.1 2.4 1.1 4 0 2.3-1.2 3.9-2.9 3.9Z" />
    </>
  ),
  alvo: (
    <>
      <circle cx="11" cy="13" r="8" />
      <circle {...F} cx="11" cy="13" r="4.5" />
      <circle cx="11" cy="13" r="1.2" fill="currentColor" />
      <path d="m11 13 8.5-8.5M16.5 4.5l3 0 0 3M19.5 4.5l-2 2" />
    </>
  ),
  cometa: (
    <>
      <circle {...F} cx="15.5" cy="8.5" r="4.5" />
      <path d="M12.3 11.7 3 21M10.5 8.6 4.5 14.6M15.4 13.5l-6 6" />
      <path d="M14 7.2c.6-.6 1.5-.8 2.3-.5" />
    </>
  ),
  cem: (
    <>
      <path d="M4 7.5 6 6v11" />
      <rect {...F} x="9" y="6" width="5" height="11" rx="2.5" />
      <rect {...F} x="16" y="6" width="5" height="11" rx="2.5" />
      <path d="M3 20.5h18" />
    </>
  ),
  coroa: (
    <>
      <path {...F} d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.8 10H5.3Z" />
      <path d="M5.5 21h13" />
      <circle cx="12" cy="4" r="1" fill="currentColor" />
      <circle cx="3.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="20.5" cy="7.5" r="1" fill="currentColor" />
    </>
  ),
  escudo: (
    <>
      <path {...F} d="M12 2.8 19.5 5.6v5.6c0 4.8-3.2 8.5-7.5 10-4.3-1.5-7.5-5.2-7.5-10V5.6Z" />
      <path d="m8.6 12 2.4 2.4 4.4-4.8" />
    </>
  ),
  confete: (
    <>
      <path {...F} d="m3.5 20.5 4.4-12.1 7.7 7.7Z" />
      <path d="M7.4 9.8c1.3 2.6 3.9 5.2 6.8 6.8" />
      <path d="M14 3.5c-.6 1.7.2 2.5 1.4 2.6M20.5 10c-1.7-.6-2.5.2-2.6 1.4M17.5 3v1.5M21 6.5h-1.5M11.5 6l.7-.7M18 13l.7-.7" />
    </>
  ),
  coruja: (
    <>
      <path {...F} d="M5 9c0-3.5 3-6 7-6s7 2.5 7 6v6c0 3.6-3.1 6-7 6s-7-2.4-7-6Z" />
      <path d="M5 4l2.5 2.5M19 4l-2.5 2.5" />
      <circle cx="9" cy="10" r="2.2" />
      <circle cx="15" cy="10" r="2.2" />
      <circle cx="9" cy="10" r=".6" fill="currentColor" />
      <circle cx="15" cy="10" r=".6" fill="currentColor" />
      <path d="m11 13.2 1 1.3 1-1.3M9 17.5c1.8.9 4.2.9 6 0" />
    </>
  ),
  galo: (
    <>
      <path d="M9 4.5c0-1.2 1.4-1.8 2.1-.9.6-1.2 2.4-.9 2.4.5" />
      <path
        {...F}
        d="M8.5 6.5c2.2-1 4.6 0 5 2.4L14 12l4.5-3.5c1.1 3.8.2 7.8-3.5 9.3-3.4 1.3-7.5-.3-7.5-4.5V9.5Z"
      />
      <path d="M8.5 7.8 6 9.2l2.4.8M10 21v-3M13.5 21v-3" />
      <circle cx="10.6" cy="8.7" r=".6" fill="currentColor" />
    </>
  ),
  'maos-coracao': (
    <>
      <path {...F} d="M12 18.5 5.6 12.3A3.9 3.9 0 0 1 12 7.7a3.9 3.9 0 0 1 6.4 4.6Z" />
      <path d="M3 13.5 6.5 17l2 3.5M21 13.5 17.5 17l-2 3.5" />
    </>
  ),
  fone: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect {...F} x="3" y="14" width="4.5" height="7" rx="1.6" />
      <rect {...F} x="16.5" y="14" width="4.5" height="7" rx="1.6" />
    </>
  ),
  corredor: (
    <>
      <circle {...F} cx="15" cy="4.5" r="2" />
      <path d="m10.5 8 3.5-.8 2 3.3 3 1.2M13.8 7.4 11.6 13l3.4 2.6-.8 5.4M11.6 13l-2.2 3.4H5.5M8 9.5l2.5-1.5" />
    </>
  ),
  galaxia: (
    <>
      <path d="M12 12c0-2.8 2.7-4.3 5-3.4 3 1.2 3 6-.6 8.2-4 2.5-10.4.7-11-4.4-.6-4.8 4.4-8.6 9.6-7.3" />
      <circle {...F} cx="12" cy="12" r="2.3" />
      <path d="M19.5 3.5v2M18.5 4.5h2M4 19.5v1.6M3.2 20.3h1.6" />
    </>
  ),
  disco: (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8M6.2 12a5.8 5.8 0 0 0 5.8 5.8" />
    </>
  ),
  'disco-ouro': (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="m12 4.5.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z" />
      <path d="M6.2 12a5.8 5.8 0 0 0 5.8 5.8" />
    </>
  ),
  bussola: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path {...F} d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4Z" />
      <circle cx="12" cy="12" r=".8" fill="currentColor" />
      <path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21" />
    </>
  ),
  livros: (
    <>
      <rect {...F} x="3.5" y="4" width="4" height="16" rx="1" />
      <rect x="7.5" y="6" width="4" height="14" rx="1" />
      <path {...F} d="m13 6.6 3.8-1 3.7 13.6-3.8 1Z" />
      <path d="M3.5 8h4M7.5 9.5h4M3 20.5h9" />
    </>
  ),
  'arco-iris': (
    <>
      <path d="M2.5 18a9.5 9.5 0 0 1 19 0" />
      <path d="M5.8 18a6.2 6.2 0 0 1 12.4 0" />
      <path {...F} d="M9 18a3 3 0 0 1 6 0Z" />
    </>
  ),
  coracao: <path {...F} d="M12 20.5 4.3 13a4.8 4.8 0 0 1 7.7-5.6A4.8 4.8 0 0 1 19.7 13Z" />,
  pasta: (
    <>
      <path
        {...F}
        d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-7L10 5H5a2 2 0 0 0-2 2.5Z"
      />
      <path d="M8 13h8M8 16h5" />
    </>
  ),
  pomba: (
    <>
      <path
        {...F}
        d="M3 13.5c3.6.6 6.2-.4 7.8-3.4l2.8-5.3c.4 3 1.6 5 4.2 5.4l2.7-1.4-1.6 3.4c-.6 4.1-4 6.8-8.4 6.8-3.4 0-6-2-7.5-5.5Z"
      />
      <path d="M13.6 4.8C12 3 9.4 2.8 7.5 4.2c1.7.3 3 1.4 3.3 2.9M9 17.5 6.5 21M18 9.2h.1" />
    </>
  ),
  punho: (
    <>
      <path
        {...F}
        d="M7 10V6.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V10V6.5a1.5 1.5 0 0 1 3 0V10v-1a1.5 1.5 0 0 1 3 0v4.5c0 3.6-2.4 6-5.8 6H11c-2.6 0-4.5-2-4.5-4.5v-2a1.6 1.6 0 0 1 3.2-.2"
      />
      <path d="M9.7 12.8c1.4.2 2.6 1 3 2.4M10 21.5h6" />
    </>
  ),
  megafone: (
    <>
      <path {...F} d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8L17 20V4L8 8.5H5.5A1.5 1.5 0 0 0 4 10Z" />
      <path d="m7.5 15.5 1.2 4.5h2.6l-1-4M20 9.5a3.2 3.2 0 0 1 0 5" />
    </>
  ),
  trofeu: (
    <>
      <path {...F} d="M7 3.5h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 5.5H4.5a3 3 0 0 0 3 4.4M17 5.5h2.5a3 3 0 0 1-3 4.4M12 13.5v3.5M8 20.5h8M9.5 17h5v3.5h-5Z" />
    </>
  ),
  vela: (
    <>
      <path {...F} d="M8.5 10h7v10.5h-7Z" />
      <path d="M12 10V8M12 6.8c-1.2-1-1.3-2.4 0-4 1.3 1.6 1.2 3 0 4ZM6 20.5h12M11 13.5c0 1.4.8 2.2 1.5 2.5" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path {...F} d="M10 8.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1l-6-3.8a.6.6 0 0 0-.9.5Z" />
    </>
  ),
  cronometro: (
    <>
      <circle {...F} cx="12" cy="13.5" r="7.5" />
      <path d="M10 2.5h4M12 2.5V6M12 13.5l3-3M18.5 6.5l1.5-1.5" />
    </>
  ),
  // ── Ligas (a cor vem da liga) ────────────────────────────────────
  'medalha-3': (
    <>
      <path d="m8 2.5 3 6M16 2.5l-3 6M5.5 2.5h5M13.5 2.5h5" />
      <circle {...F} cx="12" cy="15" r="6.5" />
      <path d="M10.2 12.6h3.4l-1.8 2.1a1.7 1.7 0 1 1-1.8 2.6" />
    </>
  ),
  'medalha-2': (
    <>
      <path d="m8 2.5 3 6M16 2.5l-3 6M5.5 2.5h5M13.5 2.5h5" />
      <circle {...F} cx="12" cy="15" r="6.5" />
      <path d="M10.2 13.3a1.8 1.8 0 1 1 3.2 1.4l-3.2 3h3.6" />
    </>
  ),
  'medalha-1': (
    <>
      <path d="m8 2.5 3 6M16 2.5l-3 6M5.5 2.5h5M13.5 2.5h5" />
      <circle {...F} cx="12" cy="15" r="6.5" />
      <path d="M10.6 13.2 12.4 12v5.8" />
    </>
  ),
  safira: (
    <>
      <path {...F} d="M12 2.5 20 7.5v9l-8 5-8-5v-9Z" />
      <path d="M12 7.5 16 10v4l-4 2.5L8 14v-4ZM12 2.5v5M12 16.5v5M4 7.5 8 10M20 7.5 16 10M4 16.5 8 14M20 16.5 16 14" />
    </>
  ),
  rubi: (
    <>
      <path {...F} d="M12 2.5 20 12l-8 9.5L4 12Z" />
      <path d="M12 7 15.5 12 12 17 8.5 12ZM12 2.5V7M12 17v4.5M4 12h4.5M15.5 12H20" />
    </>
  ),
  diamante: (
    <>
      <path {...F} d="M7 3.5h10L21 9l-9 11.5L3 9Z" />
      <path d="M3 9h18M9.5 3.5 8 9l4 11.5L16 9l-1.5-5.5" />
    </>
  ),
  // ── Convite ──────────────────────────────────────────────────────
  'sem-anuncio': (
    <>
      <rect {...F} x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M7 15.5 9 9l2 6.5M7.6 13.5h2.8M13.5 9v6.5h1.3a3.25 3.25 0 0 0 0-6.5Z" />
      <path d="M3.5 3.5l17 17" />
    </>
  ),
  gratis: (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <path d="M14.8 9.2c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.8 5.8 1.6 5.8 4.4 0 1.2-1.3 2.2-3 2.2-1.4 0-2.6-.7-3-1.8M12 6v1.6M12 16.4V18" />
    </>
  ),
  radio: (
    <>
      <rect {...F} x="3" y="8" width="18" height="12.5" rx="2.5" />
      <path d="m6.5 8 10-4.5" />
      <circle cx="15.5" cy="14.2" r="3" />
      <path d="M6.5 12h4M6.5 15h4M6.5 18h4" />
    </>
  ),
  globo: (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z" />
    </>
  ),
  // ── Categorias de podcast ────────────────────────────────────────
  jornal: (
    <>
      <path {...F} d="M4 4.5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M17 8.5h3v10a2 2 0 0 1-2 2M7 8h7M7 11.5h3M7 15h7M12 11.5h2" />
    </>
  ),
  risada: (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <path d="M8 13.5h8a4 4 0 0 1-8 0ZM7.5 9.8c.5-.9 1.8-.9 2.3 0M14.2 9.8c.5-.9 1.8-.9 2.3 0" />
    </>
  ),
  sociedade: (
    <>
      <circle {...F} cx="8" cy="8" r="2.8" />
      <circle {...F} cx="16.5" cy="9" r="2.3" />
      <path d="M3 19.5c.3-3.4 2.3-5.5 5-5.5s4.7 2.1 5 5.5M13.5 14.6c.9-.7 1.9-1.1 3-1.1 2.3 0 4 1.8 4.4 4.9" />
    </>
  ),
  lupa: (
    <>
      <circle {...F} cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.3 15.3 5.2 5.2M8 8.5a3 3 0 0 1 2.5-1.3" />
    </>
  ),
  maleta: (
    <>
      <rect {...F} x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18M11 12.5v1.8h2v-1.8" />
    </>
  ),
  capelo: (
    <>
      <path {...F} d="m12 4 10 5-10 5L2 9Z" />
      <path d="M6 11v4.5c1.5 1.6 3.7 2.5 6 2.5s4.5-.9 6-2.5V11M22 9v6" />
    </>
  ),
  bola: (
    <>
      <circle {...F} cx="12" cy="12" r="9" />
      <path d="m12 8 3 2.2-1.1 3.6h-3.8L9 10.2ZM12 8V3.2M15 10.2l4.4-1.6M13.9 13.8l2.7 3.9M10.1 13.8l-2.7 3.9M9 10.2 4.6 8.6" />
    </>
  ),
  lotus: (
    <>
      <path
        {...F}
        d="M12 19c-2.4-2-3.5-4.4-3.5-7S9.6 7 12 4.5c2.4 2.5 3.5 4.9 3.5 7.5s-1.1 5-3.5 7Z"
      />
      <path d="M12 19c-4.6 0-8-2.3-9-6 2.8-.4 5.1.2 6.8 1.8M12 19c4.6 0 8-2.3 9-6-2.8-.4-5.1.2-6.8 1.8" />
    </>
  ),
  notebook: (
    <>
      <rect {...F} x="4" y="5" width="16" height="11" rx="1.6" />
      <path d="M2.5 19.5h19M10 8.5 8 10.5l2 2M14 8.5l2 2-2 2" />
    </>
  ),
  nota: (
    <>
      <path d="M9 17.5V5.5l10-2v12" />
      <ellipse {...F} cx="6.5" cy="17.5" rx="2.5" ry="2" />
      <ellipse {...F} cx="16.5" cy="15.5" rx="2.5" ry="2" />
      <path d="M9 9.5l10-2" />
    </>
  ),
  'estrela-guia': (
    <>
      <path
        {...F}
        d="M12 2.5c.6 4.7 2.8 7 7.5 7.5-4.7.6-6.9 2.8-7.5 7.5-.6-4.7-2.8-6.9-7.5-7.5 4.7-.5 6.9-2.8 7.5-7.5Z"
      />
      <path d="M6 18.5h12M8.5 21.5h7" />
    </>
  ),
  coluna: (
    <>
      <path {...F} d="M3.5 8.5 12 3.5l8.5 5Z" />
      <path d="M5.5 11v7M10 11v7M14 11v7M18.5 11v7M3 20.5h18M4 8.5h16" />
    </>
  ),
  atomo: (
    <>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <ellipse {...F} cx="12" cy="12" rx="9.5" ry="3.8" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
    </>
  ),
  claquete: (
    <>
      <rect {...F} x="3" y="9.5" width="18" height="11" rx="1.8" />
      <path d="m3.3 9.5-.6-3.4 16.8-3 .6 3.4ZM7.4 5.3l2.4 3.3M12.3 4.4l2.4 3.4M17 3.6l2.4 3.3" />
    </>
  ),
  paleta: (
    <>
      <path
        {...F}
        d="M12 3a9 9 0 0 0 0 18c1.5 0 2.2-1 2-2.2-.2-1.5.6-2.6 2.2-2.6H18c1.8 0 3-1.4 3-3.4C21 7 17 3 12 3Z"
      />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" />
      <circle cx="15.2" cy="7.6" r="1.2" fill="currentColor" />
    </>
  ),
  livro: (
    <>
      <path
        {...F}
        d="M12 6.5C10 5 7 4.5 3 5v13.5c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5Z"
      />
      <path d="M12 6.5V20" />
    </>
  ),
  pipa: (
    <>
      <path {...F} d="M14 2.5 20.5 9 14 15.5 7.5 9Z" />
      <path d="M7.5 9h13M14 2.5v13M14 15.5c-1 2.5-3 3-4.5 2.2S6.8 16.2 5.5 17s-1.6 2.6-1.8 4" />
    </>
  ),
  controle: (
    <>
      <path
        {...F}
        d="M7 7h10a4.5 4.5 0 0 1 4.4 5.4l-.9 4.3a2.4 2.4 0 0 1-4.1 1.1L14.5 16h-5l-1.9 1.8a2.4 2.4 0 0 1-4.1-1.1l-.9-4.3A4.5 4.5 0 0 1 7 7Z"
      />
      <path d="M8 10v3.5M6.25 11.75h3.5" />
      <circle cx="15.5" cy="10.5" r=".9" fill="currentColor" />
      <circle cx="17" cy="13" r=".9" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type NomeDeDesenho = keyof typeof DESENHOS;

export interface DesenhoProps extends Omit<ComponentProps<'svg'>, 'children'> {
  nome: NomeDeDesenho;
  /** Texto para leitor de tela; sem ele o desenho é decorativo. */
  rotulo?: string;
}

export function Desenho({ nome, rotulo, className, ...props }: DesenhoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      className={cn('inline-block size-[1em] shrink-0 align-[-0.125em]', className)}
      {...props}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
