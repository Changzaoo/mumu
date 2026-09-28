import { describe, expect, it } from 'vitest';
import { deveConvidar } from '../conviteApk';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/128 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const base = { nativo: false, dispensadoEm: null, agora: 1_000_000_000_000 };

describe('convite para o APK', () => {
  it('convida o Android no navegador', () => {
    expect(deveConvidar({ ...base, userAgent: ANDROID })).toBe(true);
  });
  it('não convida iPhone nem quem já está no app nativo', () => {
    expect(deveConvidar({ ...base, userAgent: IPHONE })).toBe(false);
    expect(deveConvidar({ ...base, userAgent: ANDROID, nativo: true })).toBe(false);
  });
  it('"agora não" silencia por 14 dias', () => {
    const dia = 24 * 60 * 60 * 1000;
    expect(deveConvidar({ ...base, userAgent: ANDROID, dispensadoEm: base.agora - 3 * dia })).toBe(
      false,
    );
    expect(deveConvidar({ ...base, userAgent: ANDROID, dispensadoEm: base.agora - 15 * dia })).toBe(
      true,
    );
  });
});
