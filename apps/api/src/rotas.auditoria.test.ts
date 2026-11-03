/**
 * AUDITORIA DE ROTAS DA API - matriz gerada a partir das rotas REGISTRADAS.
 *
 * Em vez de listar a mao o que testar, o teste percorre a pilha do router do
 * Express 5 (rotas.enumerar.ts) e dispara contra CADA (metodo, caminho):
 *   a) sem conta            -> nunca 5xx; rota com `requireAuth` responde 401
 *   b) usuario e ADMIN      -> nunca 5xx; papel insuficiente responde 403
 *   c) ids hostis           -> nunca 5xx (400/404/422)
 *   d) corpos invalidos     -> JSON quebrado 400, > 1 MB 413, tipos errados < 500
 *   e) metodo errado        -> 404 (a API nao usa 405)
 *   f) CORS                 -> origem da lista passa, as de fora nao recebem o cabecalho
 *   g) Content-Type         -> JSON em toda resposta de dados/erro
 *   h) leituras abertas     -> 200 com Prisma dublado
 *
 * Uma rota nova sem prefixo em rotas.montagens.ts ou sem decisao em
 * `PUBLICAS` derruba o teste: a politica de quem precisa de conta fica
 * explicita aqui, nao escondida em cada arquivo de rotas.
 *
 * Prisma/Redis/Firebase/fetch entram DUBLADOS (nada de rede, nada de banco).
 * AUDITORIA_SAIDA=<arquivo.json> grava a matriz observada para o relatorio.
 */
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['WEB_ORIGIN'] =
  'https://radinho.online,https://www.radinho.online,http://localhost:5173';

const usuarios = vi.hoisted(() => {
  const linha = (id: string, role: string) => ({
    id,
    firebaseUid: `uid-${id}`,
    email: `${id}@exemplo.test`,
    handle: id,
    displayName: id,
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    isPremium: false,
    role,
    isBanned: false,
    bannedUntil: null,
    banReason: null,
    lastSeenAt: new Date(),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { followers: 0, following: 0 },
  });
  return { 'uid-comum': linha('comum', 'USER'), 'uid-admin': linha('admin', 'ADMIN') } as Record<
    string,
    unknown
  >;
});

/**
 * Prisma "bonzinho": qualquer modelo, qualquer metodo, com o resultado vazio
 * que o metodo real devolveria. E o cenario em que o banco esta de pe e vazio -
 * o que sobra a testar e a decisao da rota.
 */
const banco = vi.hoisted(() => {
  const vazio = (metodo: string): unknown => {
    if (metodo === 'findMany' || metodo === 'groupBy') return [];
    if (metodo === 'count') return 0;
    if (metodo === 'aggregate')
      return { _count: { _all: 0 }, _sum: {}, _avg: {}, _max: {}, _min: {} };
    if (metodo === 'findUnique' || metodo === 'findFirst') return null;
    if (/OrThrow$/.test(metodo)) return {};
    if (/^(create|update|upsert|delete)$/.test(metodo)) return { id: 'mock-id' };
    if (/Many$/.test(metodo)) return { count: 0 };
    return null;
  };
  const modelo = (nomeModelo: string) =>
    new Proxy(
      {},
      {
        get: (_t, metodo: string) => {
          if (metodo === 'then') return undefined;
          return (args?: { where?: { firebaseUid?: string; id?: string }; data?: object }) => {
            if (metodo === 'findUnique' && args?.where?.firebaseUid)
              return Promise.resolve(usuarios[args.where.firebaseUid] ?? null);
            if (nomeModelo === 'user') {
              const linha = Object.values(usuarios).find(
                (u) => (u as { id: string }).id === args?.where?.id,
              );
              if (/^find(Unique|First)(OrThrow)?$/.test(metodo) && linha)
                return Promise.resolve(linha);
              if (/^(update|create|upsert)$/.test(metodo))
                return Promise.resolve({
                  ...(linha ?? (usuarios['uid-comum'] as object)),
                  ...(args?.data ?? {}),
                });
            }
            return Promise.resolve(vazio(metodo));
          };
        },
      },
    );
  const modelos = new Map<string, unknown>();
  const raiz: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get: (_t, nome: string) => {
      if (nome === 'then') return undefined;
      if (nome === '$transaction')
        return (a: unknown) =>
          typeof a === 'function'
            ? (a as (p: unknown) => unknown)(raiz)
            : Promise.all(a as unknown[]);
      if (nome.startsWith('$')) return () => Promise.resolve([]);
      if (!modelos.has(nome)) modelos.set(nome, modelo(nome));
      return modelos.get(nome);
    },
  });
  return raiz;
});

