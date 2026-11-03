import { describe, expect, it } from 'vitest';
import { ehCacheavelDaApi } from '@/lib/swRegras';

const u = (p: string) => new URL(`https://x.test${p}`);

describe('ehCacheavelDaApi', () => {
  it.each([
    '/api/v1/catalogo/busca?q=a',
    '/api/v1/em-alta',
    '/api/v1/artists/1',
    '/api/v1/albums/2',
    '/api/v1/radios',
    '/api/v1/podcasts/3',
    '/api/v1/mundo/x',
  ])('guarda %s', (p) => expect(ehCacheavelDaApi(u(p))).toBe(true));

  it.each([
    '/api/v1/me',
    '/api/v1/me/colecoes/likes',
    '/api/v1/admin/jobs',
    '/api/v1/auth/login',
    '/api/v1/telemetria',
    '/api/v1/jornada',
    '/api/v1/home',
    '/api/v1/stream/1/master.m3u8',
    '/api/v1/catalogoX',
    '/outra/coisa',
  ])('não guarda %s', (p) => expect(ehCacheavelDaApi(u(p))).toBe(false));
});
