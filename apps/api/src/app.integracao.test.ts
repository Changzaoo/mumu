/**
 * INTEGRAÇÃO HTTP DA API — o portão que faltava.
 *
 * Até aqui a API tinha só testes de unidade: funções puras (token de stream,
 * paginação, fusão de telemetria) verificadas fora do Express. O que NUNCA foi
 * exercitado é o que de fato decide se um pedido passa: a pilha de middlewares
 * montada em `createApp` — CORS, autenticação, papéis, validação, teto de corpo
 * e o envelope de erro. Regra que só existe em `app.ts` e em `auth.ts` é
 * exatamente a que quebra sem ninguém ver, porque nenhuma unidade a cobre.
 *
 * O banco e o Firebase entram DUBLADOS, de propósito: o que está sob teste é a
 * decisão da API (quem entra, com que papel, com que corpo), não o Postgres.
 * Nada aqui abre conexão — `prisma` e `redis` são preguiçosos e o limitador de
 * requisições se desliga sozinho em `NODE_ENV=test` (`skip: () => isTest`).
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bancoFalso = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  track: { findUnique: vi.fn(), findMany: vi.fn() },
  album: { findMany: vi.fn() },
  artist: { findMany: vi.fn() },
  playlist: { findMany: vi.fn() },
  podcast: { findMany: vi.fn() },
  radioStation: { findMany: vi.fn() },
  telemetryDevice: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  likedTrack: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

const identidade = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

/**
 * Redis dublado — sem isto o `cache` da busca tenta abrir conexão de verdade e
 * a suíte gasta o tempo do teste em `MaxRetriesPerRequestError`. Um cache que
 * erra sempre é exatamente o cenário mais duro para as rotas: toda leitura vira
 * miss e o caminho completo é exercitado.
 */
const redisFalso = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  scan: vi.fn().mockResolvedValue(['0', []]),
  // `rate-limit-redis` carrega scripts Lua no `init` do store e exige o SHA de
  // volta como texto; devolver número deixa 8 rejeições soltas na suíte.
  call: vi.fn().mockResolvedValue('0'.repeat(40)),
  on: vi.fn(),
}));

vi.mock('./infra/redis/redis.js', () => ({
  redis: redisFalso,
  createBullConnection: () => redisFalso,
  createSubscriber: () => redisFalso,
}));
vi.mock('./infra/db/prisma.js', () => ({ prisma: bancoFalso }));
vi.mock('./infra/firebase/firebase.js', () => ({
  verifyIdToken: identidade.verifyIdToken,
  isFirebaseEnabled: () => true,
  getFirebaseApp: () => ({}),
}));

const { createApp } = await import('./app.js');
const { UnauthorizedError } = await import('./core/errors/index.js');

const app = createApp();

/** Uma linha de `User` como o Prisma a devolve, com os campos que `auth.ts` lê. */
function usuario(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'u1',
    firebaseUid: 'uid-1',
    email: 'alguem@exemplo.test',
    handle: 'alguem',
    displayName: 'Alguém',
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    isPremium: false,
    role: 'USER',
    isBanned: false,
    bannedUntil: null,
    banReason: null,
    lastSeenAt: new Date(),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { followers: 0, following: 0 },
    ...over,
  };
}

/** Faz o Firebase aceitar qualquer token e o banco devolver este usuário. */
function entrarComo(linha: Record<string, unknown>): void {
  identidade.verifyIdToken.mockResolvedValue({
    uid: linha['firebaseUid'],
    email: linha['email'],
    name: null,
    picture: null,
  });
  bancoFalso.user.findUnique.mockResolvedValue(linha);
}

beforeEach(() => {
  vi.clearAllMocks();
  bancoFalso.user.findUnique.mockResolvedValue(null);
  bancoFalso.user.update.mockImplementation(({ data }: { data: unknown }) =>
    Promise.resolve(usuario(data as Record<string, unknown>)),
  );
  bancoFalso.track.findMany.mockResolvedValue([]);
  bancoFalso.album.findMany.mockResolvedValue([]);
  bancoFalso.artist.findMany.mockResolvedValue([]);
  bancoFalso.playlist.findMany.mockResolvedValue([]);
  bancoFalso.podcast.findMany.mockResolvedValue([]);
  bancoFalso.radioStation.findMany.mockResolvedValue([]);
  bancoFalso.user.findMany.mockResolvedValue([]);
  bancoFalso.telemetryDevice.findMany.mockResolvedValue([]);
  identidade.verifyIdToken.mockRejectedValue(new UnauthorizedError('Invalid or expired token'));
});

