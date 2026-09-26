/**
 * O AQUECIMENTO PRECISA ESTAR PRONTO ANTES DE ALGUÉM ABRIR A LETRA.
 *
 * `pedirCalibracao` é o único ponto que fala com `GET /blob/:id/tempo` — o
 * playerStore chama por baixo dos panos assim que o som sai (letra fechada,
 * `aquecerCalibracao`), e a `LyricsView` chama de novo quando a pessoa abre a
 * tela. As duas chamadas para a MESMA faixa não podem virar dois pedidos ao
 * importador: é exatamente esse dobro que este arquivo tranca.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import type { Lyrics } from '@/lib/lyrics/lyrics';
import type { AsrWord } from '@/lib/lyrics/align';
import type * as Recalibrar from '@/lib/lyrics/recalibrar';
import type * as SyncFromAudio from '@/lib/lyrics/syncFromAudio';
import type { RespostaDoTempo } from '@/lib/lyrics/recalibrar';

const cachedLyrics = vi.fn<(id: string) => Lyrics | null>();
const writeLyrics = vi.fn();
// A busca da letra (para escolher o idioma) devolve o que o cache tiver —
// igual ao app, onde o prefetch já a deixou lá ou está em voo.
const fetchLyrics = vi.fn(async (t: TrackDto) => cachedLyrics(t.id));
vi.mock('@/lib/lyrics/lyrics', () => ({ cachedLyrics, writeLyrics, fetchLyrics }));
const garantirDetalhe = vi.fn(async () => true);
vi.mock('@/lib/local/detalheDaFaixa', () => ({ garantirDetalhe }));

const buscarTempo = vi.fn<(url: string) => Promise<RespostaDoTempo>>();
const recalibrarLetra = vi.fn<(letra: Lyrics, palavras: AsrWord[]) => Lyrics | null>();
vi.mock('@/lib/lyrics/recalibrar', async () => {
  const real = await vi.importActual<typeof Recalibrar>('@/lib/lyrics/recalibrar');
  return { ...real, buscarTempo, recalibrarLetra };
});

const remoteUrlFor = vi.fn<(id: string) => string | null>();
vi.mock('@/lib/local/localLibrary', () => ({ remoteUrlFor }));

// `recalibrar.ts` reexporta `palavrasEmLinhas` DAQUI — mockar o módulo
// inteiro sem preservar essa função quebraria o caminho "sem letra nenhuma"
// silenciosamente (o erro cairia no `catch` de `pedirCalibracao`).
vi.mock('@/lib/lyrics/syncFromAudio', async () => {
  const real = await vi.importActual<typeof SyncFromAudio>('@/lib/lyrics/syncFromAudio');
  return { ...real, dicaDeIdioma: vi.fn(() => 'multi') };
});

const faixa = (over: Partial<TrackDto> = {}): TrackDto =>
  ({
    id: 't1',
    title: 'Bad and Boujee',
    durationMs: 335_000,
    artists: [{ id: 'a1', name: 'Migos', slug: 'migos', imageUrl: null }],
    album: null,
    streamUrl: null,
    ...over,
  }) as TrackDto;

const letraPlana: Lyrics = {
  synced: false,
  source: null,
  lines: [{ timeMs: 0, text: 'raindrop drop top' }],
};

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
    expect(buscarTempo).not.toHaveBeenCalled();
  });

  it('prévia de 30s (Apple): não casa com o tempo da música inteira', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    await expect(pedirCalibracao(faixa({ previewOnly: true }))).resolves.toBeNull();
    expect(buscarTempo).not.toHaveBeenCalled();
  });

  it('já calibrada em cache: devolve na hora, sem rede', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    const pronta: Lyrics = { ...letraPlana, synced: true, calibrada: true };
    cachedLyrics.mockReturnValue(pronta);
    await expect(pedirCalibracao(faixa())).resolves.toBe(pronta);
    expect(buscarTempo).not.toHaveBeenCalled();
  });

  it('resposta pronta: reancora a letra em cache e grava calibrada', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    const palavras: AsrWord[] = [{ text: 'raindrop', startMs: 500 }];
    cachedLyrics.mockReturnValue(letraPlana);
    buscarTempo.mockResolvedValue({ tipo: 'pronto', words: palavras });
    const reancorada: Lyrics = { ...letraPlana, synced: true };
    recalibrarLetra.mockReturnValue(reancorada);

    const resultado = await pedirCalibracao(faixa());

    expect(recalibrarLetra).toHaveBeenCalledWith(letraPlana, palavras);
    expect(writeLyrics).toHaveBeenCalledWith('t1', { ...reancorada, calibrada: true });
    expect(resultado).toEqual({ ...reancorada, calibrada: true });
  });

  it('sem letra nenhuma em cache: a transcrição vira a própria letra', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(null);
    buscarTempo.mockResolvedValue({
      tipo: 'pronto',
      words: [{ text: 'oi', startMs: 0 }],
    });

    const resultado = await pedirCalibracao(faixa());

    expect(recalibrarLetra).not.toHaveBeenCalled();
    expect(resultado?.calibrada).toBe(true);
    expect(resultado?.source).toBe('Transcrição do áudio');
    expect(resultado?.lines[0]?.text).toBe('oi');
  });

  it('duas chamadas em voo para a mesma faixa: UM só pedido, não dois', async () => {
    const { pedirCalibracao, calibracaoEmVoo } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letraPlana);
    let resolver: (r: RespostaDoTempo) => void = () => undefined;
    buscarTempo.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    const a = pedirCalibracao(faixa());
    const b = pedirCalibracao(faixa()); // LyricsView abrindo enquanto o aquecimento ainda espera
    expect(a).toBe(b); // mesma promessa: nenhum segundo laço foi aberto
    expect(calibracaoEmVoo('t1')).toBe(true);
    expect(buscarTempo).toHaveBeenCalledTimes(1);

    recalibrarLetra.mockReturnValue({ ...letraPlana, synced: true });
    resolver({ tipo: 'pronto', words: [{ text: 'oi', startMs: 0 }] });
    await a;
    expect(calibracaoEmVoo('t1')).toBe(false);
  });

  it('espera com "esperar" e tenta de novo depois do intervalo', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letraPlana);
    buscarTempo
      .mockResolvedValueOnce({ tipo: 'esperar' })
      .mockResolvedValueOnce({ tipo: 'esperar' })
      .mockResolvedValueOnce({ tipo: 'pronto', words: [{ text: 'oi', startMs: 0 }] });
    recalibrarLetra.mockReturnValue({ ...letraPlana, synced: true });

    const promessa = pedirCalibracao(faixa());
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarTempo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(buscarTempo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(buscarTempo).toHaveBeenCalledTimes(3);

    const resultado = await promessa;
    expect(resultado?.calibrada).toBe(true);
  });

  it('manterVivo falso PARA de perguntar sem esgotar o orçamento de tentativas', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letraPlana);
    buscarTempo.mockResolvedValue({ tipo: 'esperar' });
    let vivo = true;

    const promessa = pedirCalibracao(faixa(), () => vivo);
    await vi.advanceTimersByTimeAsync(0);
    expect(buscarTempo).toHaveBeenCalledTimes(1);
    vivo = false; // a faixa deixou de ser atual/próxima (a pessoa pulou)
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await promessa).toBeNull();
    expect(buscarTempo).toHaveBeenCalledTimes(1); // não gastou mais nenhuma pergunta
  });

  it('desiste depois do orçamento de tentativas, sem travar para sempre', async () => {
    const { pedirCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letraPlana);
    buscarTempo.mockResolvedValue({ tipo: 'esperar' });

    const promessa = pedirCalibracao(faixa());
    for (let i = 0; i < 12; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(await promessa).toBeNull();
  });

  it('aquecerCalibracao nunca lança, mesmo se algo no meio der errado', async () => {
    const { aquecerCalibracao } = await import('@/lib/lyrics/calibragem');
    cachedLyrics.mockReturnValue(letraPlana);
    buscarTempo.mockRejectedValue(new Error('importador fora do ar'));
    expect(() => aquecerCalibracao(faixa(), () => true)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
