/**
 * A BORDA SERVE O RELÓGIO JÁ CALCULADO — e o aparelho casa as linhas pelo TEXTO.
 *
 * O texto da borda pode ser de outra linha do LRCLIB (outra grafia, uma linha a
 * mais ou a menos). Fetch dublado em tudo: nada aqui sai para a rede.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BORDA_DOS_ALINHAMENTOS,
  alinhadasParaAsLinhas,
  buscarAlinhamentoNaBorda,
  casarLinhasPorTexto,
  confiancaDasCasadas,
  lerLinhasDaBorda,
  urlDoAlinhamentoNaBorda,
  type LinhaDaBorda,
} from '@/lib/lyrics/alinhamentoDaBorda';
import { aplicarAlinhamento, linhasParaAlinhar } from '@/lib/lyrics/recalibrar';
import type { Lyrics } from '@/lib/lyrics/lyrics';

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

const VERSOS = [
  'Eu tô de volta com a mente de um chefe',
  'Basta o meu verso e ela se derrete',
  'Descarrego minha raiva no teclado',
  'Mantém, mantém, que o jogo é nosso',
  'Na quebrada o papo é reto',
  'Coração bateu mais forte',
  'Mantém, mantém, que o jogo é nosso',
  'Vou subir de nave pra lua cheia',
  'Minha mãe falou: meu filho, vai com calma',
  'O bonde tá formado e ninguém segura',
];

const linhaDaBorda = (text: string, startMs: number, prob = 0.8): LinhaDaBorda => {
  const ws = text.split(/\s+/).filter(Boolean);
  return {
    text,
    startMs,
    endMs: startMs + ws.length * 300,
    words: ws.map((w, k) => ({
      text: w,
      startMs: startMs + k * 300,
      endMs: startMs + k * 300 + 250,
      prob,
    })),
  };
};

describe('urlDoAlinhamentoNaBorda', () => {
  const so = (lista: string[]) => () => lista;
  it.each([
    [
      'https://importer.radinho.online/blob/abc123?k=tok',
      [
        `${BORDA_DOS_ALINHAMENTOS}/blob/abc123?k=tok`,
        'https://importer.radinho.online/blob/abc123?k=tok',
      ],
      `${BORDA_DOS_ALINHAMENTOS}/blob/abc123/alinhar?k=tok`,
    ],
    [
      'https://importer.x/blob/a%20b?k=t%2Fk',
      ['https://importer.x/blob/a%20b?k=t%2Fk'],
      `${BORDA_DOS_ALINHAMENTOS}/blob/a%20b/alinhar?k=t%2Fk`,
    ],
    [
      'https://importer.x/blob/id?k=tok',
      [
        'https://outra-borda.x/blob/id?k=tok',
        `${BORDA_DOS_ALINHAMENTOS}/blob/id?k=tok`,
        'https://importer.x/blob/id?k=tok',
      ],
      `${BORDA_DOS_ALINHAMENTOS}/blob/id/alinhar?k=tok`,
    ],
    [
      'https://importer.x/blob/id?k=tok',
      ['https://outra-borda.x/blob/id?k=tok', 'https://importer.x/blob/id?k=tok'],
      'https://outra-borda.x/blob/id/alinhar?k=tok',
    ],
    [
      `${BORDA_DOS_ALINHAMENTOS}/blob/id?k=tok`,
      [`${BORDA_DOS_ALINHAMENTOS}/blob/id?k=tok`],
      `${BORDA_DOS_ALINHAMENTOS}/blob/id/alinhar?k=tok`,
    ],
  ])('%s', (remota, candidatos, esperada) => {
    expect(urlDoAlinhamentoNaBorda(remota, so(candidatos))).toBe(esperada);
  });
  it.each([
    'https://importer.x/blob/id',
    'https://importer.x/blob/id/tempo?k=x',
    'https://audius.co/track/1?k=x',
    'não é url',
    '',
  ])('não é cópia do cofre com k: %j', (u) => {
    expect(urlDoAlinhamentoNaBorda(u, () => [u])).toBeNull();
  });
  it('padrão (cdn.ts real): troca a origem e acrescenta /alinhar', () => {
    expect(urlDoAlinhamentoNaBorda('https://importer.x/blob/id?k=tok')).toBe(
      `${BORDA_DOS_ALINHAMENTOS}/blob/id/alinhar?k=tok`,
    );
  });
});

describe('buscarAlinhamentoNaBorda (fetch dublado)', () => {
  const resposta = (status: number, corpo?: unknown) =>
    vi.fn(
      async () => new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status }),
    ) as unknown as typeof fetch;
  it('200 com linhas: pronto', async () => {
    const r = await buscarAlinhamentoNaBorda(
      'u',
      resposta(200, { linhas: [linhaDaBorda('a b', 1000)], motor: 'alinhamento-small', em: 'x' }),
    );
    expect(r.tipo).toBe('pronto');
  });
  it.each([
    [404, undefined, 'nao-tem'],
    [403, { error: 'k' }, 'erro'],
    [500, undefined, 'erro'],
    [502, undefined, 'erro'],
    [200, { linhas: [] }, 'erro'],
    [200, { nada: 1 }, 'erro'],
    [200, 'lixo', 'erro'],
  ] as const)('status %i → %s', async (status, corpo, tipo) => {
    expect((await buscarAlinhamentoNaBorda('u', resposta(status, corpo))).tipo).toBe(tipo);
  });
  it('rede caída: erro, nunca lança', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await buscarAlinhamentoNaBorda('u', f)).toEqual({ tipo: 'erro' });
  });
  it('lerLinhasDaBorda tira palavra torta, prende prob em 0–1', () => {
    const l = lerLinhasDaBorda({
      linhas: [
        {
          text: 'a',
          startMs: 10,
          endMs: 20,
          words: [{ text: 'a', startMs: 10, prob: 7 }, { startMs: 1 }, null],
        },
        { text: 'b', startMs: -5 },
        'lixo',
        { text: 'c', startMs: 30 },
      ],
    })!;
    expect(l).toHaveLength(2);
    expect(l[0]!.words).toEqual([{ text: 'a', startMs: 10, endMs: 10, prob: 1 }]);
    expect(l[1]).toEqual({ text: 'c', startMs: 30, endMs: 30, words: [] });
  });
});

describe('casarLinhasPorTexto: outra grafia, linhas faltando, refrão repetido', () => {
  it('mesmo texto, sem acento e caixa: casa 1 para 1', () => {
    const borda = VERSOS.map((v) => v.toUpperCase().normalize('NFD').replace(/\p{M}/gu, ''));
    expect(casarLinhasPorTexto(VERSOS, borda)).toEqual(VERSOS.map((_, i) => i));
  });
  it('refrão repetido casa com a repetição CERTA (ordem preservada)', () => {
    const par = casarLinhasPorTexto(VERSOS, VERSOS);
    expect(par[3]).toBe(3);
    expect(par[6]).toBe(6);
  });
  it('linha a mais na borda e linha a menos no aparelho', () => {
    const borda = [...VERSOS.slice(0, 2), 'Yeah, yeah (ad-lib)', ...VERSOS.slice(2)];
    const aparelho = VERSOS.filter((_, i) => i !== 5);
    const par = casarLinhasPorTexto(aparelho, borda);
    expect(par).toEqual([0, 1, 3, 4, 5, 7, 8, 9, 10]);
  });
  it('outra letra: quase nada casa', () => {
    const outra = ['I keep running through the night', 'Never let me go tonight', 'Hold me close'];
    expect(casarLinhasPorTexto(VERSOS, outra).every((j) => j === -1)).toBe(true);
  });
  it('vazios não lançam', () => {
    expect(casarLinhasPorTexto([], ['a'])).toEqual([]);
    expect(casarLinhasPorTexto(['a'], [])).toEqual([-1]);
  });

  const rand = prng(2026);
  const casos = Array.from({ length: 30 }, (_, k) => ({
    k,
    remover: rand() * 0.3,
    inserir: rand() * 0.3,
    grafia: rand() < 0.5,
  }));
  it.each(casos)(
    'gerado $k: o par nunca cruza e casa só linha parecida',
    ({ remover, inserir, grafia }) => {
      const r = prng(Math.floor(remover * 1e6));
      const aparelho = VERSOS.filter(() => r() > remover);
      const borda: string[] = [];
      for (const v of VERSOS) {
        if (r() < inserir) borda.push('ô ô ô');
        borda.push(grafia ? v.replace(/tô/g, 'to').replace(/,/g, '') : v);
      }
      const par = casarLinhasPorTexto(aparelho, borda);
      let ultimo = -1;
      par.forEach((j, i) => {
        if (j < 0) return;
        expect(j).toBeGreaterThan(ultimo);
        ultimo = j;
        const primeira = (t: string) =>
          t
            .toLowerCase()
            .replace(/tô/g, 'to')
            .replace(/[^\p{L}\p{N} ]/gu, '')
            .split(' ')[0];
        expect(primeira(borda[j]!)).toBe(primeira(aparelho[i]!));
      });
      // toda linha que existe dos dois lados acha par
      expect(par.filter((j) => j >= 0).length).toBe(aparelho.length);
    },
  );
});

describe('alinhadasParaAsLinhas + aplicarAlinhamento: a letra no relógio da borda', () => {
  const rand = prng(404);
  const casos = Array.from({ length: 20 }, (_, k) => ({
    k,
    intro: Math.floor(rand() * 15_000) * (rand() < 0.5 ? -1 : 1),
    faltam: Math.floor(rand() * 3),
  }));
  it.each(casos)(
    'gerado $k: intro $intro, $faltam linha(s) a menos na borda',
    ({ intro, faltam }) => {
      const lrc = VERSOS.map((_, i) => 20_000 + i * 4_000);
      const verdade = lrc.map((t) => t + intro);
      const letra: Lyrics = {
        synced: true,
        source: null,
        lines: VERSOS.map((text, i) => ({ timeMs: lrc[i]!, text })),
      };
      const fora = new Set(Array.from({ length: faltam }, (_, i) => 1 + i * 3));
      const borda = VERSOS.flatMap((v, i) => (fora.has(i) ? [] : [linhaDaBorda(v, verdade[i]!)]));
      const indices = linhasParaAlinhar(letra);
      const textos = indices.map((i) => letra.lines[i]!.text);
      const { linhas, casadas } = alinhadasParaAsLinhas(textos, borda);
      expect(casadas).toBe(VERSOS.length - faltam);
      expect(confiancaDasCasadas(linhas)).toBeCloseTo(0.8, 5);
      const r = aplicarAlinhamento(letra, indices, linhas)!;
      expect(r).not.toBeNull();
      r.lines.forEach((l, i) => {
        // casada: exata; sem par: interpolada entre as vizinhas (intro fixa = exata também)
        expect(Math.abs(l.timeMs - verdade[i]!)).toBeLessThanOrEqual(1);
        expect(l.text).toBe(VERSOS[i]);
      });
    },
  );
  it('confiancaDasCasadas sem nenhuma casada é 0', () => {
    expect(confiancaDasCasadas([{ startMs: 0, endMs: 0, words: [] }])).toBe(0);
  });
});
