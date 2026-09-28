/**
 * O RELÓGIO DA LETRA PRECISA ESTAR PRONTO ANTES DE ALGUÉM ABRIR A TELA.
 *
 * `pedirCalibracao` é o único ponto que fala com o importador: o playerStore
 * chama assim que o som sai (letra fechada, `aquecerCalibracao`), e a
 * `LyricsView` chama de novo quando a pessoa abre a tela. As duas chamadas para
 * a MESMA faixa não podem virar dois pedidos.
 *
 * E o motor mudou: com letra publicada, ALINHAMENTO (o texto nunca muda, só
 * ganha relógio); sem letra, transcrição — e só com o que o modelo ouviu com
 * confiança. O reconhecimento livre com o modelo pequeno inventava texto com
 * sotaque e autotune ("proprietary Passe Passe…" em "Mantém", do Matuê).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import type { Lyrics } from '@/lib/lyrics/lyrics';
import type * as Recalibrar from '@/lib/lyrics/recalibrar';
import type * as SyncFromAudio from '@/lib/lyrics/syncFromAudio';
import type {
  LinhaAlinhada,
  RespostaDoAlinhamento,
  RespostaDoTempo,
} from '@/lib/lyrics/recalibrar';

const cachedLyrics = vi.fn<(id: string) => Lyrics | null>();
const writeLyrics = vi.fn();
// A busca da letra (para escolher o idioma) devolve o que o cache tiver —
// igual ao app, onde o prefetch já a deixou lá ou está em voo.
const fetchLyrics = vi.fn(async (t: TrackDto) => cachedLyrics(t.id));
vi.mock('@/lib/lyrics/lyrics', () => ({ cachedLyrics, writeLyrics, fetchLyrics }));
const garantirDetalhe = vi.fn(async () => true);
vi.mock('@/lib/local/detalheDaFaixa', () => ({ garantirDetalhe }));

const buscarTempo = vi.fn<(url: string) => Promise<RespostaDoTempo>>();
const buscarAlinhamento =
  vi.fn<(url: string, linhas: string[]) => Promise<RespostaDoAlinhamento>>();
const aplicarAlinhamento =
  vi.fn<(letra: Lyrics, indices: number[], linhas: LinhaAlinhada[]) => Lyrics | null>();
vi.mock('@/lib/lyrics/recalibrar', async () => {
  const real = await vi.importActual<typeof Recalibrar>('@/lib/lyrics/recalibrar');
  return { ...real, buscarTempo, buscarAlinhamento, aplicarAlinhamento };
});

const remoteUrlFor = vi.fn<(id: string) => string | null>();
vi.mock('@/lib/local/localLibrary', () => ({ remoteUrlFor }));

// `recalibrar.ts` reexporta `palavrasEmLinhas` DAQUI — mockar o módulo
// inteiro sem preservar essa função quebraria o caminho "sem letra nenhuma".
vi.mock('@/lib/lyrics/syncFromAudio', async () => {
  const real = await vi.importActual<typeof SyncFromAudio>('@/lib/lyrics/syncFromAudio');
  return { ...real, dicaDeIdioma: vi.fn(() => 'multi') };
});

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 't1',
    title: 'Mantém',
    durationMs: 206_000,
    artists: [{ id: 'a1', name: 'Matuê', slug: 'matue', imageUrl: null }],
    album: null,
    streamUrl: null,
    ...over,
  }) as TrackDto;

const letra: Lyrics = {
  synced: true,
  source: null,
  lines: [
    { timeMs: 17_020, text: 'Mantém, mantém' },
    { timeMs: 24_240, text: 'Vem mais, mais vem' },
  ],
};
const alinhadas: LinhaAlinhada[] = [
  { startMs: 28_600, endMs: 30_000, words: [] },
  { startMs: 35_800, endMs: 37_000, words: [] },
];

/** N palavras "ouvidas" com a confiança dada. */
const ouvidas = (n: number, prob: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `p${i}`, startMs: i * 400, prob }));

