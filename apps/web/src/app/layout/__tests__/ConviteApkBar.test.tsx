import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConviteApkBar } from '@/app/layout/ConviteApkBar';
import { APK_URL } from '@/lib/android/conviteApk';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; moto g34 5G) AppleWebKit/537.36 Chrome/128 Mobile';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';

function ambiente(userAgent: string, nativo = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => nativo,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('ConviteApkBar', () => {
  it('aparece no Android pelo navegador, com link para o APK', () => {
    ambiente(ANDROID);
    render(<ConviteApkBar />);
    expect(screen.getByRole('complementary', { name: /instalar o app/i })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Instalar' });
    expect(link.getAttribute('href')).toBe(APK_URL);
    expect(link.hasAttribute('download')).toBe(true);
  });
  it('não tem botão de fechar e reaparece a cada abertura (nova montagem)', () => {
    ambiente(ANDROID);
    const { unmount } = render(<ConviteApkBar />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<ConviteApkBar />);
    expect(screen.getByRole('link', { name: 'Instalar' })).toBeTruthy();
  });
  it('não aparece no app nativo, no iOS nem no desktop', () => {
    for (const [ua, nativo] of [
      [ANDROID, true],
      [IPHONE, false],
      [DESKTOP, false],
    ] as const) {
      ambiente(ua, nativo);
      const { container, unmount } = render(<ConviteApkBar />);
      expect(container.innerHTML).toBe('');
      unmount();
      vi.restoreAllMocks();
    }
  });
});