describe('portaria pública', () => {
  it('responde /healthz sem token e sem envelope de erro', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('não anuncia o servidor no cabeçalho', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('manda o navegador não adivinhar o tipo do conteúdo (helmet)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rota inexistente vira 404 com código estável, não HTML do Express', async () => {
    const res = await request(app).get('/api/v1/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS', () => {
  it('devolve o cabeçalho para a origem da lista', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('NÃO libera uma origem de fora da lista', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'https://site-do-mal.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('autenticação', () => {
  it('sem cabeçalho Authorization, rota de conta responde 401', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('esquema que não é Bearer é ignorado — segue como visitante e leva 401', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Basic YWJjOjEyMw==');
    expect(res.status).toBe(401);
    expect(identidade.verifyIdToken).not.toHaveBeenCalled();
  });

  it('token recusado pelo Firebase vira 401 sem vazar pilha', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer token-podre');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:/);
    expect(res.body.error.stack).toBeUndefined();
  });

  it('token válido chega na rota com a identidade do banco', async () => {
    entrarComo(usuario());
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer token-bom');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('u1');
  });

  it('conta banida sem prazo leva 403, não 401', async () => {
    entrarComo(usuario({ isBanned: true, bannedUntil: null, banReason: 'spam' }));
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer token-bom');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('banimento com prazo VENCIDO deixa entrar de novo', async () => {
    entrarComo(usuario({ isBanned: true, bannedUntil: new Date(Date.now() - 60_000) }));
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer token-bom');
    expect(res.status).toBe(200);
  });

  it('banimento com prazo NO FUTURO continua barrando', async () => {
    entrarComo(usuario({ isBanned: true, bannedUntil: new Date(Date.now() + 60_000) }));
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer token-bom');
    expect(res.status).toBe(403);
  });
});

describe('papéis', () => {
  it('visitante não lê o painel de telemetria', async () => {
    const res = await request(app).get('/api/v1/telemetria');
    expect(res.status).toBe(401);
  });

  it('usuário comum não lê o painel de telemetria', async () => {
    entrarComo(usuario({ role: 'USER' }));
    const res = await request(app).get('/api/v1/telemetria').set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/ADMIN/);
  });

  it('ADMIN lê o painel de telemetria', async () => {
    entrarComo(usuario({ role: 'ADMIN' }));
    const res = await request(app).get('/api/v1/telemetria').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('o papel vem do BANCO, não do que o cliente afirma', async () => {
    // O token diz ser de admin; a linha do banco diz USER. Vale a linha.
    identidade.verifyIdToken.mockResolvedValue({
      uid: 'uid-1',
      email: 'alguem@exemplo.test',
      name: 'admin',
      picture: null,
    });
    bancoFalso.user.findUnique.mockResolvedValue(usuario({ role: 'USER' }));
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', 'Bearer t')
      .send();
    expect(res.status).toBe(403);
  });

  it('MODERATOR não alcança o que é só de ADMIN', async () => {
    entrarComo(usuario({ role: 'MODERATOR' }));
    const res = await request(app)
      .patch('/api/v1/admin/users/u2')
      .set('Authorization', 'Bearer t')
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('escrita de telemetria é ABERTA — visitante conta (não é 401)', async () => {
    bancoFalso.telemetryDevice.findUnique.mockResolvedValue(null);
    bancoFalso.telemetryDevice.upsert.mockResolvedValue({});
    const res = await request(app)
      .put('/api/v1/telemetria/aparelho-de-visitante')
      .send({ dados: { aberturas: 1 } });
    expect(res.status).toBe(204);
  });
});

describe('entrada inválida e limites', () => {
  it('JSON quebrado vira 400 com envelope, não 500', async () => {
    const res = await request(app)
      .put('/api/v1/telemetria/aparelho-teste')
      .set('Content-Type', 'application/json')
      .send('{"dados": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('corpo acima de 1 MB é recusado antes de qualquer rota', async () => {
    const gigante = { dados: { texto: 'x'.repeat(1_200_000) } };
    const res = await request(app).put('/api/v1/telemetria/aparelho-teste').send(gigante);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(bancoFalso.telemetryDevice.upsert).not.toHaveBeenCalled();
  });

  it('id de aparelho fora do formato não vira chave primária', async () => {
    const res = await request(app)
      .put('/api/v1/telemetria/id com espaço e <script>')
      .send({ dados: {} });
    expect(res.status).toBe(422);
    expect(bancoFalso.telemetryDevice.upsert).not.toHaveBeenCalled();
  });

  it('busca sem termo é 422, não uma varredura da tabela inteira', async () => {
    const res = await request(app).get('/api/v1/search?q=');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(bancoFalso.track.findMany).not.toHaveBeenCalled();
  });

  it('limite acima do teto é recusado — ninguém pede 10.000 de uma vez', async () => {
    const res = await request(app).get('/api/v1/search?q=oi&limit=10000');
    expect(res.status).toBe(422);
    expect(bancoFalso.track.findMany).not.toHaveBeenCalled();
  });

  it('erro inesperado do banco vira 500 sem pilha, com requestId para rastrear', async () => {
    entrarComo(usuario());
    bancoFalso.user.findUnique.mockRejectedValueOnce(new Error('connect ECONNREFUSED 5432'));
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer t');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');
    expect(res.body.error.details.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED/);
  });
});

describe('injeção', () => {
  it('SQL na busca viaja como VALOR, nunca concatenado na consulta', async () => {
    const veneno = "'; DROP TABLE tracks; --";
    const res = await request(app).get('/api/v1/search').query({ q: veneno });
    expect(res.status).toBe(200);

    // Prisma parametriza: o texto chega inteiro dentro de um `contains`.
    const chamadas = bancoFalso.track.findMany.mock.calls;
    expect(chamadas.length).toBeGreaterThan(0);
    const serializado = JSON.stringify(chamadas[0]);
    expect(serializado).toContain('contains');
    expect(JSON.parse(serializado)).toBeTruthy();
    // e a resposta devolve o termo como texto, sem executar nada
    expect(res.body.data.query).toContain('DROP TABLE');
  });

  it('operador de consulta injetado no termo é tratado como texto', async () => {
    // Estilo NoSQL: se o objeto vazasse para o `where`, viraria filtro.
    const res = await request(app).get('/api/v1/search').query({ q: '{"$ne":null}' });
    expect(res.status).toBe(200);
    const enviado = JSON.stringify(bancoFalso.track.findMany.mock.calls[0]);
    expect(enviado).not.toContain('"$ne"');
  });
});
