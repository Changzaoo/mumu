/**
 * A MÁQUINA DE ESTADOS DA CALIBRAÇÃO, COM A REDE DUBLADA (fetch de verdade do
 * recalibrar.ts e do alinhamentoDaBorda.ts; só a resposta é inventada).
 *
 *   borda 200 → aplica, nenhum POST ao importador
 *   borda 404 → importador (POST /alinhar)
 *   borda 403/5xx/rede → para (sem importador)
 *   importador 422 → desiste e NÃO repete o POST no próximo play (6 h)
 *   202 processando → pergunta de novo em 2 s, sem gastar orçamento
 *   202 na-fila / 503 sem-audio → 15 s, gastando orçamento (20 tentativas)
 *   faixa trocou (manterVivo falso) → para
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import type { Lyrics } from '@/lib/lyrics/lyrics';

let emCache: Lyrics | null = null;
const writeLyrics = vi.fn((_id: string, l: Lyrics) => {
  emCache = l;
});
vi.mock('@/lib/lyrics/lyrics', () => ({
  cachedLyrics: () => emCache,
  cachedLyricsFor: () => emCache,
  fetchLyrics: async () => emCache,
  writeLyrics,
  recusarLetra: vi.fn(),
  letrasComOMesmoTitulo: async () => [],
  toLyrics: () => null,
}));
vi.mock('@/lib/local/detalheDaFaixa', () => ({ garantirDetalhe: vi.fn(async () => true) }));
vi.mock('@/lib/local/localLibrary', () => ({
  remoteUrlFor: () => 'https://importer.radinho.test/blob/t1?k=tok',
}));
vi.mock('@/lib/local/importerHelper', () => ({ enviarAprendizadoDeLetra: vi.fn() }));

const BORDA = 'https://musicas.radinho.online/blob/t1/alinhar?k=tok';
const IMPORTADOR_ALINHAR = 'https://importer.radinho.test/blob/t1/alinhar';
const IMPORTADOR_TEMPO = 'https://importer.radinho.test/blob/t1/tempo';

const VERSOS = [
  'Mantém, mantém, que o jogo é nosso',
  'Vem mais, mais vem',
  'Na quebrada o papo é reto',
  'Coração bateu mais forte',
  'Vou subir de nave pra lua cheia',
];
const letra = (): Lyrics => ({
  synced: true,
  source: null,
  lines: VERSOS.map((text, i) => ({ timeMs: 17_000 + i * 4_000, text })),
});
const INTRO = 11_600;
/** Instante REAL de um texto no áudio: o do verso conhecido, ou entre vizinhos. */
const tempoReal = (text: string, i: number): number => {
  const j = VERSOS.indexOf(text);
  if (j >= 0) return 17_000 + INTRO + j * 4_000;
  const k = VERSOS.findIndex((v) => v.toUpperCase().replace(/,/g, '') === text);
  return k >= 0 ? 17_000 + INTRO + k * 4_000 : 17_000 + INTRO + i * 4_000 - 2_000;
};
const linhasDaBorda = (prob = 0.8, textos = VERSOS) => ({
  linhas: textos.map((text, i) => {
    const t = tempoReal(text, i);
    const ws = text.split(' ');
    return {
      text,
      startMs: t,
      endMs: t + ws.length * 300,
      words: ws.map((w, k) => ({ text: w, startMs: t + k * 300, endMs: t + k * 300 + 250, prob })),
    };
  }),
  motor: 'alinhamento-small',
  em: '2026-11-03T12:00:00Z',
});

const faixa = (): TrackDto =>
  ({
    id: 't1',
    title: 'Mantém',
    durationMs: 206_000,
    artists: [{ id: 'a', name: 'Matuê', slug: 'matue', imageUrl: null }],
    album: null,
    streamUrl: null,
  }) as unknown as TrackDto;

type Resposta = { status: number; corpo?: unknown } | 'rede';
/** Fila de respostas por destino; a última se repete. */
let roteiro: Record<'borda' | 'alinhar' | 'tempo', Resposta[]>;
let chamadas: Array<{ destino: string; metodo: string; corpo?: string; em: number }>;