const identidade = vi.hoisted(() => ({
  verifyIdToken: vi.fn(async (token: string) => {
    if (token === 'comum' || token === 'admin')
      return { uid: `uid-${token}`, email: `${token}@exemplo.test`, name: null, picture: null };
    throw Object.assign(new Error('token invalido'), { status: 401, code: 'UNAUTHORIZED' });
  }),
}));

const redisFalso = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  scan: vi.fn().mockResolvedValue(['0', []]),
  call: vi.fn().mockResolvedValue('0'.repeat(40)),
  on: vi.fn(),
}));

vi.mock('./infra/redis/redis.js', () => ({
  redis: redisFalso,
  createBullConnection: () => redisFalso,
  createSubscriber: () => redisFalso,
}));
// BullMQ abriria conexao propria com o Redis: as filas viram dubles que respondem vazio
vi.mock('./infra/queue/queues.js', () => {
  const fila = new Proxy(
    {},
    {
      get: (_t, m: string) =>
        m === 'then'
          ? undefined
          : async () => (/^get(Job)?Counts$/.test(m) ? {} : m === 'add' ? { id: 'job-1' } : []),
    },
  );
  const conjunto = new Proxy({}, { get: (_t, m: string) => (m === 'then' ? undefined : fila) });
  const nada = async () => undefined;
  return {
    getQueues: () => conjunto,
    QUEUE_NAMES: {},
    REALTIME_NOTIFY_CHANNEL: 'realtime:notify',
    closeQueues: nada,
    enqueueAudioProcess: nada,
    enqueueImportSync: nada,
    enqueueLinkImport: nada,
    enqueueNotification: nada,
    enqueueLyricSync: nada,
  };
});
vi.mock('./infra/db/prisma.js', () => ({ prisma: banco }));
vi.mock('./infra/firebase/firebase.js', () => ({
  verifyIdToken: identidade.verifyIdToken,
  isFirebaseEnabled: () => true,
  getFirebaseApp: () => ({}),
}));

const { createApp } = await import('./app.js');
const { enumerarRotas } = await import('./rotas.enumerar.js');
const { montagens } = await import('./rotas.montagens.js');
const { webOrigins } = await import('./config/index.js');
const { errorHandler } = await import('./middlewares/errorHandler.js');

const app = createApp();
const { rotas, desconhecidas } = enumerarRotas(app, montagens);

// -- politica declarada -------------------------------------------------------

/**
 * Rotas SEM `requireAuth` (a leitura e aberta, ou a regra mora no controller).
 * Toda rota fora desta lista PRECISA ter `requireAuth` na pilha.
 */
const PUBLICAS = new Set([
  'GET /healthz',
  'GET /api/docs/openapi.json',
  'GET /api/v1/users/:id',
  'GET /api/v1/users/:id/playlists',
  'GET /api/v1/artists',
  'GET /api/v1/artists/:id',
  'GET /api/v1/artists/:id/top-tracks',
  'GET /api/v1/artists/:id/albums',
  'GET /api/v1/artists/:id/related',
  'GET /api/v1/albums/new-releases',
  'GET /api/v1/albums',
  'GET /api/v1/albums/:id',
  'GET /api/v1/tracks/:id',
  'GET /api/v1/tracks/:id/waveform',
  'GET /api/v1/tracks/:id/lyrics',
  'GET /api/v1/tracks/:id/comments',
  'GET /api/v1/playlists/:id',
  'GET /api/v1/search',
  'GET /api/v1/search/suggest',
  'GET /api/v1/stream/:trackId/manifest.m3u8',
  'GET /api/v1/stream/:trackId/:quality/:file',
  'GET /api/v1/podcasts',
  'GET /api/v1/podcasts/:id',
  'GET /api/v1/podcasts/:id/episodes',
  'GET /api/v1/radios',
  'GET /api/v1/radios/agora/:estacao',
  'GET /api/v1/radios/:id',
  'GET /api/v1/recs/mood/:mood',
  'GET /api/v1/recs/track-radio/:trackId',
  'GET /api/v1/underground/artists',
  'GET /api/v1/underground/artists/search',
  'GET /api/v1/underground/tracks',
  'GET /api/v1/underground/genres',
  'GET /api/v1/underground/locations',
  'GET /api/v1/underground/trending',
  'GET /api/v1/em-alta',
  'GET /api/v1/catalogo',
  'GET /api/v1/catalogo/:id',
  'PUT /api/v1/telemetria/:deviceId', // escrita aberta de proposito (visitante conta), com coleira propria
  'GET /api/v1/telemetria', // requireRole('ADMIN') dentro: ver ADMIN_ONLY
  'GET /api/v1/categorias',
  'GET /api/v1/mundo/artista/:nome',
  'GET /api/v1/mundo/avisos',
  'GET /api/v1/mundo/faixa/:id/creditos',
  'GET /api/v1/mundo/artista/:nome/creditos',
  'GET /api/v1/mundo/pessoa/:chave',
  'POST /api/v1/jornada/convite', // quem abre o link ainda nao tem conta
  'GET /api/v1/jornada/convite/:handle',
]);

