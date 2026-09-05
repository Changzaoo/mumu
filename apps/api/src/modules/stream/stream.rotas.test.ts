/**
 * O CAMINHO DO SOM, PELO HTTP DE VERDADE.
 *
 * `streamToken.test.ts` já prova a assinatura isolada. O que ninguém verificava
 * é a rota: se o token de OUTRA faixa entra, se um nome de segmento com `../`
 * chega ao disco, se uma faixa sem áudio devolve 404 depressa em vez de pendurar
 * o player. Essa última é o critério RF7 do pedido — cofre podado é regime
 * normal aqui, e falha invisível vira spinner eterno.
 *
 * O armazenamento entra dublado: o que está sob teste é a decisão da rota
 * (aceita/recusa, e com QUE chave vai ao disco), não a leitura de arquivo.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const bancoFalso = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue(null) },
  track: { findUnique: vi.fn() },
}));

const cofreFalso = vi.hoisted(() => ({ getStream: vi.fn() }));

const redisFalso = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  call: vi.fn().mockResolvedValue('0'.repeat(40)),
  on: vi.fn(),
}));

vi.mock('../../infra/db/prisma.js', () => ({ prisma: bancoFalso }));
vi.mock('../../infra/redis/redis.js', () => ({
  redis: redisFalso,
  createBullConnection: () => redisFalso,
  createSubscriber: () => redisFalso,
}));
vi.mock('../../infra/storage/index.js', async (original) => {
  const real = await original<typeof import('../../infra/storage/index.js')>();
  return { ...real, getStorage: () => cofreFalso };
});

const { createApp } = await import('../../app.js');
const { signStreamToken } = await import('./streamToken.js');

const app = createApp();
const FAIXA = 'faixa-1';
const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nnormal/index.m3u8\n';

function comAudio(): void {
  bancoFalso.track.findUnique.mockResolvedValue({
    id: FAIXA,
    hlsKey: `audio/${FAIXA}/master.m3u8`,
    isPublic: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bancoFalso.user.findUnique.mockResolvedValue(null);
  comAudio();
  cofreFalso.getStream.mockImplementation(() => Promise.resolve(Readable.from([MASTER])));
});

describe('manifesto — quem pode pedir', () => {
  it('entrega o m3u8 com token válido e propaga o token nas URIs', async () => {
    const token = signStreamToken(FAIXA);
    const res = await request(app).get(`/api/v1/stream/${FAIXA}/manifest.m3u8`).query({ token });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    // Sem propagar, o player buscaria a variante sem token e tomaria 401 no meio.
    expect(res.text).toContain(`normal/index.m3u8?token=${encodeURIComponent(token)}`);
    // Manifesto carrega token: cache de intermediário serviria o token a outro.
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sem token é 422 — a rota nem chega a olhar o banco', async () => {
    const res = await request(app).get(`/api/v1/stream/${FAIXA}/manifest.m3u8`);
    expect(res.status).toBe(422);
    expect(bancoFalso.track.findUnique).not.toHaveBeenCalled();
  });

  it('token curto demais é recusado na validação, não no HMAC', async () => {
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: 'curto' });
    expect(res.status).toBe(422);
  });

  it('TOKEN DE OUTRA FAIXA não abre esta — a assinatura prende o id', async () => {
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: signStreamToken('outra-faixa') });
    expect(res.status).toBe(401);
    expect(cofreFalso.getStream).not.toHaveBeenCalled();
  });

  it('token vencido é 401, mesmo tendo sido legítimo', async () => {
    const vencido = signStreamToken(FAIXA, { nowMs: Date.now() - 48 * 60 * 60 * 1000 });
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: vencido });
    expect(res.status).toBe(401);
  });

  it('assinatura adulterada é 401', async () => {
    const token = signStreamToken(FAIXA);
    const adulterado = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: adulterado });
    expect(res.status).toBe(401);
  });

  it('id de faixa acima de 64 caracteres é 422 antes do banco', async () => {
    const enorme = 'f'.repeat(80);
    const res = await request(app)
      .get(`/api/v1/stream/${enorme}/manifest.m3u8`)
      .query({ token: signStreamToken(enorme) });
    expect(res.status).toBe(422);
    expect(bancoFalso.track.findUnique).not.toHaveBeenCalled();
  });
});

describe('faixa sem áudio — RF7: falha VISÍVEL, nunca spinner eterno', () => {
  it('faixa inexistente responde 404 na hora', async () => {
    bancoFalso.track.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: signStreamToken(FAIXA) });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('faixa no banco mas SEM hlsKey (cofre podado) também é 404, não 500', async () => {
    bancoFalso.track.findUnique.mockResolvedValue({ id: FAIXA, hlsKey: null, isPublic: true });
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: signStreamToken(FAIXA) });
    expect(res.status).toBe(404);
    expect(cofreFalso.getStream).not.toHaveBeenCalled();
  });

  it('arquivo sumido do cofre vira 404 com código, não pilha de erro', async () => {
    const { NotFoundError } = await import('../../core/errors/index.js');
    cofreFalso.getStream.mockRejectedValue(new NotFoundError('Object'));
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/manifest.m3u8`)
      .query({ token: signStreamToken(FAIXA) });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('segmentos — travessia de caminho e qualidade', () => {
  it('entrega o segmento e o marca imutável para o cache', async () => {
    cofreFalso.getStream.mockResolvedValue(Readable.from([Buffer.from([0x47, 0x40, 0x00])]));
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/normal/seg-00001.ts`)
      .query({ token: signStreamToken(FAIXA) });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(cofreFalso.getStream).toHaveBeenCalledWith(`audio/${FAIXA}/normal/seg-00001.ts`);
  });

  it('qualidade fora da lista é recusada', async () => {
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/altissima/seg-00001.ts`)
      .query({ token: signStreamToken(FAIXA) });
    expect(res.status).toBe(422);
    expect(cofreFalso.getStream).not.toHaveBeenCalled();
  });

  it.each([
    ['..%2F..%2F..%2Fetc%2Fpasswd', 'travessia codificada'],
    ['seg-1.ts%00.mp3', 'byte nulo'],
    ['..', 'ponto-ponto puro'],
    ['seg-1.sh', 'extensão fora da lista'],
    // A API roda em Linux, mas o cofre já foi montado em disco externo e o
    // `path.resolve` do Node trata `\` como separador no Windows.
    ['..%5C..%5Cconfig.m3u8', 'travessia com barra invertida'],
    ['seg 1.ts', 'espaço no nome'],
  ])('nome de segmento %s (%s) NÃO chega ao cofre', async (nome) => {
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/normal/${nome}`)
      .query({ token: signStreamToken(FAIXA) });

    expect(res.status).toBeGreaterThanOrEqual(400);
    // A prova que interessa: nenhuma leitura de disco foi tentada.
    expect(cofreFalso.getStream).not.toHaveBeenCalled();
  });

  it('a chave montada fica SEMPRE sob o diretório da faixa', async () => {
    cofreFalso.getStream.mockResolvedValue(Readable.from([MASTER]));
    await request(app)
      .get(`/api/v1/stream/${FAIXA}/high/index.m3u8`)
      .query({ token: signStreamToken(FAIXA) });

    const chave = cofreFalso.getStream.mock.calls[0]?.[0] as string;
    expect(chave.startsWith(`audio/${FAIXA}/`)).toBe(true);
    expect(chave).not.toContain('..');
  });

  it('variante m3u8 também sai com o token propagado', async () => {
    cofreFalso.getStream.mockResolvedValue(Readable.from(['#EXTM3U\nseg-00001.ts\n']));
    const token = signStreamToken(FAIXA);
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/normal/index.m3u8`)
      .query({ token });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`seg-00001.ts?token=${encodeURIComponent(token)}`);
  });

  it('linhas de comentário do m3u8 ficam intactas na propagação', async () => {
    cofreFalso.getStream.mockResolvedValue(
      Readable.from(['#EXTM3U\n#EXT-X-TARGETDURATION:6\n\nseg-00001.ts\n']),
    );
    const res = await request(app)
      .get(`/api/v1/stream/${FAIXA}/normal/index.m3u8`)
      .query({ token: signStreamToken(FAIXA) });
    expect(res.text).toContain('#EXT-X-TARGETDURATION:6');
    expect(res.text).not.toContain('#EXT-X-TARGETDURATION:6?token=');
  });
});
