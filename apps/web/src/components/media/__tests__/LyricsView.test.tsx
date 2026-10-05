/**
 * LyricsView: a linha certa na hora certa, e nunca a letra de outra faixa.
 * O motor de áudio e a store são simulados; a letra passa por `fetchLyrics`
 * (mock) e pelo react-query de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackDto } from '@radinho/shared';
import type { Lyrics } from '@/lib/lyrics/lyrics';

const motor = vi.hoisted(() => ({ pos: 0, id: 'a' }));

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: {
    getPosition: () => motor.pos,
    get currentTrack() {
      return { id: motor.id };
    },
    on: () => () => undefined,
  },
}));
vi.mock('@/stores/playerStore', async () => {
  const { create } = await import('zustand');
  const usePlayerStore = create(() => ({
    seek: vi.fn(),
    currentTrack: null as { id: string } | null,
    isPlaying: false,
    progress: 0,
  }));
  return { usePlayerStore };
});
vi.mock('@/lib/lyrics/lyrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/lyrics/lyrics')>()),
  fetchLyrics: vi.fn(),
  cachedLyrics: vi.fn(() => null),
}));
vi.mock('@/lib/lyrics/calibragem', async (orig) => ({
  ...(await orig<typeof import('@/lib/lyrics/calibragem')>()),
  pedirCalibracao: vi.fn(() => Promise.resolve(null)),
}));

import { LyricsView } from '@/components/media/LyricsView';
import { fetchLyrics } from '@/lib/lyrics/lyrics';
import { usePlayerStore } from '@/stores/playerStore';

const faixa = (id: string): TrackDto =>
  ({ id, title: id, durationMs: 200_000, artists: [], album: null }) as unknown as TrackDto;

const letra = (textos: string[], tempos?: number[]): Lyrics => ({
  synced: true,
  source: null,
  lines: textos.map((text, i) => ({ timeMs: tempos?.[i] ?? (i + 1) * 1000, text })),
});

function montar(track: TrackDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (t: TrackDto) => (
    <QueryClientProvider client={qc}>
      <LyricsView track={t} />
    </QueryClientProvider>
  );
  const r = render(ui(track));
  return { ...r, trocar: (t: TrackDto) => r.rerender(ui(t)) };
}

const ativa = (): string | null =>
  document.querySelector('[aria-current="true"]')?.textContent?.trim() ?? null;

/** Deixa o efeito de medir (e o setState dele) assentar. */
const assentar = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  vi.mocked(fetchLyrics).mockReset();
  motor.pos = 0;
  motor.id = 'a';
  usePlayerStore.setState({ currentTrack: faixa('a'), isPlaying: false, progress: 0 });
});
afterEach(() => cleanup());

describe('LyricsView: posição e destaque', () => {
  it('seek para ANTES da 1ª linha: nenhuma linha ativa', async () => {
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois', 'três']));
    montar(faixa('a'));
    await screen.findByText('um');
    expect(ativa()).toBeNull();
  });

  it('seek para DEPOIS da última: a última fica ativa', async () => {
    motor.pos = 9999;
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois', 'três']));
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    expect(ativa()).toBe('três');
  });

  it('antecipa 180 ms: a linha acende junto com o vocal', async () => {
    motor.pos = 0.82; // 820 + 180 = 1000 = tempo da 1ª linha
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois']));
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    expect(ativa()).toBe('um');
  });

  it('um instante antes do lead ainda não acendeu', async () => {
    motor.pos = 0.81;
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois']));
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    expect(ativa()).toBeNull();
  });

  it('timestamps iguais: acende a última delas e não quebra', async () => {
    motor.pos = 2;
    vi.mocked(fetchLyrics).mockResolvedValue(
      letra(['a1', 'b1', 'b2', 'c1'], [1000, 2000, 2000, 3000]),
    );
    montar(faixa('a'));
    await screen.findByText('a1');
    await assentar();
    expect(ativa()).toBe('b2');
  });

  it('letra de uma linha só', async () => {
    motor.pos = 5;
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['sozinha']));
    montar(faixa('a'));
    await screen.findByText('sozinha');
    await assentar();
    expect(ativa()).toBe('sozinha');
  });

  it('faixa que NÃO é a atual não acende linha nenhuma (mesmo com o motor adiantado)', async () => {
    usePlayerStore.setState({ currentTrack: faixa('outra') });
    motor.pos = 9999;
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois']));
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    expect(ativa()).toBeNull();
  });

  it('letra sem tempo (texto puro): sem destaque e linhas desabilitadas', async () => {
    vi.mocked(fetchLyrics).mockResolvedValue({
      synced: false,
      source: null,
      lines: [{ timeMs: 0, text: 'solta' }],
    });
    montar(faixa('a'));
    const botao = await screen.findByText('solta');
    expect(botao.closest('button')).toBeDisabled();
    expect(ativa()).toBeNull();
  });
});

