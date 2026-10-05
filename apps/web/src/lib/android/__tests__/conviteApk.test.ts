import { afterEach, describe, expect, it } from 'vitest';
import { APK_URL, conviteAtivo, deveConvidar, versaoDoApp } from '../conviteApk';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/128 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';

describe('convite para o APK', () => {
  it('convida o Android no navegador', () => {
    expect(deveConvidar({ nativo: false, userAgent: ANDROID })).toBe(true);
  });
  it('não convida iPhone, desktop, TV/Quest nem quem já está no app nativo', () => {
    expect(deveConvidar({ nativo: false, userAgent: IPHONE })).toBe(false);
    expect(deveConvidar({ nativo: false, userAgent: DESKTOP })).toBe(false);
    expect(deveConvidar({ nativo: false, userAgent: `${ANDROID} OculusBrowser/1` })).toBe(false);
    expect(deveConvidar({ nativo: true, userAgent: ANDROID })).toBe(false);
  });
  it('é fixo: sem silêncio nem "nunca mais" — a mesma entrada sempre convida', () => {
    expect(deveConvidar({ nativo: false, userAgent: ANDROID })).toBe(true);
    expect(deveConvidar({ nativo: false, userAgent: ANDROID })).toBe(true);
  });
  it('o link aponta para o APK do próprio site', () => {
    expect(APK_URL).toMatch(/radinho\.apk$|^https?:\/\//);
  });
});

describe('conviteAtivo (ambiente real do navegador)', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
  it('reflete user-agent e plataforma nativa do window', () => {
    // jsdom não é Android.
    expect(conviteAtivo()).toBe(false);
  });
});

describe('versão do app instalado', () => {
  it('lê a versão nativa do user-agent do app', () => {
    expect(versaoDoApp(`${ANDROID} RadinhoApp/7`)).toBe(7);
    expect(versaoDoApp(ANDROID)).toBeNull();
  });
});