function responder(fila: Resposta[]): Response {
  const r = fila.length > 1 ? fila.shift()! : fila[0]!;
  if (r === 'rede') throw new TypeError('Failed to fetch');
  return new Response(r.corpo === undefined ? '' : JSON.stringify(r.corpo), { status: r.status });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  window.localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  emCache = letra();
  writeLyrics.mockClear();
  chamadas = [];
  roteiro = { borda: [{ status: 404 }], alinhar: [{ status: 422 }], tempo: [{ status: 422 }] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const destino = url.startsWith('https://musicas.radinho.online')
        ? 'borda'
        : url.startsWith(IMPORTADOR_ALINHAR)
          ? 'alinhar'
          : url.startsWith(IMPORTADOR_TEMPO)
            ? 'tempo'
            : 'outro';
      chamadas.push({
        destino,
        metodo: init?.method ?? 'GET',
        corpo: typeof init?.body === 'string' ? init.body : undefined,
        em: Date.now(),
      });
      if (destino === 'outro') return new Response('', { status: 404 });
      return responder(roteiro[destino as keyof typeof roteiro]);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const conta = (destino: string) => chamadas.filter((c) => c.destino === destino).length;

/** Começa a calibração com o módulo JÁ carregado (o import é E/S de verdade). */
async function iniciar(
  manterVivo: () => boolean = () => true,
): Promise<{ promessa: Promise<Lyrics | null> }> {
  const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
  return { promessa: pedirCalibracao(faixa(), manterVivo) };
}

async function calibrar(manterVivo: () => boolean = () => true) {
  const { promessa } = await iniciar(manterVivo);
  await vi.advanceTimersByTimeAsync(0);
  return promessa;
}

describe('a borda vem primeiro', () => {
  it('borda 200: letra no relógio do áudio, carimbada, e NENHUM POST ao importador', async () => {
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.8) }];
    const r = await calibrar();
    expect(chamadas.map((c) => `${c.metodo} ${c.destino}`)).toEqual(['GET borda']);
    expect(chamadas[0]).toMatchObject({ destino: 'borda' });
    expect(r?.lines.map((l) => l.timeMs)).toEqual(VERSOS.map((_, i) => 17_000 + INTRO + i * 4_000));
    expect(r).toMatchObject({ calibrada: true, selada: true });
    expect(writeLyrics).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ selada: true }),
      expect.anything(),
    );
  });

  it('a URL da borda é a remoteUrl com a origem trocada e /alinhar', async () => {
    await calibrar();
    const { calls } = vi.mocked(fetch).mock;
    expect(String(calls[0]![0])).toBe(BORDA);
  });

  it.each([
    ['grafia diferente', VERSOS.map((v) => v.toUpperCase().replace(/,/g, ''))],
    ['uma linha a mais na borda', [...VERSOS.slice(0, 2), 'Yeah yeah', ...VERSOS.slice(2)]],
  ])('borda com %s ainda casa pelo texto', async (_n, textos) => {
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.8, textos) }];
    const r = await calibrar();
    expect(conta('alinhar')).toBe(0);
    expect(r?.lines.map((l) => l.text)).toEqual(VERSOS);
    expect(r?.lines[0]!.timeMs).toBe(17_000 + INTRO);
  });

  it('borda 200 com uma linha a MENOS: calibra, mas sem carimbo se a cobertura cai', async () => {
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.8, VERSOS.slice(0, 3)) }];
    const r = await calibrar();
    expect(r).toMatchObject({ calibrada: true });
    expect(r?.selada).toBeUndefined();
  });

  it('borda 200 com letra de OUTRA música: cai para o importador', async () => {
    roteiro.borda = [
      {
        status: 200,
        corpo: linhasDaBorda(0.9, ['I keep running', 'Hold me', 'Baby', 'Night', 'Free']),
      },
    ];
    await calibrar();
    expect(conta('alinhar')).toBe(1);
  });

  it('borda 200 com confiança baixa: vira suspeita e vai à voz (tempo 422 → fica, sem carimbo)', async () => {
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.35) }];
    const r = await calibrar();
    expect(conta('tempo')).toBe(1);
    expect(conta('alinhar')).toBe(0);
    expect(r).toMatchObject({ calibrada: true });
    expect(r?.selada).toBeUndefined();
  });

  it.each([
    [{ status: 403 }],
    [{ status: 500 }],
    [{ status: 502 }],
    ['rede' as const],
    [{ status: 200, corpo: { linhas: [] } }],
  ])('borda com erro %j: para, sem importador', async (resposta) => {
    roteiro.borda = [resposta];
    expect(await calibrar()).toBeNull();
    expect(conta('alinhar')).toBe(0);
    expect(conta('tempo')).toBe(0);
  });

  it('borda 404 → importador; no próximo play a borda não é perguntada de novo (1 h)', async () => {
    roteiro.alinhar = [{ status: 422 }];
    await calibrar();
    expect(conta('borda')).toBe(1);
    expect(conta('alinhar')).toBe(1);
    await calibrar();
    expect(conta('borda')).toBe(1);
    vi.setSystemTime(new Date('2026-11-03T13:00:01Z'));
    await calibrar();
    expect(conta('borda')).toBe(2);
  });

  it('sem letra nenhuma: a borda traz texto e relógio (confiança de carimbo)', async () => {
    emCache = null;
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.8) }];
    const r = await calibrar();
    expect(r?.lines.map((l) => l.text)).toEqual(VERSOS);
    expect(r?.lines[1]!.timeMs).toBe(21_000 + INTRO);
    expect(conta('tempo')).toBe(0);
  });

  it('sem letra e borda com confiança baixa: não inventa, vai à transcrição', async () => {
    emCache = null;
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.4) }];
    expect(await calibrar()).toBeNull();
    expect(conta('tempo')).toBe(1);
  });
});

