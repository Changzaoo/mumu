/** Matriz borda x origem do veredito de uma cópia /blob/. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, unknown> = {};
vi.mock('../config/index.js', () => ({ env }));

const { vereditoDaCopia, urlNaBorda, vereditoDeStatus, lerBordaDepoisOrigem } =
  await import('./copiaViva.js');

const BORDA = 'https://musicas.radinho.online';
const REMOTE = 'https://importer.radinho.online/blob/local%3Aabc-123?k=tok';
const NA_BORDA = `${BORDA}/blob/local%3Aabc-123?k=tok`;

type Resp = number | 'erro' | 'timeout';
const RESPOSTAS: Resp[] = [
  200,
  206,
  301,
  302,
  403,
  404,
  416,
  429,
  500,
  502,
  503,
  'erro',
  'timeout',
];

function esperado(borda: Resp, origem: Resp): 'viva' | 'morta' | 'incerta' {
  const v = (r: Resp) => (typeof r === 'number' ? vereditoDeStatus(r) : 'incerta');
  const b = v(borda);
  if (b === 'viva') return 'viva';
  if (b === 'incerta') return 'incerta';
  return v(origem);
}

let chamadas: string[] = [];
function dubla(tabela: { borda: Resp; origem: Resp }) {
  chamadas = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      chamadas.push(url);
      const r = url.startsWith(BORDA) ? tabela.borda : tabela.origem;
      if (r === 'erro') throw new TypeError('fetch failed');
      if (r === 'timeout') {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return new Response(null, { status: r });
    }),
  );
}

beforeEach(() => {
  env.AUDIO_BORDA_URL = BORDA;
});
afterEach(() => vi.unstubAllGlobals());

describe('matriz borda x origem', () => {
  const casos = RESPOSTAS.flatMap((b) => RESPOSTAS.map((o) => [b, o] as const));
  it.each(casos)('borda=%s origem=%s', async (b, o) => {
    dubla({ borda: b, origem: o });
    const v = await vereditoDaCopia(REMOTE);
    expect(v).toBe(esperado(b, o));
    // a origem só é consultada quando a borda disse 404
    expect(chamadas.includes(REMOTE)).toBe(b === 404);
    expect(chamadas[0]).toBe(NA_BORDA);
  });

  it('"morta" só com 404 nas duas', async () => {
    let mortas = 0;
    for (const b of RESPOSTAS)
      for (const o of RESPOSTAS) {
        dubla({ borda: b, origem: o });
        if ((await vereditoDaCopia(REMOTE)) === 'morta') {
          mortas++;
          expect([b, o]).toEqual([404, 404]);
        }
      }
    expect(mortas).toBe(1);
  });
});

describe('sem borda', () => {
  it('AUDIO_BORDA_URL vazio: só a origem', async () => {
    env.AUDIO_BORDA_URL = '';
    dubla({ borda: 200, origem: 404 });
    expect(await vereditoDaCopia(REMOTE)).toBe('morta');
    expect(chamadas).toEqual([REMOTE]);
  });
  it('URL que não é /blob/ com k: só a origem', async () => {
    for (const u of [
      'https://importer.radinho.online/outra/coisa?k=x',
      'https://importer.radinho.online/blob/id',
      'https://importer.radinho.online/blob/?k=x',
    ]) {
      dubla({ borda: 200, origem: 206 });
      expect(await vereditoDaCopia(u)).toBe('viva');
      expect(chamadas).toEqual([u]);
    }
  });
  it('URL já da borda não pergunta duas vezes', async () => {
    dubla({ borda: 404, origem: 200 });
    expect(await vereditoDaCopia(NA_BORDA)).toBe('morta');
    expect(chamadas).toEqual([NA_BORDA]);
  });
  it('borda desligada e origem null: incerta', async () => {
    env.AUDIO_BORDA_URL = undefined;
    expect(await lerBordaDepoisOrigem(REMOTE, null, async () => 'morta')).toBe('incerta');
  });
});

describe('urlNaBorda', () => {
  it('mantém o id codificado e repassa o k', () => {
    expect(urlNaBorda(REMOTE)).toBe(NA_BORDA);
  });
  it('borda com barra final é normalizada', () => {
    env.AUDIO_BORDA_URL = `${BORDA}/`;
    expect(urlNaBorda(REMOTE)).toBe(NA_BORDA);
  });
  it('borda inválida ou não http: null', () => {
    for (const v of ['lixo', 'ftp://x', 42]) {
      env.AUDIO_BORDA_URL = v;
      expect(urlNaBorda(REMOTE)).toBeNull();
    }
  });
  it('remoteUrl inválida: null', () => {
    expect(urlNaBorda('nao e url')).toBeNull();
  });
});

describe('vereditoDeStatus', () => {
  it.each([
    [200, 'viva'],
    [206, 'viva'],
    [302, 'viva'],
    [404, 'morta'],
    [403, 'incerta'],
    [416, 'incerta'],
    [429, 'incerta'],
    [500, 'incerta'],
    [503, 'incerta'],
    [0, 'incerta'],
  ])('%s -> %s', (s, v) => expect(vereditoDeStatus(s)).toBe(v));
});