/** Rotas que exigem papel ADMIN (usuario comum leva 403). */
const ADMIN_ONLY = (r: { metodo: string; caminho: string }): boolean =>
  r.caminho.startsWith('/api/v1/admin/') ||
  (r.metodo === 'GET' && r.caminho === '/api/v1/telemetria') ||
  (r.metodo === 'DELETE' && r.caminho === '/api/v1/catalogo/:id');

/** Rotas cuja resposta nao e o envelope JSON (playlist HLS, binario...). */
const NAO_JSON_OK = (r: { caminho: string }): boolean => r.caminho.startsWith('/api/v1/stream/');

// -- apoio --------------------------------------------------------------------

const VALOR_BASE: Record<string, string> = {
  estacao: '123e4567-e89b-12d3-a456-426614174000',
  deviceId: 'dispositivo-123456',
  nome: 'Artista',
  chave: 'chave-abc',
  handle: 'alguem',
  mood: 'chill',
  quality: '128',
  file: 'seg0.ts',
};
const baseDe = (p: string): string => VALOR_BASE[p] ?? 'x1abc';

function preencher(caminho: string, valor?: (p: string) => string): string {
  return caminho.replace(/:([A-Za-z0-9_]+)/g, (_m, p: string) => (valor ? valor(p) : baseDe(p)));
}

const TOKENS = { visitante: null, comum: 'comum', admin: 'admin' } as const;
type Papel = keyof typeof TOKENS;

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
function chamar(metodo: string, url: string, papel: Papel = 'visitante'): request.Test {
  const req = request(app)[metodo.toLowerCase() as Metodo](url);
  const t = TOKENS[papel];
  if (t) req.set('Authorization', `Bearer ${t}`);
  return req;
}

interface Linha {
  rota: string;
  caso: string;
  status: number;
}
const matriz: Linha[] = [];
function anotar(r: { metodo: string; caminho: string }, caso: string, status: number): void {
  matriz.push({ rota: `${r.metodo} ${r.caminho}`, caso, status });
}

/** Falha interna do servidor = 5xx que NAO seja gateway (502/503/504 = fornecedor externo caiu). */
const semFalhaInterna = (status: number): boolean =>
  status < 500 || [502, 503, 504].includes(status);

const rotaId = (r: { metodo: string; caminho: string }): string => `${r.metodo} ${r.caminho}`;
const comParams = rotas.filter((r) => r.params.length > 0);
const mutaveis = rotas.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.metodo));

beforeAll(() => {
  // nada de rede de verdade: o que depende de fetch ve a rede fora do ar
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed (duble da auditoria)');
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  const saida = process.env['AUDITORIA_SAIDA'];
  if (saida) writeFileSync(saida, JSON.stringify({ rotas, matriz }, null, 1));
  const porStatus = new Map<number, number>();
  for (const l of matriz) porStatus.set(l.status, (porStatus.get(l.status) ?? 0) + 1);
  console.log(
    `[auditoria] ${rotas.length} rotas, ${matriz.length} casos na matriz; status:`,
    [...porStatus.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, n]) => `${s}=${n}`)
      .join(' '),
  );
});

beforeEach(() => {
  redisFalso.get.mockResolvedValue(null);
});

// -- 0. o inventario ----------------------------------------------------------