describe('LyricsView: o que aparece na tela', () => {
  it('grafia padrão só na exibição ("nois" vira "nós")', async () => {
    vi.mocked(fetchLyrics).mockResolvedValue(
      letra(['não tem pobrema pra você', 'isso é tudo meu', 'nois vai pro baile']),
    );
    montar(faixa('a'));
    await waitFor(() => expect(document.body.textContent).toContain('nós vai pro baile'));
    expect(document.body.textContent).not.toContain('nois');
  });

  it('LRC por palavra incompleto não perde as primeiras palavras da linha', async () => {
    const { toLyrics } =
      await vi.importActual<typeof import('@/lib/lyrics/lyrics')>('@/lib/lyrics/lyrics');
    vi.mocked(fetchLyrics).mockResolvedValue(
      toLyrics({ syncedLyrics: '[00:01.00]Eu vou <00:02.00>ali' }),
    );
    montar(faixa('a'));
    await screen.findByText('ali');
    expect(screen.getByText('Eu')).toBeInTheDocument();
    expect(screen.getByText('vou')).toBeInTheDocument();
  });

  it('linha vazia (pausa instrumental) aparece como ♪', async () => {
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['', 'depois']));
    montar(faixa('a'));
    expect(await screen.findByText('♪')).toBeInTheDocument();
  });

  it('sem letra: mensagem, sem lançar', async () => {
    vi.mocked(fetchLyrics).mockResolvedValue(null);
    montar(faixa('a'));
    expect(await screen.findByText('Sem letra disponível')).toBeInTheDocument();
  });

  it('fonte que lança: cai em "sem letra", não derruba a tela', async () => {
    vi.mocked(fetchLyrics).mockRejectedValue(new Error('rede'));
    montar(faixa('a'));
    expect(await screen.findByText('Sem letra disponível')).toBeInTheDocument();
  });

  it('letra enorme (3 mil linhas) monta e acende a certa', async () => {
    motor.pos = 1500;
    vi.mocked(fetchLyrics).mockResolvedValue(
      letra(
        Array.from({ length: 3000 }, (_, i) => `linha ${i}`),
        Array.from({ length: 3000 }, (_, i) => i * 1000),
      ),
    );
    montar(faixa('a'));
    await waitFor(() => expect(document.querySelectorAll('button').length).toBe(3000));
    await assentar();
    expect(ativa()).toBe('linha 1500');
  });
});

describe('LyricsView: troca rápida de faixa', () => {
  it('a letra da faixa anterior não aparece na nova, nem se ela chegar depois', async () => {
    let soltarA: (l: Lyrics) => void = () => undefined;
    vi.mocked(fetchLyrics).mockImplementation((t) =>
      t.id === 'a'
        ? new Promise<Lyrics>((r) => {
            soltarA = r;
          })
        : Promise.resolve(letra(['letra B'])),
    );
    const { trocar } = montar(faixa('a'));
    trocar(faixa('b'));
    expect(await screen.findByText('letra B')).toBeInTheDocument();

    await act(async () => soltarA(letra(['letra A'])));

    expect(screen.queryByText('letra A')).toBeNull();
    expect(screen.getByText('letra B')).toBeInTheDocument();
  });

  it('o índice ativo da anterior não vaza: a nova começa sem linha ativa', async () => {
    motor.pos = 9999;
    vi.mocked(fetchLyrics).mockImplementation(async (t) =>
      t.id === 'a' ? letra(['a1', 'a2']) : letra(['b1', 'b2']),
    );
    const { trocar } = montar(faixa('a'));
    await screen.findByText('a1');
    await assentar();
    expect(ativa()).toBe('a2');

    motor.pos = 0;
    motor.id = 'b';
    usePlayerStore.setState({ currentTrack: faixa('b') });
    trocar(faixa('b'));
    await screen.findByText('b1');
    await assentar();
    expect(ativa()).toBeNull();
  });
});

describe('LyricsView: rAF só enquanto precisa', () => {
  it('tocando a faixa atual: roda; ao desmontar, para de pedir quadros', async () => {
    usePlayerStore.setState({ isPlaying: true });
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um', 'dois']));
    const pedidos: number[] = [];
    const cancelados: number[] = [];
    let id = 0;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      pedidos.push(++id);
      return id;
    });
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((n) => {
      cancelados.push(n);
    });
    const { unmount } = montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    expect(pedidos.length).toBeGreaterThan(0);
    unmount();
    expect(cancelados).toContain(pedidos[pedidos.length - 1]);
    raf.mockRestore();
    caf.mockRestore();
  });

  it('pausado ou faixa que não é a atual: nenhum rAF', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    // pausado
    vi.mocked(fetchLyrics).mockResolvedValue(letra(['um']));
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    // tocando, mas OUTRA faixa é a atual
    cleanup();
    usePlayerStore.setState({ isPlaying: true, currentTrack: faixa('outra') });
    montar(faixa('a'));
    await screen.findByText('um');
    await assentar();
    const doLaco = raf.mock.calls.length;
    expect(doLaco).toBe(0);
    raf.mockRestore();
  });
});
