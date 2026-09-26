/**
 * UMA ABERTURA DO APP É UMA SESSÃO — nem duas, nem três PUTs.
 *
 * O `subscribeAuth` avisa na hora com o estado atual. Para o visitante, esse
 * aviso repete o `null` com que a telemetria já tinha começado, e reagir a ele
 * com stop()+start() mandava três PUTs idênticos no boot e contava DUAS
 * sessões por abertura. Medido na produção em 2026-09-26.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Ouvinte = (user: { uid: string } | null) => void;
let ouvinte: Ouvinte | null = null;

vi.mock('@/lib/firebase', () => ({
  getIdToken: vi.fn(async () => null),
  subscribeAuth: (cb: Ouvinte) => {
    ouvinte = cb;
    cb(null); // como o de verdade: avisa na hora com o estado atual
    return () => undefined;
  },
}));
vi.mock('@/lib/local/importerHelper', () => ({
  measureNetworkSpeed: vi.fn(async () => ({ downMbps: null, upMbps: null })),
}));
vi.mock('@/features/downloads/registry', () => ({ getDownloads: () => [] }));
vi.mock('@/lib/devices/presence', () => ({
  deviceLabel: () => 'teste',
  getDeviceId: () => 'aparelho-1',
}));
vi.mock('@/lib/local/localHistory', () => ({ list: () => [] }));
vi.mock('@/lib/local/localLibrary', () => ({ list: () => [], totalBytes: () => 0 }));
vi.mock('@/lib/local/localLikes', () => ({ count: () => 0 }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: { getState: () => ({}) } }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock('@/lib/telemetry/vitals', () => ({ getVitals: () => ({}), initVitals: vi.fn() }));
vi.mock('@/lib/telemetry/aoVivo', () => ({ coletarAoVivo: () => ({}), instalarAoVivo: vi.fn() }));
vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit): Promise<Response> => new Response('{}'),
);

async function puts(): Promise<Array<Record<string, unknown>>> {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)).dados);
}

describe('telemetria: uma sessão por abertura', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockClear();
    ouvinte = null;
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
  });

  it('o aviso inicial do login (mesmo visitante) não reinicia a sessão', async () => {
    const { initTelemetry } = await import('@/lib/telemetry/telemetry');
    initTelemetry();

    const enviados = await puts();
    expect(enviados).toHaveLength(1);
    const sessoes = enviados.filter((d) => d.sessions !== undefined);
    expect(sessoes).toHaveLength(1);
  });

  it('entrar numa conta de verdade AINDA reinicia a sessão', async () => {
    const { initTelemetry } = await import('@/lib/telemetry/telemetry');
    initTelemetry();
    await puts();
    fetchMock.mockClear();

    ouvinte?.({ uid: 'usuario-1' });

    const enviados = await puts();
    expect(enviados.some((d) => d.sessions !== undefined)).toBe(true);
  });
});