describe('inventario de rotas', () => {
  it('toda montagem do router e conhecida (rotas.montagens.ts espelha app.ts)', () => {
    expect(desconhecidas).toEqual([]);
  });

  it('ha rotas suficientes e nenhuma duplicata (metodo + caminho)', () => {
    expect(rotas.length).toBeGreaterThan(100);
    const ids = rotas.map(rotaId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a lista PUBLICAS nao tem fantasmas (toda entrada existe)', () => {
    const existentes = new Set(rotas.map(rotaId));
    for (const p of PUBLICAS) expect(existentes.has(p), p).toBe(true);
  });

  it('politica: rota fora de PUBLICAS tem requireAuth na pilha', () => {
    const sem = rotas.filter((r) => !PUBLICAS.has(rotaId(r)) && !r.pilha.includes('requireAuth'));
    expect(sem.map(rotaId)).toEqual([]);
  });

  it('politica: rota em PUBLICAS NAO tem requireAuth (a lista nao envelhece)', () => {
    const sobra = rotas.filter((r) => PUBLICAS.has(rotaId(r)) && r.pilha.includes('requireAuth'));
    expect(sobra.map(rotaId)).toEqual([]);
  });
});

// -- a) sem conta -------------------------------------------------------------

describe('a) visitante (sem Authorization)', () => {
  it.each(rotas.map((r) => [rotaId(r), r] as const))('%s', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho));
    anotar(r, 'visitante', res.status);
    expect(res.status, JSON.stringify(res.body)).satisfy(semFalhaInterna);
    if (!PUBLICAS.has(rotaId(r))) expect(res.status).toBe(401);
    if (ADMIN_ONLY(r)) expect([401, 403]).toContain(res.status);
  });
});

describe('a2) credenciais ruins nunca viram 5xx', () => {
  const amostra = rotas.filter((r) => !PUBLICAS.has(rotaId(r))).slice(0, 12);
  const ruins = [
    'Bearer ',
    'Bearer lixo',
    'Bearer ' + 'a'.repeat(7000),
    'Basic YWJjOjEyMw==',
    'Bearer a b c',
  ];
  it.each(amostra.flatMap((r) => ruins.map((h) => [rotaId(r), h.slice(0, 12), r, h] as const)))(
    '%s com Authorization %s',
    async (_n, _h, r, h) => {
      const res = await chamar(r.metodo, preencher(r.caminho)).set('Authorization', h);
      expect(res.status).satisfy(semFalhaInterna);
      expect([401, 403]).toContain(res.status);
    },
  );
});

// -- b) usuario comum e ADMIN -------------------------------------------------

describe('b) usuario comum', () => {
  it.each(rotas.map((r) => [rotaId(r), r] as const))('%s', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho), 'comum');
    anotar(r, 'comum', res.status);
    expect(res.status, JSON.stringify(res.body)).satisfy(semFalhaInterna);
    if (ADMIN_ONLY(r)) expect(res.status).toBe(403);
  });
});

describe('b) ADMIN', () => {
  it.each(rotas.map((r) => [rotaId(r), r] as const))('%s', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho), 'admin');
    anotar(r, 'admin', res.status);
    expect(res.status, JSON.stringify(res.body)).satisfy(semFalhaInterna);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// -- c) ids hostis ------------------------------------------------------------

const IDS_HOSTIS: Array<[string, string]> = [
  ['x', 'x'],
  ['ponto-ponto', '..'],
  ['traversal-codificado', '..%2F..%2Fetc%2Fpasswd'],
  ['nulo', 'a%00b'],
  ['5000-chars', 'a'.repeat(5000)],
  ['sql', encodeURIComponent("1' OR '1'='1; DROP TABLE users;--")],
  ['percent-quebrado', '%E0%A4%A'],
  ['unicode', encodeURIComponent('‮\u0000\u{1F600}'.repeat(3))],
];

describe('c) ids hostis (ADMIN: passa da porta e chega na validacao)', () => {
  const casos = comParams.flatMap((r) => IDS_HOSTIS.map(([n, v]) => [rotaId(r), n, r, v] as const));
  it.each(casos)('%s com id %s', async (_n, nome, r, valor) => {
    const url = preencher(r.caminho, () => valor);
    const res = await chamar(r.metodo, url, 'admin');
    anotar(r, `id:${nome}`, res.status);
    expect(res.status, `${url.slice(0, 120)} -> ${JSON.stringify(res.body).slice(0, 200)}`).satisfy(
      semFalhaInterna,
    );
    if (nome === 'percent-quebrado' || nome === 'nulo') expect(res.status).toBe(400);
  });
});

// -- d) corpos invalidos ------------------------------------------------------

const CAMPOS = [
  'title',
  'name',
  'displayName',
  'handle',
  'bio',
  'email',
  'url',
  'query',
  'q',
  'role',
  'reason',
  'description',
  'body',
  'text',
  'artist',
  'album',
  'genre',
  'cover',
  'kind',
  'type',
  'source',
  'id',
  'trackId',
  'trackIds',
  'ids',
  'items',
  'tracks',
  'itens',
  'removidos',
  'positions',
  'isPublic',
  'isCollaborative',
  'durationMs',
  'positionMs',
  'limit',
  'cursor',
  'until',
  'duration',
  'deviceId',
  'userId',
  'dados',
  'payload',
  'atualizadoEm',
  'versao',
  'estado',
];
const tiposErrados = (): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  CAMPOS.forEach((c, i) => {
    o[c] = [123, ['a'], { a: 1 }, null, true, 'xyz', -1, 1.5][i % 8];
  });
  return o;
};
const textoGigante = (): Record<string, unknown> =>
  Object.fromEntries(CAMPOS.map((c) => [c, 'A'.repeat(100_000)]));