describe('pedirCalibracao / aquecerCalibracao', () => {
  let online: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    cachedLyrics.mockReturnValue(null);
    remoteUrlFor.mockReturnValue('https://importer.x/blob/t1?k=abc');
  });

  afterEach(() => {
    online.mockRestore();
    vi.useRealTimers();
  });

  it('sem cópia no cofre: nem pergunta, devolve null', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    remoteUrlFor.mockReturnValue(null);
    await expect(pedirCalibracao(faixa())).resolves.toBeNull();
    expect(buscarTempo).not.toHaveBeenCalled();
    expect(buscarAlinhamento).not.toHaveBeenCalled();
  });

  it('entrada magra: busca o detalhe e aí usa o link do cofre que chegou', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    let temDetalhe = false;
    remoteUrlFor.mockImplementation(() => (temDetalhe ? 'https://importer.x/blob/t1?k=abc' : null));
    garantirDetalhe.mockImplementationOnce(async () => {
      temDetalhe = true;
      return true;
    });
    buscarTempo.mockResolvedValue({ tipo: 'desistir' });
    await pedirCalibracao(faixa());
    expect(garantirDetalhe).toHaveBeenCalledWith('t1');
    expect(buscarTempo).toHaveBeenCalledWith(expect.stringContaining('/blob/t1/tempo'));
  });

  it('offline: não faz nada', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    online.mockReturnValue(false);
    await expect(pedirCalibracao(faixa())).resolves.toBeNull();
    expect(buscarAlinhamento).not.toHaveBeenCalled();
  });

  it('prévia de 30s (Apple): não casa com o tempo da música inteira', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    await expect(pedirCalibracao(faixa({ previewOnly: true }))).resolves.toBeNull();
    expect(buscarAlinhamento).not.toHaveBeenCalled();
  });

  it('já ALINHADA em cache: devolve na hora, sem rede', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    const pronta = { ...letra, calibrada: true, alinhada: true };
    cachedLyrics.mockReturnValue(pronta);
    await expect(pedirCalibracao(faixa())).resolves.toBe(pronta);
    expect(buscarAlinhamento).not.toHaveBeenCalled();
  });

  it('calibrada pelo motor ANTIGO: é refeita uma vez pelo alinhamento', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue({ ...letra, calibrada: true });
    buscarAlinhamento.mockResolvedValue({ tipo: 'desistir' });
    await pedirCalibracao(faixa());
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);
  });

  it('com letra: ALINHA o texto dela, sem pedir transcrição', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento.mockResolvedValue({ tipo: 'pronto', linhas: alinhadas });
    const reancorada: Lyrics = { ...letra, lines: [] };
    aplicarAlinhamento.mockReturnValue(reancorada);

    const resultado = await pedirCalibracao(faixa());

    expect(buscarAlinhamento).toHaveBeenCalledWith(expect.stringContaining('/blob/t1/alinhar'), [
      'Mantém, mantém',
      'Vem mais, mais vem',
    ]);
    expect(buscarTempo).not.toHaveBeenCalled();
    expect(aplicarAlinhamento).toHaveBeenCalledWith(letra, [0, 1], alinhadas);
    expect(writeLyrics).toHaveBeenCalledWith('t1', {
      ...reancorada,
      calibrada: true,
      alinhada: true,
    });
    expect(resultado).toEqual({ ...reancorada, calibrada: true, alinhada: true });
  });

  it('alinhamento fraco: a letra fica como estava, e não se pergunta de novo', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento.mockResolvedValue({ tipo: 'pronto', linhas: alinhadas });
    aplicarAlinhamento.mockReturnValue(null);
    const resultado = await pedirCalibracao(faixa());
    expect(resultado?.lines).toEqual(letra.lines);
    expect(resultado).toMatchObject({ alinhada: true });
  });

  it('sem letra: a transcrição CONFIÁVEL vira a letra, rotulada', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    buscarTempo.mockResolvedValue({ tipo: 'pronto', words: ouvidas(30, 0.9) });
    const resultado = await pedirCalibracao(faixa());
    expect(resultado?.source).toBe('Transcrição automática');
    expect(resultado?.lines.length).toBeGreaterThan(0);
  });

  it('sem letra e transcrição DUVIDOSA: não inventa — fica sem letra', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    buscarTempo.mockResolvedValue({ tipo: 'pronto', words: ouvidas(30, 0.2) });
    await expect(pedirCalibracao(faixa())).resolves.toBeNull();
    expect(writeLyrics).not.toHaveBeenCalled();
  });

  it('duas chamadas em voo para a mesma faixa: UM só pedido, não dois', async () => {
    const { pedirCalibracao, calibracaoEmVoo } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    let resolver: (r: RespostaDoAlinhamento) => void = () => undefined;
    buscarAlinhamento.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    const a = pedirCalibracao(faixa());
    const b = pedirCalibracao(faixa()); // LyricsView abrindo enquanto o aquecimento espera
    expect(a).toBe(b);
    expect(calibracaoEmVoo('t1')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);

    aplicarAlinhamento.mockReturnValue(letra);
    resolver({ tipo: 'pronto', linhas: alinhadas });
    await a;
    expect(calibracaoEmVoo('t1')).toBe(false);
  });

  it('espera com "esperar" e tenta de novo depois do intervalo', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento
      .mockResolvedValueOnce({ tipo: 'esperar' })
      .mockResolvedValueOnce({ tipo: 'esperar' })
      .mockResolvedValueOnce({ tipo: 'pronto', linhas: alinhadas });
    aplicarAlinhamento.mockReturnValue(letra);

    const promessa = pedirCalibracao(faixa());
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(3);
    expect((await promessa)?.calibrada).toBe(true);
  });

  it('alinhamento PROCESSANDO agora: pergunta nos ~2s, não nos 15s de sempre', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento
      .mockResolvedValueOnce({ tipo: 'esperar', processando: true })
      .mockResolvedValueOnce({ tipo: 'esperar', processando: true })
      .mockResolvedValueOnce({ tipo: 'pronto', linhas: alinhadas });
    aplicarAlinhamento.mockReturnValue(letra);

    const promessa = pedirCalibracao(faixa());
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);
    // 2s bastam enquanto processa — nem chega perto dos 15s do INTERVALO_MS.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(3);
    expect((await promessa)?.calibrada).toBe(true);
  });

  it('alinhamento processando não gasta o orçamento de tentativas (só na fila gasta)', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    // "Processando" por 30 rodadas (bem mais que TENTATIVAS_MAX) sem nunca
    // desistir — só a fila (sem processar) gasta o orçamento.
    buscarAlinhamento.mockResolvedValue({ tipo: 'esperar', processando: true });
    const promessa = pedirCalibracao(faixa());
    for (let i = 0; i < 30; i += 1) await vi.advanceTimersByTimeAsync(2_000);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(31);
    buscarAlinhamento.mockResolvedValueOnce({ tipo: 'pronto', linhas: alinhadas });
    aplicarAlinhamento.mockReturnValue(letra);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await promessa)?.calibrada).toBe(true);
  });

  it('manterVivo falso PARA de perguntar sem esgotar o orçamento', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento.mockResolvedValue({ tipo: 'esperar' });
    let vivo = true;

    const promessa = pedirCalibracao(faixa(), () => vivo);
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);
    vivo = false; // a pessoa pulou para outra faixa
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await promessa).toBeNull();
    expect(buscarAlinhamento).toHaveBeenCalledTimes(1);
  });

  it('desiste depois do orçamento de tentativas, sem travar para sempre', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento.mockResolvedValue({ tipo: 'esperar' });

    const promessa = pedirCalibracao(faixa());
    for (let i = 0; i < 25; i += 1) await vi.advanceTimersByTimeAsync(15_000);
    expect(await promessa).toBeNull();
  });

  it('aquecerCalibracao nunca lança, mesmo se algo no meio der errado', async () => {
    const { aquecerCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letra);
    buscarAlinhamento.mockRejectedValue(new Error('importador fora do ar'));
    expect(() => aquecerCalibracao(faixa(), () => true)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
