/**
 * E-MAIL NAO VERIFICADO NAO VIRA ADMIN. Qualquer um cria conta com o e-mail do
 * dono; so o e-mail confirmado pelo provedor prova que a conta e dele.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
}));
const identidade = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('../infra/db/prisma.js', () => ({ prisma: banco }));
vi.mock('../infra/firebase/firebase.js', () => ({ verifyIdToken: identidade.verifyIdToken }));

const { authenticate } = await import('./auth.js');

const EMAIL_ADMIN = 'perdibitcoin@gmail.com';

function linha(role: string) {
  return {
    id: 'u1',
    firebaseUid: 'uid-1',
    email: EMAIL_ADMIN,
    role,
    isBanned: false,
    bannedUntil: null,
    banReason: null,
    lastSeenAt: new Date(),
  };
}

async function entrar(emailVerified: boolean) {
  identidade.verifyIdToken.mockResolvedValue({
    uid: 'uid-1',
    email: EMAIL_ADMIN,
    name: null,
    picture: null,
    emailVerified,
  });
  const req: { headers: Record<string, string>; user?: { role: string } } = {
    headers: { authorization: 'Bearer t' },
  };
  await new Promise<void>((resolve, reject) => {
    (authenticate as unknown as (r: unknown, s: unknown, n: (e?: unknown) => void) => void)(
      req,
      {},
      (e) => (e ? reject(e) : resolve()),
    );
  });
  return req.user;
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...linha('USER'), ...data }),
  );
  banco.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...linha('USER'), ...data }),
  );
});

describe('promocao a ADMIN exige e-mail verificado', () => {
  it('conta nova com e-mail de admin NAO verificado nasce USER', async () => {
    banco.user.findUnique.mockResolvedValue(null);
    expect((await entrar(false))?.role).toBe('USER');
    expect(banco.user.create.mock.calls[0]?.[0].data.role).toBe('USER');
  });

  it('conta nova com e-mail de admin verificado nasce ADMIN', async () => {
    banco.user.findUnique.mockResolvedValue(null);
    expect((await entrar(true))?.role).toBe('ADMIN');
  });

  it('conta USER existente nao e promovida sem verificacao', async () => {
    banco.user.findUnique.mockResolvedValue(linha('USER'));
    expect((await entrar(false))?.role).toBe('USER');
    expect(banco.user.update.mock.calls.some((c) => c[0].data.role === 'ADMIN')).toBe(false);
  });

  it('conta USER existente e promovida quando verificada', async () => {
    banco.user.findUnique.mockResolvedValue(linha('USER'));
    expect((await entrar(true))?.role).toBe('ADMIN');
  });

  it('admin ja existente nao e rebaixado', async () => {
    banco.user.findUnique.mockResolvedValue(linha('ADMIN'));
    expect((await entrar(false))?.role).toBe('ADMIN');
  });
});