const arrayGigante = (): Record<string, unknown> => {
  const arr = Array.from({ length: 10_000 }, (_, i) => `id-${i}`);
  return Object.fromEntries(
    ['ids', 'trackIds', 'tracks', 'items', 'itens', 'removidos', 'positions'].map((k) => [k, arr]),
  );
};
const poluicao =
  '{"__proto__":{"role":"ADMIN","polluted":true},"constructor":{"prototype":{"polluted":true}}}';

const CORPOS: Array<[string, (t: request.Test) => request.Test]> = [
  ['tipos-errados', (t) => t.send(tiposErrados())],
  ['campos-nulos', (t) => t.send(Object.fromEntries(CAMPOS.map((c) => [c, null])))],
  ['array-no-lugar-de-objeto', (t) => t.set('Content-Type', 'application/json').send('[]')],
  ['string-100kB-por-campo', (t) => t.send(textoGigante())],
  ['array-10mil', (t) => t.send(arrayGigante())],
  ['prototype-pollution', (t) => t.set('Content-Type', 'application/json').send(poluicao)],
  ['content-type-texto', (t) => t.set('Content-Type', 'text/plain').send('oi')],
  ['objeto-vazio', (t) => t.send({})],
];

describe('d) corpos invalidos em rotas de escrita (ADMIN)', () => {
  const casos = mutaveis.flatMap((r) => CORPOS.map(([n, f]) => [rotaId(r), n, r, f] as const));
  it.each(casos)('%s com corpo %s', async (_n, nome, r, aplicar) => {
    const res = await aplicar(chamar(r.metodo, preencher(r.caminho), 'admin'));
    anotar(r, `corpo:${nome}`, res.status);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).satisfy(semFalhaInterna);
    if (nome === 'string-100kB-por-campo') {
      // 100 kB x 45 campos passa de 1 MB: o parser corta antes da rota
      expect(res.status).toBe(413);
    }
  });
});

describe('d2) o parser global manda em TODA rota (inclusive GET e inexistentes)', () => {
  const alvos = [
    ...rotas,
    { metodo: 'POST', caminho: '/api/v1/nao-existe', params: [], pilha: [] },
  ];
  it.each(alvos.map((r) => [rotaId(r), r] as const))('%s: JSON quebrado -> 400', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho), 'admin')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.stack).toBeUndefined();
  });

  it.each(alvos.map((r) => [rotaId(r), r] as const))('%s: corpo > 1 MB -> 413', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho), 'admin')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'A'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
  });
});

// -- e) metodo errado ---------------------------------------------------------

