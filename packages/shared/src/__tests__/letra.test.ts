/**
 * LETRA: parse de LRC, normalização e a prova de que a linha do LRCLIB é desta
 * música. Tabelas escritas à mão (os casos que já deram letra errada) e
 * geradores determinísticos (seed fixa: a mesma falha volta na mesma rodada).
 */
import { describe, expect, it } from 'vitest';
import {
  comparaTitulos,
  contemPalavrasInteiras,
  escolherLinhaDoLrclib,
  formasDoArtista,
  julgarLinhaDoLrclib,
  lerPalavrasMarcadas,
  limparTituloDaLetra,
  linhaDoLrclibBate,
  lrcSemTempo,
  marcasDeVersao,
  nomeDeArtistaBate,
  normalizarParaComparar,
  parseLrc,
  semelhancaDeLinhas,
  type LrclibRow,
} from '../letra/index.js';

/** mulberry32: PRNG pequeno e determinístico. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mmss = (ms: number, digitos: 1 | 2 | 3 = 2): string => {
  const min = Math.floor(ms / 60_000);
  const seg = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  const f =
    digitos === 3
      ? String(frac).padStart(3, '0')
      : digitos === 2
        ? String(Math.floor(frac / 10)).padStart(2, '0')
        : String(Math.floor(frac / 100));
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}.${f}`;
};

const VERSOS_PT = [
  'Eu vou te levar pra onde o sol nasce',
  'Na quebrada o papo é reto',
  'Coração bateu mais forte quando você chegou',
  'Tô na pista e não sei voltar',
  'Mantém, mantém, que o jogo é nosso',
  'Saudade de você me pega de manhã',
  'Ela dança e o mundo para',
  'Não é dinheiro, é a paz que eu quero',
];
const VERSOS_EN = [
  'I keep running through the night',
  'Never let me go tonight',
  'Baby you are all I need',
  'Under the city lights we fly',
  'Hold me close and do not leave',
  'We were young and we were free',
];

// ── parseLrc ────────────────────────────────────────────────────────────────
describe('parseLrc: frações de 1 a 3 dígitos', () => {
  const casos: Array<[string, number]> = [
    ['[00:01.5]', 1500],
    ['[00:01.05]', 1050],
    ['[00:01.005]', 1005],
    ['[00:01.50]', 1500],
    ['[00:01.500]', 1500],
    ['[00:01:50]', 1500],
    ['[00:01]', 1000],
    ['[01:00.00]', 60_000],
    ['[10:00.99]', 600_990],
    ['[00:59.999]', 59_999],
    ['[123:00.00]', 7_380_000],
    ['[00:00.00]', 0],
  ];
  it.each(casos)('%s → %i ms', (marca, ms) => {
    expect(parseLrc(`${marca}verso`)).toEqual([{ timeMs: ms, text: 'verso' }]);
  });
});

describe('parseLrc: offset', () => {
  const casos: Array<[number, number, number]> = [
    [0, 10_000, 10_000],
    [500, 10_000, 9_500],
    [-500, 10_000, 10_500],
    [2000, 1_000, 0], // nunca negativo
    [250, 250, 0],
    [-3000, 0, 3000],
    [1, 10_000, 9_999],
  ];
  it.each(casos)('offset %i sobre %i ms → %i ms', (offset, t, esperado) => {
    const sinal = offset >= 0 ? `+${offset}` : String(offset);
    const lrc = `[offset:${sinal}]\n[${mmss(t)}]linha`;
    expect(parseLrc(lrc)[0]?.timeMs).toBe(esperado);
  });

  it('offset sem sinal e com espaços', () => {
    expect(parseLrc('[offset: 300 ]\n[00:01.00]a')[0]?.timeMs).toBe(700);
  });

  it('offset também desloca as palavras marcadas', () => {
    const [l] = parseLrc('[offset:+200]\n[00:01.00]<00:01.00>Eu <00:01.50>vou');
    expect(l?.words).toEqual([
      { text: 'Eu', timeMs: 800 },
      { text: 'vou', timeMs: 1300 },
    ]);
  });
});

describe('parseLrc: multi-timestamp, cabeçalhos, vazios, CRLF, ordem', () => {
  it('refrão em três instantes vira três linhas, em ordem', () => {
    const l = parseLrc('[00:30.00][01:30.00][00:10.00]Refrão');
    expect(l.map((x) => x.timeMs)).toEqual([10_000, 30_000, 90_000]);
    expect(new Set(l.map((x) => x.text))).toEqual(new Set(['Refrão']));
  });

  it('marcas de palavra só valem para linha de tempo único', () => {
    const l = parseLrc('[00:01.00][00:05.00]<00:01.00>a <00:01.20>b');
    expect(l.every((x) => x.words === undefined)).toBe(true);
    expect(l.map((x) => x.text)).toEqual(['a b', 'a b']);
  });

  it.each([
    '[ti:Mantém]',
    '[ar:Matuê]',
    '[al:Máquina do Tempo]',
    '[by:alguém]',
    '[length: 03:26]',
    '[re:editor]',
    '[ve:1.0]',
    '[#comentário]',
  ])('cabeçalho %s não vira verso', (cab) => {
    expect(parseLrc(`${cab}\n[00:01.00]ok`).map((x) => x.text)).toEqual(['ok']);
  });

  it('linha com tempo e sem texto fica (é a pausa)', () => {
    expect(parseLrc('[00:01.00]a\n[00:05.00]\n[00:09.00]b')).toEqual([
      { timeMs: 1000, text: 'a' },
      { timeMs: 5000, text: '' },
      { timeMs: 9000, text: 'b' },
    ]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('quebra %s', (_nome, quebra) => {
    const l = parseLrc(['[00:01.00]um', '[00:02.00]dois', '[00:03.00]três'].join(quebra));
    expect(l.map((x) => x.text)).toEqual(['um', 'dois', 'três']);
  });

  it('BOM no começo não esconde a primeira linha', () => {
    expect(parseLrc('﻿[00:01.00]primeira')[0]?.text).toBe('primeira');
  });

  it('linha sem marca no começo (texto solto) fica de fora', () => {
    expect(parseLrc('solto\nverso [00:02.00]\n[00:03.00]ok').map((x) => x.text)).toEqual(['ok']);
  });

  it('crédito da NetEase ("作词 : X") não é verso', () => {
    const lrc = '[00:00.00]作词 : Fulano\n[00:00.50]作曲：Ciclano\n[00:01.00]verso';
    expect(parseLrc(lrc).map((x) => x.text)).toEqual(['verso']);
  });

  it('mesmo instante: a ordem do arquivo fica (sort estável)', () => {
    expect(parseLrc('[00:01.00]a\n[00:01.00]b\n[00:01.00]c').map((x) => x.text)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('vazio, nulo e lixo não lançam', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc(null)).toEqual([]);
    expect(parseLrc(undefined)).toEqual([]);
    expect(parseLrc('[[[]]]\n[aa:bb]\n<00:01.00>')).toEqual([]);
  });

  it('A2 incompleto: o texto antes da primeira marca entra no instante da linha', () => {
    const [l] = parseLrc('[00:04.00]Eu vou <00:05.00>ali');
    expect(l?.text).toBe('Eu vou ali');
    expect(l?.words).toEqual([
      { text: 'Eu', timeMs: 4000 },
      { text: 'vou', timeMs: 4000 },
      { text: 'ali', timeMs: 5000 },
    ]);
  });
});

describe('parseLrc: gerador (seed 20261103) — fora de ordem, frações e offset', () => {
  const rand = prng(20261103);
  const casos = Array.from({ length: 40 }, (_, k) => {
    const n = 4 + Math.floor(rand() * 20);
    const offset = Math.floor((rand() - 0.5) * 2000);
    const digitos = (1 + Math.floor(rand() * 3)) as 1 | 2 | 3;
    const quebra = rand() < 0.5 ? '\n' : '\r\n';
    let t = Math.floor(rand() * 15_000);
    const linhas = Array.from({ length: n }, (_, i) => {
      t += 1500 + Math.floor(rand() * 4000);
      const versos = rand() < 0.5 ? VERSOS_PT : VERSOS_EN;
      return { t, text: `${versos[i % versos.length]} ${i}` };
    });
    return { k, n, offset, digitos, quebra, linhas, embaralhar: rand() };
  });
  it.each(casos)('caso $k: $n linhas, offset $offset, $digitos dígito(s)', (c) => {
    const ordem = [...c.linhas].sort(() => 0); // cópia
    // embaralha determinístico
    const r = prng(Math.floor(c.embaralhar * 1e9));
    for (let i = ordem.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [ordem[i], ordem[j]] = [ordem[j]!, ordem[i]!];
    }
    const sinal = c.offset >= 0 ? `+${c.offset}` : String(c.offset);
    const lrc = [
      '[ti:Gerada]',
      `[offset:${sinal}]`,
      ...ordem.map((l) => `[${mmss(l.t, c.digitos)}]${l.text}`),
    ].join(c.quebra);
    const saida = parseLrc(lrc);
    expect(saida).toHaveLength(c.n);
    // em ordem de tempo, e o texto volta na ordem original
    expect(saida.map((l) => l.text)).toEqual(c.linhas.map((l) => l.text));
    const precisao = c.digitos === 1 ? 100 : c.digitos === 2 ? 10 : 1;
    saida.forEach((l, i) => {
      const bruto = Math.floor(c.linhas[i]!.t / precisao) * precisao;
      expect(l.timeMs).toBe(Math.max(0, bruto - c.offset));
    });
    for (let i = 1; i < saida.length; i += 1) {
      expect(saida[i]!.timeMs).toBeGreaterThanOrEqual(saida[i - 1]!.timeMs);
    }
  });
});

describe('lerPalavrasMarcadas e lrcSemTempo', () => {
  it('sem marca: texto aparado, sem words', () => {
    expect(lerPalavrasMarcadas('  oi  ', 0)).toEqual({ text: 'oi' });
  });
  it('fração de 1, 2 e 3 dígitos nas marcas de palavra', () => {
    expect(lerPalavrasMarcadas('<00:01.5>a <00:01.05>b <00:01.005>c', 0).words).toEqual([
      { text: 'a', timeMs: 1500 },
      { text: 'b', timeMs: 1050 },
      { text: 'c', timeMs: 1005 },
    ]);
  });
  it('lrcSemTempo tira linha e palavra', () => {
    expect(lrcSemTempo('[00:01.00]<00:01.00>Eu <00:01.20>vou\n[ti:x]\n\n[00:02.00]ali')).toEqual([
      'Eu vou',
      'ali',
    ]);
  });
});

// ── normalização ────────────────────────────────────────────────────────────
describe('normalizarParaComparar: qualquer alfabeto', () => {
  const casos: Array<[string, string]> = [
    ['Você Não Sabe', 'voce nao sabe'],
    ['  CORAÇÃO!!! ', 'coracao'],
    ['Mantém, mantém', 'mantem mantem'],
    ['사랑해', '사랑해'],
    ['Кино — Группа крови', 'кино группа крови'],
    ['ΑΓΑΠΗ', 'αγαπη'],
    ['حبيبي', 'حبيبي'],
    ['שלום', 'שלום'],
    ['ร้องไห้', 'รองไห'],
    ['夜に駆ける', '夜に駆ける'],
    ['🔥🔥', ''],
    ['', ''],
    ['Tô na pista', 'to na pista'],
    ['Ça va', 'ca va'],
    ['Pt. 2', 'pt 2'],
  ];
  it.each(casos)('%j → %j', (entrada, saida) => {
    expect(normalizarParaComparar(entrada)).toBe(saida);
  });
});

describe('limparTituloDaLetra e marcas de versão', () => {
  const limpos: Array<[string, string]> = [
    ['Warzone (Remix)', 'Warzone'],
    ['Mantém [Official Video]', 'Mantém'],
    ['Amor - Ao Vivo', 'Amor'],
    ['Song - 2011 Remaster', 'Song'],
    ['Song - Remastered 2009', 'Song'],
    ['Lembrei de Tu feat. Fulano', 'Lembrei de Tu'],
    ['Lembrei de Tu ft. Fulano', 'Lembrei de Tu'],
    ['Track - slowed + reverb', 'Track'],
    ['Track - sped up', 'Track'],
    ['Sem nada', 'Sem nada'],
  ];
  it.each(limpos)('limpa %j → %j', (a, b) => expect(limparTituloDaLetra(a)).toBe(b));

  const marcas: Array<[string, string[]]> = [
    ['Warzone (Remix)', ['remix']],
    ['Amor (Ao Vivo)', ['ao-vivo']],
    ['Song (Live at Wembley)', ['ao-vivo']],
    ['Song (Acústico)', ['acustico']],
    ['Song - slowed + reverb', ['slowed']],
    ['Song (Sped Up)', ['sped']],
    ['Song (Instrumental)', ['instrumental']],
    ['Song (Karaoke Version)', ['instrumental']],
    ['Song (Cover)', ['cover']],
    ['Song - 2011 Remaster', []],
    ['Liveira', []],
    ['Remixando a vida', []],
  ];
  it.each(marcas)('marcas de %j', (t, m) => expect(marcasDeVersao(t)).toEqual(m));
});

describe('contemPalavrasInteiras e semelhancaDeLinhas', () => {
  it.each([
    ['amora', 'amor', false],
    ['meu amor', 'amor', true],
    ['mariana souza', 'ana', false],
    ['ana souza', 'ana', true],
    ['x', '', false],
  ] as const)('%j contém %j? %s', (a, b, r) => expect(contemPalavrasInteiras(a, b)).toBe(r));

  it.each([
    ['eu vou', 'eu vou', 1],
    ['eu vou ali', 'eu vou', 2 / 3],
    ['a b c d', 'e f g h', 0],
    ['', 'x', 0],
    ['to aqui to aqui', 'to aqui', 0.5],
  ] as const)('semelhança %j ~ %j = %d', (a, b, s) =>
    expect(semelhancaDeLinhas(a, b)).toBeCloseTo(s, 5),
  );
});

// ── aceitação de linha do LRCLIB ────────────────────────────────────────────
const linha = (r: Partial<LrclibRow> = {}): LrclibRow => ({
  trackName: 'Lembrei de Tu',
  artistName: 'MC Meno K',
  duration: 173,
  syncedLyrics: '[00:01.00]a',
  ...r,
});

describe('linhaDoLrclibBate: tabela de casos que já deram letra errada', () => {
  type Caso = [string, Partial<LrclibRow>, string, string[], number, boolean];
  const casos: Caso[] = [
    ['igual em tudo', {}, 'Lembrei de Tu', ['MC Meno K'], 173, true],
    ['duração +3 s', { duration: 176 }, 'Lembrei de Tu', ['MC Meno K'], 173, true],
    ['duração −3 s', { duration: 170 }, 'Lembrei de Tu', ['MC Meno K'], 173, true],
    ['duração +4 s', { duration: 177 }, 'Lembrei de Tu', ['MC Meno K'], 173, false],
    ['duração −4 s', { duration: 169 }, 'Lembrei de Tu', ['MC Meno K'], 173, false],
    [
      'remix com duração batendo',
      { trackName: 'Lembrei de Tu (Remix)' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      true,
    ],
    [
      'remix com outra duração',
      { trackName: 'Lembrei de Tu (Remix)', duration: 210 },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'ao vivo, outra duração',
      { trackName: 'Lembrei de Tu (Ao Vivo)', duration: 230 },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'ao vivo sem duração: texto igual vale',
      { trackName: 'Lembrei de Tu (Ao Vivo)' },
      'Lembrei de Tu',
      ['MC Meno K'],
      0,
      true,
    ],
    [
      'instrumental nunca recebe letra cantada',
      { trackName: 'Lembrei de Tu' },
      'Lembrei de Tu (Instrumental)',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'letra de instrumental não vai para a cantada',
      { trackName: 'Lembrei de Tu (Instrumental)' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'cover de outro artista',
      { artistName: 'Banda Cover' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'mesmo título, outro artista',
      { artistName: 'Zé Neto e Cristiano' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      false,
    ],
    [
      'mesmo título, outro artista, sem duração',
      { artistName: 'Zé Neto e Cristiano', duration: null },
      'Lembrei de Tu',
      ['MC Meno K'],
      0,
      false,
    ],
    [
      'artista com feat. na faixa',
      { artistName: 'MC Meno K' },
      'Lembrei de Tu',
      ['MC Meno K feat. MC Ryan SP'],
      173,
      true,
    ],
    [
      'artista com feat. na linha',
      { artistName: 'MC Meno K feat. MC Ryan SP' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      true,
    ],
    [
      'participante na linha é o artista da faixa',
      { artistName: 'MC Ryan SP, MC Meno K' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      true,
    ],
    [
      '"MC" sozinho não prova',
      { artistName: 'MC', duration: null },
      'Lembrei de Tu',
      ['MC Meno K'],
      0,
      false,
    ],
    ['"DJ" sozinho não prova', { artistName: 'DJ' }, 'Lembrei de Tu', ['DJ Guuga'], 0, false],
    [
      'nome dentro de outro nome',
      { artistName: 'Mariana Souza' },
      'Lembrei de Tu',
      ['Ana'],
      0,
      false,
    ],
    ['acento e caixa', { artistName: 'MC MENÓ K' }, 'lembrei de tú', ['mc meno k'], 173, true],
    [
      'dupla com & e com "e"',
      { artistName: 'Chitãozinho & Xororó', trackName: 'Evidências' },
      'Evidências',
      ['Chitaozinho e Xororo'],
      0,
      true,
    ],
    [
      'duração 0 na linha conta como desconhecida',
      { duration: 0 },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      true,
    ],
    [
      'duração 0 na faixa + parte 2 x parte 1',
      { trackName: 'Vida Loka, Pt. 1', artistName: "Racionais MC's" },
      'Vida Loka, Pt. 2',
      ["Racionais MC's"],
      0,
      false,
    ],
    [
      'duração 0 + título só contido',
      { trackName: 'Vida Loka', artistName: "Racionais MC's" },
      'Vida Loka, Pt. 2',
      ["Racionais MC's"],
      0,
      false,
    ],
    [
      'duração 0 + título igual + artista',
      { trackName: 'Vida Loka, Pt. 2', artistName: "Racionais MC's" },
      'Vida Loka, Pt. 2',
      ["Racionais MC's"],
      0,
      true,
    ],
    [
      'sem artista e sem duração',
      { artistName: null, duration: null },
      'Lembrei de Tu',
      [],
      0,
      false,
    ],
    ['sem artista, duração prova', { artistName: null }, 'Lembrei de Tu', [], 173, true],
    [
      '"Desconhecido" não é artista',
      { artistName: 'Desconhecido', duration: null },
      'Lembrei de Tu',
      ['Desconhecido'],
      0,
      false,
    ],
    [
      '"Various Artists" não é artista',
      { artistName: 'Various Artists' },
      'Lembrei de Tu',
      ['MC Meno K'],
      173,
      true,
    ],
    [
      'título do YouTube com "Artista - "',
      {},
      'MC Meno K - Lembrei de Tu (Clipe Oficial)',
      ['MC Meno K'],
      0,
      true,
    ],
    ['"Amor" x "Amora"', { trackName: 'Amora' }, 'Amor', ['MC Meno K'], 0, false],
    ['"Eu" x "Medo"', { trackName: 'Eu' }, 'Medo', ['MC Meno K'], 0, false],
    [
      'coreano igual',
      { trackName: '사랑해', artistName: '아이유' },
      '사랑해',
      ['아이유'],
      173,
      true,
    ],
    [
      'coreano, outro artista',
      { trackName: '사랑해', artistName: '방탄소년단' },
      '사랑해',
      ['아이유'],
      173,
      false,
    ],
    [
      'russo igual',
      { trackName: 'Группа крови', artistName: 'Кино' },
      'Группа крови',
      ['Кино'],
      173,
      true,
    ],
    [
      'japonês igual sem duração',
      { trackName: '夜に駆ける', artistName: 'YOASOBI' },
      '夜に駆ける',
      ['YOASOBI'],
      0,
      true,
    ],
    [
      'árabe igual',
      { trackName: 'حبيبي', artistName: 'عمرو دياب' },
      'حبيبي',
      ['عمرو دياب'],
      173,
      true,
    ],
    ['só emoji', { trackName: '🔥🔥' }, '🔥🔥', ['MC Meno K'], 173, false],
    ['título vazio', { trackName: '' }, 'Lembrei de Tu', ['MC Meno K'], 173, false],
    ['duração NaN na faixa', { duration: 999 }, 'Lembrei de Tu', ['MC Meno K'], Number.NaN, true],
    [
      'duração negativa na faixa, sem artista',
      { artistName: null },
      'Lembrei de Tu',
      [],
      -10,
      false,
    ],
  ];
  it.each(casos)('%s', (_nome, row, titulo, nomes, dur, esperado) => {
    expect(linhaDoLrclibBate(linha(row), titulo, nomes, dur)).toBe(esperado);
  });
});

describe('linhaDoLrclibBate: gerador de títulos e durações (seed 7)', () => {
  const rand = prng(7);
  const titulos = [
    'Coração Partido',
    'Tô Na Pista',
    'Saudade',
    'Night Drive',
    'Ela Dança',
    'Bandida',
    'Fim de Semana',
    'Golden Hour',
  ];
  const artistas = [
    'Matuê',
    'Anitta',
    'MC Kevin',
    'Teto',
    'Ludmilla',
    'The Weeknd',
    'Pabllo Vittar',
  ];
  const casos = Array.from({ length: 40 }, (_, k) => {
    const titulo = titulos[Math.floor(rand() * titulos.length)]!;
    const artista = artistas[Math.floor(rand() * artistas.length)]!;
    const dur = 120 + Math.floor(rand() * 180);
    const delta = Math.floor((rand() - 0.5) * 16); // −8..+7 s
    const outroArtista = rand() < 0.3;
    const artistaDaLinha = outroArtista
      ? artistas[(artistas.indexOf(artista) + 1) % artistas.length]!
      : artista;
    return { k, titulo, artista, dur, delta, artistaDaLinha, outroArtista };
  });
  it.each(casos)('caso $k: $titulo / $artista, Δ=$delta s', (c) => {
    const v = julgarLinhaDoLrclib(
      { trackName: c.titulo, artistName: c.artistaDaLinha, duration: c.dur + c.delta },
      c.titulo,
      [c.artista],
      c.dur,
    );
    const esperado = !c.outroArtista && Math.abs(c.delta) <= 3;
    expect(v.aceita).toBe(esperado);
    if (c.outroArtista) expect(v.motivo).toBe('artista');
    else if (Math.abs(c.delta) > 3) expect(v.motivo).toBe('duracao');
  });
});

describe('formasDoArtista e nomeDeArtistaBate', () => {
  it('feat. vira participantes separados', () => {
    expect(formasDoArtista('Anitta feat. MC Kevinho')).toEqual(
      expect.arrayContaining(['anitta', 'mc kevinho']),
    );
  });
  it('dupla com & fica inteira e sem o conectivo', () => {
    expect(formasDoArtista('Chitãozinho & Xororó')).toEqual(
      expect.arrayContaining(['chitaozinho xororo']),
    );
  });
  it.each(['Desconhecido', 'Unknown Artist', 'Various Artists', ''])('%j não tem forma', (n) => {
    expect(formasDoArtista(n)).toEqual([]);
  });
  it.each([
    ['mc kevin', 'mc kevin', true],
    ['mc', 'mc kevin', false],
    ['kevin', 'mc kevin', true],
    ['ana', 'mariana', false],
    ['a', 'a', true],
  ] as const)('%j ~ %j: %s', (a, b, r) => expect(nomeDeArtistaBate(a, b)).toBe(r));
  it('comparaTitulos forte e frouxo', () => {
    expect(comparaTitulos('Warzone (Remix)', 'Warzone')).toEqual({ forte: true, frouxo: true });
    expect(comparaTitulos('Warzone Pt 2', 'Warzone')).toEqual({ forte: false, frouxo: true });
    expect(comparaTitulos('Amora', 'Amor')).toEqual({ forte: false, frouxo: false });
  });
});

describe('escolherLinhaDoLrclib: a melhor entre as candidatas', () => {
  const sync = '[00:01.00]a';
  it('com tempo ganha de sem tempo', () => {
    const rows = [linha({ id: 1, syncedLyrics: null, plainLyrics: 'a' }), linha({ id: 2 })];
    expect(escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173)?.id).toBe(2);
  });
  it('duração mais perto ganha', () => {
    const rows = [linha({ id: 1, duration: 176 }), linha({ id: 2, duration: 173 })];
    expect(escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173)?.id).toBe(2);
  });
  it('mesma versão ganha empate de duração', () => {
    const rows = [
      linha({ id: 1, trackName: 'Lembrei de Tu (Remix)' }),
      linha({ id: 2, trackName: 'Lembrei de Tu' }),
    ];
    expect(escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173)?.id).toBe(2);
  });
  it('instrumental e sem letra ficam de fora', () => {
    const rows = [
      linha({ id: 1, instrumental: true }),
      linha({ id: 2, syncedLyrics: null, plainLyrics: '  ' }),
    ];
    expect(escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173)).toBeNull();
  });
  it('nenhuma bate: null', () => {
    const rows = [linha({ artistName: 'Outro' }), linha({ duration: 300 })];
    expect(escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173)).toBeNull();
  });
  it('exigirTempo descarta texto puro', () => {
    const rows = [linha({ syncedLyrics: null, plainLyrics: 'a' })];
    expect(
      escolherLinhaDoLrclib(rows, 'Lembrei de Tu', ['MC Meno K'], 173, { exigirTempo: true }),
    ).toBeNull();
  });
  it('entrada torta não lança', () => {
    expect(escolherLinhaDoLrclib(null, 'x', [], 0)).toBeNull();
    expect(
      escolherLinhaDoLrclib(
        [null as unknown as LrclibRow, linha()],
        'Lembrei de Tu',
        ['MC Meno K'],
        173,
      ),
    ).not.toBeNull();
  });

  const rand = prng(99);
  const geradas = Array.from({ length: 20 }, (_, k) => {
    const alvo = 150 + Math.floor(rand() * 100);
    const n = 3 + Math.floor(rand() * 6);
    const rows = Array.from({ length: n }, (_, i) => ({
      id: i,
      trackName: 'Fim de Semana',
      artistName: rand() < 0.25 ? 'Outro Artista' : 'Ludmilla',
      duration: alvo + Math.floor((rand() - 0.5) * 14),
      syncedLyrics: rand() < 0.7 ? sync : null,
      plainLyrics: 'texto',
    }));
    return { k, alvo, rows };
  });
  it.each(geradas)('gerado $k: a escolhida é a melhor válida', ({ alvo, rows }) => {
    const escolhida = escolherLinhaDoLrclib(rows, 'Fim de Semana', ['Ludmilla'], alvo);
    const validas = rows.filter(
      (r) => r.artistName === 'Ludmilla' && Math.abs(r.duration - alvo) <= 3,
    );
    if (validas.length === 0) {
      expect(escolhida).toBeNull();
      return;
    }
    expect(escolhida).not.toBeNull();
    const comTempo = validas.filter((r) => r.syncedLyrics);
    const universo = comTempo.length > 0 ? comTempo : validas;
    const melhorDif = Math.min(...universo.map((r) => Math.abs(r.duration - alvo)));
    expect(Boolean(escolhida!.syncedLyrics)).toBe(comTempo.length > 0);
    expect(Math.abs(escolhida!.duration! - alvo)).toBe(melhorDif);
  });
});
