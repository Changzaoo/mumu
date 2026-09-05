/**
 * FAIXA MARCADA COMO NÃO-PÚBLICA — quem consegue chegar nela.
 *
 * Este arquivo nasceu de um buraco encontrado ao escrever a integração da API:
 * toda listagem filtra `isPublic: true`, mas `GET /tracks/:id` não olhava o
 * campo e devolvia a faixa escondida a QUALQUER UM, com `streamUrl` já assinado
 * dentro. `GET /tracks/:id/download` exigia conta e entregava os bytes originais
 * pelo mesmo caminho. Ver `visivelPara` em `tracks.service.ts`.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const bancoFalso = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  track: { findUnique: vi.fn() },
  likedTrack: { findMany: vi.fn() },
  download: { upsert: vi.fn() },
}));

const cofreFalso = vi.hoisted(() => ({
  getStream: vi.fn(),
  size: vi.fn(),
}));

const redisFalso = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  call: vi.fn().mockResolvedValue('0'.repeat(40)),
  on: vi.fn(),
}));

const identidade = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock('../../infra/db/prisma.js', () => ({ prisma: bancoFalso }));
vi.mock('../../infra/redis/redis.js', () => ({
  redis: redisFalso,
  createBullConnection: () => redisFalso,
  createSubscriber: () => redisFalso,
}));
vi.mock('../../infra/firebase/firebase.js', () => ({
  verifyIdToken: identidade.verifyIdToken,
  isFirebaseEnabled: () => true,
  getFirebaseApp: () => ({}),
}));
vi.mock('../../infra/storage/index.js', async (original) => {
  const real = await original<typeof import('../../infra/storage/index.js')>();
  return { ...real, getStorage: () => cofreFalso };
});

const { createApp } = await import('../../app.js');

const app = createApp();
const DONO = 'u-dono';
const INTRUSO = 'u-intruso';

/** Linha de `Track` no formato que `trackInclude` devolve. */
function faixa(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    title: 'Demo guardada',
    durationMs: 210_000,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    hlsKey: 'audio/t1/master.m3u8',
    originalKey: 'audio/t1/original.mp3',
    isPublic: false,
    uploadedByUserId: DONO,
    albumId: null,
    album: null,
    artists: [],
    genres: [],
    ...over,
  };
}

function entrarComo(id: string): void {
  identidade.verifyIdToken.mockResolvedValue({
    uid: `uid-${id}`,
    email: `${id}@exemplo.test`,
    name: null,
    picture: null,
  });
  bancoFalso.user.findUnique.mockResolvedValue({
    id,
    firebaseUid: `uid-${id}`,
    email: `${id}@exemplo.test`,
    handle: id,
    displayName: id,
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
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bancoFalso.user.findUnique.mockResolvedValue(null);
  bancoFalso.likedTrack.findMany.mockResolvedValue([]);
  bancoFalso.download.upsert.mockResolvedValue({ id: 'd1' });
  bancoFalso.track.findUnique.mockResolvedValue(faixa());
  cofreFalso.getStream.mockResolvedValue(Readable.from([Buffer.from('audio')]));
  cofreFalso.size.mockResolvedValue(5);
  identidade.verifyIdToken.mockResolvedValue({
    uid: 'nao-usado',
    email: null,
    name: null,
    picture: null,
  });
});

describe('GET /tracks/:id', () => {
  it('faixa pública sai normalmente, com endereço de som', async () => {
    bancoFalso.track.findUnique.mockResolvedValue(faixa({ isPublic: true }));
    const res = await request(app).get('/api/v1/tracks/t1');
    expect(res.status).toBe(200);
    expect(res.body.data.streamUrl).toContain('/stream/t1/manifest.m3u8?token=');
  });

  it('faixa escondida é 404 para VISITANTE', async () => {
    const res = await request(app).get('/api/v1/tracks/t1');
    expect(res.status).toBe(404);
    // Nem o título nem o token assinado podem aparecer na recusa.
    expect(JSON.stringify(res.body)).not.toContain('Demo guardada');
    expect(JSON.stringify(res.body)).not.toContain('token=');
  });

  it('faixa escondida é 404 para OUTRA conta logada', async () => {
    entrarComo(INTRUSO);
    const res = await request(app).get('/api/v1/tracks/t1').set('Authorization', 'Bearer t');
    expect(res.status).toBe(404);
  });

  it('o DONO continua vendo a própria faixa escondida', async () => {
    entrarComo(DONO);
    const res = await request(app).get('/api/v1/tracks/t1').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Demo guardada');
  });

  it('faixa escondida sem dono registrado não vira de ninguém', async () => {
    entrarComo(INTRUSO);
    bancoFalso.track.findUnique.mockResolvedValue(faixa({ uploadedByUserId: null }));
    const res = await request(app).get('/api/v1/tracks/t1').set('Authorization', 'Bearer t');
    expect(res.status).toBe(404);
  });
});

describe('GET /tracks/:id/download', () => {
  it('sem conta é 401 (a rota já exigia login)', async () => {
    const res = await request(app).get('/api/v1/tracks/t1/download');
    expect(res.status).toBe(401);
  });

  it('conta logada que não é dona NÃO baixa os bytes da faixa escondida', async () => {
    entrarComo(INTRUSO);
    const res = await request(app)
      .get('/api/v1/tracks/t1/download')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(404);
    expect(cofreFalso.getStream).not.toHaveBeenCalled();
    // E nada de registrar uma concessão de download que não aconteceu.
    expect(bancoFalso.download.upsert).not.toHaveBeenCalled();
  });

  it('o dono baixa a própria faixa escondida', async () => {
    entrarComo(DONO);
    const res = await request(app)
      .get('/api/v1/tracks/t1/download')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(cofreFalso.getStream).toHaveBeenCalledWith('audio/t1/original.mp3');
  });

  it('faixa pública segue baixável por qualquer conta', async () => {
    entrarComo(INTRUSO);
    bancoFalso.track.findUnique.mockResolvedValue(faixa({ isPublic: true }));
    const res = await request(app)
      .get('/api/v1/tracks/t1/download')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
  });

  it('faixa pública sem arquivo original é 404, não 500', async () => {
    entrarComo(INTRUSO);
    bancoFalso.track.findUnique.mockResolvedValue(faixa({ isPublic: true, originalKey: null }));
    const res = await request(app)
      .get('/api/v1/tracks/t1/download')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(404);
  });
});