describe('e) metodo errado -> 404 JSON (a API nao responde 405)', () => {
  const porCaminho = new Map<string, Set<string>>();
  for (const r of rotas) {
    if (!porCaminho.has(r.caminho)) porCaminho.set(r.caminho, new Set());
    porCaminho.get(r.caminho)!.add(r.metodo);
  }
  const casos: Array<[string, string, string]> = [];
  for (const [caminho, metodos] of porCaminho)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
      if (!metodos.has(m)) casos.push([`${m} ${caminho}`, m, caminho]);

  it.each(casos)('%s', async (_n, metodo, caminho) => {
    // outro padrao de rota pode casar a mesma URL (ex.: /albums/new-releases x /albums/:id);
    // so cobra 404 quando nenhuma rota registrada aceita este metodo nessa URL
    const url = preencher(caminho);
    const concorrente = rotas.some(
      (r) =>
        r.metodo === metodo &&
        new RegExp('^' + r.caminho.replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$').test(url),
    );
    const res = await chamar(metodo, url, 'admin');
    expect(res.status).satisfy(semFalhaInterna);
    if (!concorrente) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('e2) HEAD', () => {
  const gets = rotas.filter((r) => r.metodo === 'GET');
  it.each(gets.map((r) => [rotaId(r), r] as const))(
    'HEAD %s tem o status do GET e sem corpo',
    async (_n, r) => {
      const url = preencher(r.caminho);
      const g = await chamar('GET', url, 'admin');
      const h = await chamar('HEAD', url, 'admin');
      expect(h.status).toBe(g.status);
      expect(h.text ?? '').toBe('');
    },
  );
});

// -- f) CORS ------------------------------------------------------------------

describe('f) CORS', () => {
  const amostra = rotas.filter((r) => r.metodo === 'GET' && r.params.length === 0);
  const permitidas = [
    'https://radinho.online',
    'https://www.radinho.online',
    'http://localhost:5173',
  ];
  const negadas = [
    'https://site-do-mal.test',
    'null',
    'https://radinho.online.evil.test',
    'http://radinho.online', // esquema diferente
    'https://RADINHO.online', // caixa diferente: comparacao e exata
    'http://localhost:5173/',
    'file://',
  ];

  it('a lista efetiva do teste e a esperada', () => {
    expect(webOrigins).toEqual(permitidas);
  });

  it.each(amostra.flatMap((r) => permitidas.map((o) => [rotaId(r), o, r] as const)))(
    '%s com origem permitida %s ecoa o cabecalho + credenciais',
    async (_n, origem, r) => {
      const res = await chamar('GET', preencher(r.caminho)).set('Origin', origem);
      expect(res.headers['access-control-allow-origin']).toBe(origem);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toMatch(/Origin/i);
    },
  );

  it.each(permitidas)('preflight OPTIONS de %s responde 204 com metodos', async (origem) => {
    const res = await request(app)
      .options('/api/v1/me/history')
      .set('Origin', origem)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origem);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
  });

  it.each(amostra.flatMap((r) => negadas.map((o) => [rotaId(r), o, r] as const)))(
    '%s com origem negada %s: sem cabecalho CORS e nunca 5xx',
    async (_n, origem, r) => {
      const res = await chamar('GET', preencher(r.caminho)).set('Origin', origem);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      expect(res.status).satisfy(semFalhaInterna);
    },
  );

  it.each(negadas)('preflight de origem negada %s nao recebe liberacao', async (origem) => {
    const res = await request(app)
      .options('/api/v1/me/history')
      .set('Origin', origem)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).satisfy(semFalhaInterna);
  });

  it('cliente sem Origin (app nativo, curl) continua passando', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });
});

// -- g) Content-Type e cabecalhos de seguranca --------------------------------

describe('g) toda resposta de dados ou de erro e JSON, com cabecalhos de seguranca', () => {
  const todos = rotas.filter((r) => !NAO_JSON_OK(r));
  it.each(todos.map((r) => [rotaId(r), r] as const))('%s', async (_n, r) => {
    const res = await chamar(r.metodo, preencher(r.caminho), 'admin');
    if (res.status !== 204) {
      expect(res.headers['content-type'] ?? '').toMatch(/application\/json/);
    }
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('o 404 de rota inexistente e JSON com codigo estavel', async () => {
    for (const url of [
      '/api/v1/nao-existe',
      '/nao-existe',
      '/api/v1/',
      '/api/v1/tracks/x/nao-existe',
      '/',
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('o erro nunca vaza pilha, caminho de arquivo ou SQL', async () => {
    const piores = [
      '/api/v1/tracks/' + 'a'.repeat(5000),
      '/api/v1/me/history',
      '/api/v1/admin/users?limit=x',
    ];
    for (const u of piores) {
      const res = await chamar('GET', u, 'admin');
      expect(JSON.stringify(res.body)).not.toMatch(/\.ts:\d+|node_modules|SELECT |prisma/i);
    }
  });
});

// -- h) leituras abertas ------------------------------------------------------

describe('h) leituras abertas respondem 200 com o banco vazio', () => {
  const abertas: Array<[string, string]> = [
    ['health', '/healthz'],
    ['openapi', '/api/docs/openapi.json'],
    ['catalogo', '/api/v1/catalogo'],
    ['em-alta', '/api/v1/em-alta'],
    ['artists', '/api/v1/artists'],
    ['albums', '/api/v1/albums'],
    ['albums novos', '/api/v1/albums/new-releases'],
    ['radios', '/api/v1/radios'],
    ['podcasts', '/api/v1/podcasts'],
    ['categorias', '/api/v1/categorias'],
    ['mundo avisos', '/api/v1/mundo/avisos?artistas=Anitta|Ludmilla'],
    ['search', '/api/v1/search?q=anitta'],
    ['search suggest', '/api/v1/search/suggest?q=an'],
    ['underground artists', '/api/v1/underground/artists'],
    ['underground tracks', '/api/v1/underground/tracks'],
    ['underground genres', '/api/v1/underground/genres'],
    ['underground locations', '/api/v1/underground/locations'],
    ['underground trending', '/api/v1/underground/trending'],
  ];
  it.each(abertas)('%s', async (_n, url) => {
    const res = await request(app).get(url);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('item inexistente e 404 (nao 200 vazio, nao 500)', async () => {
    for (const url of [
      '/api/v1/artists/x1',
      '/api/v1/albums/x1',
      '/api/v1/tracks/x1',
      '/api/v1/podcasts/x1',
      '/api/v1/radios/x1',
      '/api/v1/catalogo/x1',
      '/api/v1/mundo/artista/Ninguem',
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
    }
  });
});

// -- i) NUL (Postgres nao guarda) e erros conhecidos do Prisma ----------------

describe('i) byte NUL vira 400 antes de chegar ao banco', () => {
  const lidas = rotas.filter((r) => r.metodo === 'GET' && PUBLICAS.has(rotaId(r)));
  it.each(lidas.map((r) => [rotaId(r), r] as const))('%s com ?q=%00 na query', async (_n, r) => {
    const res = await chamar('GET', preencher(r.caminho) + '?q=a%00b&limit=1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  const escritas = mutaveis.filter((r) => r.pilha.includes('requireAuth'));
  it.each(escritas.map((r) => [rotaId(r), r] as const))(
    '%s com \u0000 no valor do corpo',
    async (_n, r) => {
      const res = await chamar(r.metodo, preencher(r.caminho), 'admin')
        .set('Content-Type', 'application/json')
        .send('{"title":"a\u0000b","nested":{"x":["ok","c\u0000d"]}}');
      expect(res.status).toBe(400);
    },
  );

  it('NUL na CHAVE do objeto tambem', async () => {
    const res = await chamar('POST', '/api/v1/playlists', 'admin')
      .set('Content-Type', 'application/json')
      .send('{"a\u0000b":1}');
    expect(res.status).toBe(400);
  });

  it('JSON aninhado a 200 niveis e recusado (nao estoura a pilha)', async () => {
    const fundo = '['.repeat(200) + ']'.repeat(200);
    const res = await chamar('POST', '/api/v1/playlists', 'admin')
      .set('Content-Type', 'application/json')
      .send(`{"x":${fundo}}`);
    expect(res.status).toBe(400);
  });
});

describe('i2) errorHandler traduz erros conhecidos do Prisma (entrada do cliente != defeito)', () => {
  type Corpo = { error: { code: string; details: { requestId: string } } };
  function rodar(err: unknown): { status: number; corpo: Corpo } {
    let status = 0;
    let corpo = {} as Corpo;
    const res = {
      headersSent: false,
      status(s: number) {
        status = s;
        return res;
      },
      json(c: unknown) {
        corpo = c as Corpo;
        return res;
      },
    };
    const reqFalso = { id: 'r1', originalUrl: '/x', method: 'GET' } as unknown as Parameters<
      typeof errorHandler
    >[1];
    errorHandler(
      err as Error,
      reqFalso,
      res as unknown as Parameters<typeof errorHandler>[2],
      () => {},
    );
    return { status, corpo };
  }
  const prisma = (code: string) =>
    Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code });

  it.each([
    ['P2025', 404],
    ['P2002', 409],
    ['P2003', 409],
    ['P2000', 400],
    ['P2023', 400],
  ])('%s -> %i', (code, esperado) => {
    const { status, corpo } = rodar(prisma(code));
    expect(status).toBe(esperado);
    expect(JSON.stringify(corpo)).not.toMatch(/prisma|SELECT/i);
  });

  it('codigo desconhecido continua 500 sem vazar detalhe', () => {
    const { status, corpo } = rodar(prisma('P9999'));
    expect(status).toBe(500);
    expect(corpo.error.code).toBe('INTERNAL');
    expect(JSON.stringify(corpo)).not.toMatch(/P9999/);
  });

  it('erro qualquer vira 500 INTERNAL com requestId', () => {
    const { status, corpo } = rodar(new Error('segredo: senha=123'));
    expect(status).toBe(500);
    expect(JSON.stringify(corpo)).not.toMatch(/senha/);
    expect(corpo.error.details.requestId).toBe('r1');
  });
});

// -- j) upload multipart ------------------------------------------------------

describe('j) POST /uploads (multipart) nunca vira 5xx', () => {
  const enviar = () => chamar('POST', '/api/v1/uploads', 'comum');

  it('sem arquivo', async () => {
    const res = await enviar().field('title', 'minha faixa');
    expect(res.status).satisfy(semFalhaInterna);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('extensao fora da lista e filtrada', async () => {
    const res = await enviar()
      .attach('file', Buffer.from('oi'), 'documento.txt')
      .field('title', 'x');
    expect(res.status).satisfy(semFalhaInterna);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('.mp3 que na verdade e texto (magic bytes) e recusado', async () => {
    const res = await enviar()
      .attach('file', Buffer.from('isto nao e audio'.repeat(50)), 'falso.mp3')
      .field('title', 'x');
    expect(res.status).satisfy(semFalhaInterna);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('campo com nome errado -> 400', async () => {
    const res = await enviar().attach('arquivo', Buffer.from('x'), 'a.mp3').field('title', 'x');
    expect(res.status).toBe(400);
  });

  it('dois arquivos -> 4xx', async () => {
    const res = await enviar()
      .attach('file', Buffer.from('x'), 'a.mp3')
      .attach('file', Buffer.from('y'), 'b.mp3')
      .field('title', 'x');
    expect(res.status).satisfy(semFalhaInterna);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('multipart sem boundary valido -> 4xx', async () => {
    const res = await enviar().set('Content-Type', 'multipart/form-data').send('lixo');
    expect(res.status).satisfy(semFalhaInterna);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('nome de arquivo hostil (traversal, NUL, 5000 chars)', async () => {
    for (const nome of ['../../etc/passwd.mp3', 'a\u0000.mp3', 'a'.repeat(5000) + '.mp3']) {
      const res = await enviar().attach('file', Buffer.from('x'), nome).field('title', 'x');
      expect(res.status, nome.slice(0, 30)).satisfy(semFalhaInterna);
    }
  });

  it('sem conta -> 401 antes de aceitar o arquivo', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .attach('file', Buffer.from('x'), 'a.mp3');
    expect(res.status).toBe(401);
  });
});

// -- k) query string hostil em toda leitura -----------------------------------

const QUERIES: Array<[string, string]> = [
  ['limit negativo', 'limit=-1'],
  ['limit zero', 'limit=0'],
  ['limit gigante', 'limit=999999999'],
  ['limit texto', 'limit=abc'],
  ['limit decimal', 'limit=1.5'],
  ['limit notacao cientifica', 'limit=1e9'],
  ['limit repetido (array)', 'limit=1&limit=2'],
  ['limit[]', 'limit[]=1&limit[]=2'],
  ['cursor lixo', 'cursor=%25%25'],
  ['cursor 5000', 'cursor=' + 'a'.repeat(5000)],
  ['cursor base64 de lixo', 'cursor=' + Buffer.from('nao|e|cursor').toString('base64url')],
  ['q aninhado', 'q[a][b]=c'],
  ['q array', 'q[]=a&q[]=b'],
  ['q vazio', 'q='],
  ['q 8000', 'q=' + 'x'.repeat(8000)],
  ['q unicode bidi', 'q=' + encodeURIComponent('\u202e\u200b\ufeff')],
  ['q curinga SQL/LIKE', 'q=' + encodeURIComponent(String.raw`%_' OR 1=1 --`)],
  ['__proto__', '__proto__[x]=1&constructor[prototype][y]=1'],
  ['genre injection', 'genre=' + encodeURIComponent('rock"; DROP TABLE')],
  ['mil parametros', Array.from({ length: 1200 }, (_, i) => `p${i}=1`).join('&')],
  ['artistas pipes', 'artistas=' + '|'.repeat(3900)],
  ['artistas 60+', 'artistas=' + Array.from({ length: 200 }, (_, i) => `A${i}`).join('|')],
  ['sort estranho', 'sort=;drop&order=sideways&period=forever&days=-5&mood=zzz&kind=nada'],
];

describe('k) query string hostil: nunca 5xx interno, sempre JSON', () => {
  const leituras = rotas.filter(
    (r) => r.metodo === 'GET' && !NAO_JSON_OK(r) && r.caminho !== '/api/docs/openapi.json',
  );
  const casos = leituras.flatMap((r) => QUERIES.map(([n, q]) => [rotaId(r), n, r, q] as const));
  it.each(casos)('%s com %s', async (_n, nome, r, q) => {
    const url = preencher(r.caminho) + '?' + q;
    const res = await chamar('GET', url, 'admin');
    anotar(r, `query:${nome}`, res.status);
    expect(res.status, `${nome}: ${JSON.stringify(res.body).slice(0, 200)}`).satisfy(
      semFalhaInterna,
    );
    if (res.status !== 204) expect(res.headers['content-type'] ?? '').toMatch(/application\/json/);
  });
});