describe('importador: 422 não repete o POST', () => {
  it.each([422, 400, 403, 404, 410])(
    '%i: desiste, e o próximo play nem pergunta',
    async (status) => {
      roteiro.alinhar = [{ status }];
      expect(await calibrar()).toBeNull();
      expect(conta('alinhar')).toBe(1);
      for (let i = 0; i < 5; i += 1) await calibrar();
      expect(conta('alinhar')).toBe(1);
    },
  );

  it('a desistência sobrevive à recarga (localStorage) e vence em 6 h', async () => {
    await calibrar();
    vi.resetModules();
    await calibrar();
    expect(conta('alinhar')).toBe(1);
    vi.setSystemTime(new Date('2026-11-03T18:00:01Z'));
    await calibrar();
    expect(conta('alinhar')).toBe(2);
  });

  it.each([500, 502])('%i é soluço: o próximo play pergunta de novo', async (status) => {
    roteiro.alinhar = [{ status }];
    await calibrar();
    await calibrar();
    expect(conta('alinhar')).toBe(2);
  });

  it('sem letra: /tempo 422 também não repete', async () => {
    emCache = null;
    await calibrar();
    await calibrar();
    await calibrar();
    expect(conta('tempo')).toBe(1);
  });

  it('o corpo do POST leva as linhas cantadas da letra', async () => {
    await calibrar();
    const post = chamadas.find((c) => c.destino === 'alinhar')!;
    expect(post.metodo).toBe('POST');
    expect(JSON.parse(post.corpo!)).toEqual({ linhas: VERSOS });
  });
});

describe('importador: ritmo das perguntas', () => {
  const pronto = { status: 200, corpo: linhasDaBorda(0.8) };

  it('202 processando: de 2 em 2 s, sem gastar orçamento', async () => {
    roteiro.alinhar = [
      ...Array.from({ length: 30 }, () => ({ status: 202, corpo: { status: 'processando' } })),
      pronto,
    ];
    const { promessa: p } = await iniciar();
    await vi.advanceTimersByTimeAsync(2_000 * 31);
    const r = await p;
    expect(r).toMatchObject({ calibrada: true });
    expect(conta('alinhar')).toBe(31);
    const tempos = chamadas.filter((c) => c.destino === 'alinhar').map((c) => c.em);
    expect(tempos[1]! - tempos[0]!).toBe(2_000);
  });

  it('202 na-fila: de 15 em 15 s', async () => {
    roteiro.alinhar = [
      { status: 202, corpo: { status: 'na-fila' } },
      { status: 202, corpo: { status: 'na-fila' } },
      pronto,
    ];
    const { promessa: p } = await iniciar();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(conta('alinhar')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(conta('alinhar')).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toMatchObject({ calibrada: true });
  });

  it.each([
    ['503 sem-audio', { status: 503, corpo: { status: 'sem-audio' } }],
    ['202 na-fila', { status: 202, corpo: { status: 'na-fila' } }],
    ['rede caída', 'rede' as const],
  ])('%s: orçamento de 20 tentativas e desiste', async (_n, resposta) => {
    roteiro.alinhar = [resposta];
    const { promessa: p } = await iniciar();
    await vi.advanceTimersByTimeAsync(15_000 * 25);
    expect(await p).toBeNull();
    expect(conta('alinhar')).toBe(20);
  });

  it('a faixa mudou no meio: para sem mais uma pergunta', async () => {
    roteiro.alinhar = [{ status: 202, corpo: { status: 'na-fila' } }];
    let viva = true;
    const { promessa: p } = await iniciar(() => viva);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(conta('alinhar')).toBe(2);
    viva = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toBeNull();
    expect(conta('alinhar')).toBe(2);
  });

  it('faixa já trocada antes de começar: nem a borda é perguntada depois do detalhe', async () => {
    expect(await calibrar(() => false)).toBeNull();
    expect(conta('alinhar')).toBe(0);
  });

  it('importador devolve com texto e contagem diferente (stable-ts juntou dois segmentos): casa pelo texto', async () => {
    const base = linhasDaBorda(0.8);
    const juntas = {
      linhas: [
        base.linhas[0],
        {
          ...base.linhas[1]!,
          text: `${base.linhas[1]!.text} ${base.linhas[2]!.text}`,
          words: [...base.linhas[1]!.words, ...base.linhas[2]!.words],
        },
        ...base.linhas.slice(3),
      ],
    };
    roteiro.alinhar = [{ status: 200, corpo: juntas }];
    const r = await calibrar();
    expect(r).not.toBeNull();
    expect(r?.lines[0]!.timeMs).toBe(17_000 + INTRO);
    expect(r?.lines[4]!.timeMs).toBe(33_000 + INTRO);
  });

  it('dois pedidos da mesma faixa ao mesmo tempo: um laço só', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    roteiro.borda = [{ status: 200, corpo: linhasDaBorda(0.8) }];
    const a = pedirCalibracao(faixa());
    const b = pedirCalibracao(faixa());
    expect(a).toBe(b);
    await a;
    expect(conta('borda')).toBe(1);
  });
});
