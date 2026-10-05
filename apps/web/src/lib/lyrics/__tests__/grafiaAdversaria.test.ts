/**
 * Grafia em entrada adversária: falso positivo em outra língua, letra bilíngue,
 * pontuação/aspas/hífen colados, caixa alta, e a garantia de que a contagem de
 * palavras e os tempos nunca mudam.
 */
import { describe, expect, it } from 'vitest';
import { corrigirGrafia, ehLetraEmPortugues, normalizarLetra } from '@/lib/lyrics/grafia';
import type { Lyrics } from '@/lib/lyrics/lyrics';

const PT = ['não tem pobrema pra você', 'isso é tudo meu'];

const letra = (textos: string[]): Lyrics => ({
  synced: true,
  source: null,
  lines: textos.map((text, i) => ({ timeMs: i * 1000, text })),
});

describe('corrigirGrafia: palavra com vizinhança difícil', () => {
  it.each([
    ['"nois" disse', '"nós" disse'], // aspas duplas
    ["'nois' disse", "'nós' disse"], // aspas simples
    ['(nois)', '(nós)'],
    ['nois, mermo.', 'nós, mesmo.'],
    ['nois!!! mermo???', 'nós!!! mesmo???'],
    ['nois...', 'nós...'],
    ['—nois—', '—nós—'], // travessão não é hífen de palavra composta
    ['nois - mermo', 'nós - mesmo'], // hífen com espaços
    ['NOIS VAI', 'NÓS VAI'],
    ['Nois vai', 'Nós vai'],
    ['nOIS vai', 'nós vai'], // caixa estranha: vale a inicial
  ])('%s -> %s', (entrada, saida) => {
    expect(corrigirGrafia(entrada)).toBe(saida);
  });

  it.each(['nois-mermo', "d'nois", 'nois’s'])(
    'forma composta com hífen/apóstrofo fica como veio: %s',
    (t) => {
      expect(corrigirGrafia(t)).toBe(t);
    },
  );

  it('palavra que só CONTÉM uma chave do dicionário não muda', () => {
    expect(corrigirGrafia('noisy dimaiss mermoso')).toBe('noisy dimaiss mermoso');
  });

  it('palavras herdadas do protótipo de Object não viram lixo ("constructor")', () => {
    expect(corrigirGrafia('o constructor e o Constructor')).toBe('o constructor e o Constructor');
    expect(corrigirGrafia('toString valueOf hasOwnProperty')).toBe(
      'toString valueOf hasOwnProperty',
    );
  });

  it('acento decomposto (NFD) é reconhecido como a mesma palavra', () => {
    const nfd = 'nóis vai'; // "nóis" com o acento solto
    expect(corrigirGrafia(nfd)).toBe('nós vai');
  });

  it('linha vazia, só espaço, só pontuação, emoji: intactas', () => {
    for (const t of ['', '   ', '...', '🔥🔥', '♪']) expect(corrigirGrafia(t)).toBe(t);
  });

  it('cabeçalho de seção [Refrão] não é tocado, mas "[nois]" no meio de frase sim', () => {
    expect(corrigirGrafia('[Refrão: Nóis]')).toBe('[Refrão: Nóis]');
    expect(corrigirGrafia('  [Verso 1]  ')).toBe('  [Verso 1]  ');
    expect(corrigirGrafia('eu e [nois] juntos')).toBe('eu e [nós] juntos');
  });

  it('idempotente também em caixa alta e com pontuação', () => {
    const uma = corrigirGrafia('NÓIS, TAMÉM! "ocê" (voce)');
    expect(corrigirGrafia(uma)).toBe(uma);
  });
});

describe('ehLetraEmPortugues: idioma', () => {
  it('inglês e espanhol com palavras do dicionário não contam', () => {
    expect(ehLetraEmPortugues(['ta ta ta', 'memo memo', 'fia fia fia fia'])).toBe(false);
    expect(
      ehLetraEmPortugues([
        'pelo camino de la vida',
        'todo lo que tengo es tuyo',
        'mi amor, mi vida',
      ]),
    ).toBe(false);
  });

  it('bilíngue com o refrão em inglês ainda é português se há prova suficiente', () => {
    const mista = [
      'não tem pobrema pra você',
      'isso é tudo meu',
      'we are the champions',
      'hey hey',
    ];
    expect(ehLetraEmPortugues(mista)).toBe(true);
  });

  it('letra curta demais para ter prova não é corrigida', () => {
    expect(ehLetraEmPortugues(['nois vai'])).toBe(false);
    const curta = letra(['nois vai']);
    expect(normalizarLetra(curta)).toBe(curta);
  });

  it('vazia ou só vazios', () => {
    expect(ehLetraEmPortugues([])).toBe(false);
    expect(ehLetraEmPortugues(['', ' '])).toBe(false);
  });

  it('inglês longo com 3 palavras portuguesas perdidas não passa dos 5%', () => {
    const palavras = Array.from({ length: 200 }, () => 'baby').join(' ');
    expect(ehLetraEmPortugues([palavras, 'não não não'])).toBe(false);
  });
});

describe('normalizarLetra: invariantes', () => {
  it('letra bilíngue: só o português é corrigido, o inglês fica', () => {
    const l = letra([...PT, 'nois vai the memo', 'ta bom, we are the fia']);
    const s = normalizarLetra(l);
    expect(s.lines[2]?.text).toBe('nós vai the mesmo'); // dicionário não distingue por linha
    expect(s.lines[3]?.text).toBe('tá bom, we are the filha');
  });

  it('número de palavras, de linhas e timeMs idênticos, em qualquer caixa', () => {
    const textos = [
      ...PT,
      'NOIS VAMO FAZÊ O MERMO, OCÊ TAMÉM',
      'Nois, vamo - fazê "o" mermo!',
      '',
      '♪',
    ];
    const l = letra(textos);
    const s = normalizarLetra(l);
    expect(s.lines).toHaveLength(l.lines.length);
    s.lines.forEach((linha, i) => {
      const antes = l.lines[i]!;
      expect(linha.timeMs).toBe(antes.timeMs);
      expect(linha.text.split(/\s+/).filter(Boolean)).toHaveLength(
        antes.text.split(/\s+/).filter(Boolean).length,
      );
    });
  });

  it('LRC por palavra: texto das palavras corrigido, tempos e quantidade preservados', () => {
    const l: Lyrics = {
      synced: true,
      source: null,
      lines: [
        {
          timeMs: 1000,
          text: 'nóis não tem pobrema',
          words: [
            { text: 'nóis', timeMs: 1000 },
            { text: 'não', timeMs: 1400 },
            { text: 'tem', timeMs: 1800 },
            { text: 'pobrema', timeMs: 2200 },
          ],
        },
        { timeMs: 3000, text: 'pra você isso é tudo meu' },
      ],
    };
    const s = normalizarLetra(l);
    expect(s.lines[0]?.words?.map((w) => [w.text, w.timeMs])).toEqual([
      ['nós', 1000],
      ['não', 1400],
      ['tem', 1800],
      ['problema', 2200],
    ]);
    expect(l.lines[0]?.words?.[0]?.text).toBe('nóis'); // original intacto
  });

  it('letra vazia ou null devolve o mesmo valor', () => {
    const vazia = letra([]);
    expect(normalizarLetra(vazia)).toBe(vazia);
    expect(normalizarLetra(undefined)).toBeUndefined();
    expect(normalizarLetra(null)).toBeNull();
  });
});
