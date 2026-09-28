import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispositivoFraco } from '@/lib/perf/dispositivo';

function aparelho(pistas: {
  nucleos?: number;
  memoria?: number;
  ua?: string;
  plataforma?: string;
}): void {
  vi.stubGlobal('navigator', {
    hardwareConcurrency: pistas.nucleos ?? 0,
    deviceMemory: pistas.memoria,
    userAgent: pistas.ua ?? '',
    userAgentData: pistas.plataforma ? { platform: pistas.plataforma } : undefined,
  });
}

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';

afterEach(() => vi.unstubAllGlobals());

describe('dispositivoFraco', () => {
  it('Galaxy S8 (Android, 8 núcleos, 4 GB) é tratado como fraco', () => {
    aparelho({ nucleos: 8, memoria: 4, ua: UA_ANDROID });
    expect(dispositivoFraco()).toBe(true);
  });

  it('usa a plataforma das Client Hints quando existe', () => {
    aparelho({ nucleos: 8, memoria: 4, plataforma: 'Android' });
    expect(dispositivoFraco()).toBe(true);
  });

  it('Android com 8 GB mantém os efeitos', () => {
    aparelho({ nucleos: 8, memoria: 8, ua: UA_ANDROID });
    expect(dispositivoFraco()).toBe(false);
  });

  it('computador com 4 GB informados mantém os efeitos', () => {
    aparelho({ nucleos: 8, memoria: 4, plataforma: 'Windows' });
    expect(dispositivoFraco()).toBe(false);
  });

  it('iPhone (sem deviceMemory) nunca é rebaixado por falta de pista', () => {
    aparelho({ nucleos: 6, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect(dispositivoFraco()).toBe(false);
  });

  it('continua pegando os fracos de sempre', () => {
    aparelho({ nucleos: 2, memoria: 8 });
    expect(dispositivoFraco()).toBe(true);
    aparelho({ nucleos: 8, memoria: 2, plataforma: 'Windows' });
    expect(dispositivoFraco()).toBe(true);
  });
});
