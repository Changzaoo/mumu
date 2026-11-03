/**
 * QUEM PODE MEXER NO ACERVO COMUNITARIO.
 * Usuario comum publica a propria biblioteca, mas nao toca nas faixas dos
 * outros; so ADMIN apaga; hosts de audio fora da lista sao recusados.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  catalogTrack: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    aggregate: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const identidade = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
const redisFalso = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  scan: vi.fn().mockResolvedValue(['0', []]),
  call: vi.fn().mockResolvedValue('0'.repeat(40)),
  on: vi.fn(),
}));

vi.mock('../../infra/redis/redis.js', () => ({
  redis: redisFalso,
  createBullConnection: () => redisFalso,
  createSubscriber: () => redisFalso,
}));
vi.mock('../../infra/db/prisma.js', () => ({ prisma: banco }));
vi.mock('../../infra/firebase/firebase.js', () => ({
  verifyIdToken: identidade.verifyIdToken,
  isFirebaseEnabled: () => true,
  getFirebaseApp: () => ({}),
}));

const { createApp } = await import('../../app.js');
const { semCamposDoServidor } = await import('./catalog.repository.js');
const app = createApp();

function usuario(id: string, role: 'USER' | 'ADMIN') {
  return {
    id,
    firebaseUid: `uid-${id}`,
    email: `${id}@exemplo.test`,
    handle: id,
    displayName: id,
    avatarUrl: null,
    role,
    isBanned: false,
    bannedUntil: null,
    banReason: null,
    lastSeenAt: new Date(),
  };
}

function entrarComo(id: string, role: 'USER' | 'ADMIN' = 'USER'): void {
  const linha = usuario(id, role);
  identidade.verifyIdToken.mockResolvedValue({
    uid: linha.firebaseUid,
    email: linha.email,
    name: null,
    picture: null,
    emailVerified: true,
  });
  banco.user.findUnique.mockResolvedValue(linha);
}

const faixa = (id: string, extra: Record<string, unknown> = {}) => ({
  track: { id, title: 'T' },
  remoteUrl: 'https://musicas.radinho.online/a.mp3',
  ...extra,
});

/** O que o banco devolve para cada id; o resto e inexistente. */
function bancoTem(linhas: Record<string, Record<string, unknown>>): void {
  banco.catalogTrack.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(linhas[where.id] ? { data: linhas[where.id] } : null),
  );
  banco.catalogTrack.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.filter((i) => linhas[i]).map((i) => ({ id: i, data: linhas[i] }))),
  );
}

const gravados = () =>
  banco.catalogTrack.upsert.mock.calls.map(
    (c) => (c[0] as { create: { id: string; data: Record<string, unknown> } }).create,
  );

const AUTH = { Authorization: 'Bearer x' };

beforeEach(() => {
  vi.clearAllMocks();
  banco.catalogTrack.upsert.mockResolvedValue({});
  banco.catalogTrack.deleteMany.mockResolvedValue({ count: 1 });
  banco.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  bancoTem({});
  identidade.verifyIdToken.mockRejectedValue(new Error('sem token'));
});

describe('PUT /catalogo/:id', () => {
  it('usuario cria faixa nova e vira dono (ignora publicadoPor do cliente)', async () => {
    entrarComo('ana');
    const res = await request(app)
      .put('/api/v1/catalogo/f1')
      .set(AUTH)
      .send(faixa('f1', { publicadoPor: 'invasor' }));
    expect(res.status).toBe(204);
    expect(gravados()[0]?.data.publicadoPor).toBe('ana');
  });

  it('dono atualiza a propria faixa', async () => {
    entrarComo('ana');
    bancoTem({ f1: faixa('f1', { publicadoPor: 'ana' }) });
    const res = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(faixa('f1'));
    expect(res.status).toBe(204);
    expect(gravados()[0]?.data.publicadoPor).toBe('ana');
  });

  it('usuario nao sobrescreve faixa de outro (403)', async () => {
    entrarComo('bia');
    bancoTem({ f1: faixa('f1', { publicadoPor: 'ana' }) });
    const res = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(faixa('f1'));
    expect(res.status).toBe(403);
    expect(banco.catalogTrack.upsert).not.toHaveBeenCalled();
  });

  it('faixa legada sem dono so o admin altera', async () => {
    bancoTem({ f1: faixa('f1') });
    entrarComo('ana');
    const negada = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(faixa('f1'));
    expect(negada.status).toBe(403);
    entrarComo('adm', 'ADMIN');
    const ok = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(faixa('f1'));
    expect(ok.status).toBe(204);
  });

  it('admin sobrescreve a de outro sem tomar a posse', async () => {
    entrarComo('adm', 'ADMIN');
    bancoTem({ f1: faixa('f1', { publicadoPor: 'ana' }) });
    const res = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(faixa('f1'));
    expect(res.status).toBe(204);
    expect(gravados()[0]?.data.publicadoPor).toBe('ana');
  });

  it('id da URL diferente de track.id e 400', async () => {
    entrarComo('ana');
    const res = await request(app).put('/api/v1/catalogo/outro').set(AUTH).send(faixa('f1'));
    expect(res.status).toBe(400);
  });

  it('host de audio fora da lista e 400 para usuario e passa para admin', async () => {
    const ruim = faixa('f1', { remoteUrl: 'https://evil.example.com/a.mp3' });
    entrarComo('ana');
    const r1 = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(ruim);
    expect(r1.status).toBe(400);
    entrarComo('adm', 'ADMIN');
    const r2 = await request(app).put('/api/v1/catalogo/f1').set(AUTH).send(ruim);
    expect(r2.status).toBe(204);
  });

  it('recusa esquema nao http(s) e sourceUrl desconhecida; aceita youtube', async () => {
    entrarComo('ana');
    const put = (corpo: object) => request(app).put('/api/v1/catalogo/f1').set(AUTH).send(corpo);
    expect((await put(faixa('f1', { remoteUrl: 'javascript:alert(1)' }))).status).toBe(400);
    expect((await put(faixa('f1', { sourceUrl: 'https://evil.example.com/x' }))).status).toBe(400);
    expect(
      (await put(faixa('f1', { sourceUrl: 'https://www.youtube.com/watch?v=abc' }))).status,
    ).toBe(204);
  });
});

describe('POST /catalogo/bulk', () => {
  it('pula o que nao pode e conta as recusadas, sem falhar o lote', async () => {
    entrarComo('bia');
    bancoTem({
      alheia: faixa('alheia', { publicadoPor: 'ana' }),
      legada: faixa('legada'),
      minha: faixa('minha', { publicadoPor: 'bia' }),
    });
    const res = await request(app)
      .post('/api/v1/catalogo/bulk')
      .set(AUTH)
      .send({
        entradas: [
          faixa('nova'),
          faixa('minha'),
          faixa('alheia'),
          faixa('legada'),
          faixa('hostruim', { remoteUrl: 'https://evil.example.com/a.mp3' }),
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ publicadas: 2, recusadas: 3 });
    expect(
      gravados()
        .map((g) => g.id)
        .sort(),
    ).toEqual(['minha', 'nova']);
    expect(gravados().every((g) => g.data.publicadoPor === 'bia')).toBe(true);
  });

  it('admin publica tudo', async () => {
    entrarComo('adm', 'ADMIN');
    bancoTem({ alheia: faixa('alheia', { publicadoPor: 'ana' }), legada: faixa('legada') });
    const res = await request(app)
      .post('/api/v1/catalogo/bulk')
      .set(AUTH)
      .send({ entradas: [faixa('alheia'), faixa('legada')] });
    expect(res.body.data).toEqual({ publicadas: 2, recusadas: 0 });
  });
});

describe('DELETE /catalogo/:id', () => {
  it('usuario comum recebe 403; admin apaga', async () => {
    entrarComo('ana');
    const r1 = await request(app).delete('/api/v1/catalogo/f1').set(AUTH);
    expect(r1.status).toBe(403);
    expect(banco.catalogTrack.deleteMany).not.toHaveBeenCalled();
    entrarComo('adm', 'ADMIN');
    const r2 = await request(app).delete('/api/v1/catalogo/f1').set(AUTH);
    expect(r2.status).toBe(204);
    expect(banco.catalogTrack.deleteMany).toHaveBeenCalled();
  });
});

describe('publicadoPor e campo so do servidor', () => {
  it('nao desce na listagem', () => {
    const saida = semCamposDoServidor(faixa('f1', { publicadoPor: 'ana' }));
    expect(saida).not.toHaveProperty('publicadoPor');
  });
});
