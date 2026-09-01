/**
 * O TETO DE ALÇAS DE ÁUDIO — o conserto do "estoura a RAM e mata a página".
 *
 * `URL.createObjectURL` devolve uma ALÇA que segura o arquivo inteiro vivo até
 * alguém revogar. Este módulo guardava uma alça por faixa baixada num mapa sem
 * teto, e `hydrateDownloads` abria TODAS no boot, antes da primeira tela. Cem
 * faixas de 8 MB = ~800 MB presos num aparelho que talvez tenha 2 GB.
 *
 * `localLibrary` já tinha ganhado esse teto; este módulo é a segunda cópia do
 * mesmo mapa e ficou de fora — por isso o sintoma sobreviveu ao primeiro
 * conserto. Estes testes existem para que a terceira cópia não aconteça em
 * silêncio.
 *
 * O contrato, em quatro partes:
 *   1. o boot não abre alça nenhuma;
 *   2. o mapa nunca passa do teto, e o que sai é revogado de verdade;
 *   3. alça podada NÃO é faixa perdida — ela reabre sob demanda, e enquanto
 *      isso a faixa continua se declarando baixada;
 *   4. bytes despejados pelo navegador corrigem o registro em vez de virarem
 *      um download que não toca.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

/** Cofre de bytes de mentira (o IndexedDB real). */
const cofre = new Map<string, Blob>();

/** Registro de mentira — no app é localStorage, síncrono. */
const registro = new Map<string, { track: TrackDto; sizeBytes: number }>();

vi.mock('@/lib/offline/audioCache', () => ({
  cacheSupported: () => true,
  getAudioBlob: vi.fn(async (id: string) => cofre.get(id) ?? null),
  putAudio: vi.fn(async (id: string, blob: Blob) => {
    cofre.set(id, blob);
  }),
  deleteAudio: vi.fn(async (id: string) => {
    cofre.delete(id);
  }),
  requestPersistentStorage: vi.fn(async () => true),
}));

vi.mock('@/features/downloads/registry', () => ({
  getDownloads: () => [...registro.values()],
  isDownloaded: (id: string) => registro.has(id),
  addDownload: (track: TrackDto, sizeBytes = 0) => {
    registro.set(track.id, { track, sizeBytes });
  },
  removeDownload: (id: string) => {
    registro.delete(id);
  },
  totalDownloadedBytes: () => 0,
  clearDownloads: () => registro.clear(),
  subscribeDownloads: () => () => undefined,
}));

vi.mock('@/lib/api', () => ({ isFirstPartyUrl: () => false }));
vi.mock('@/lib/firebase', () => ({ getIdToken: async () => null }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));
vi.mock('@/stores/notificationsStore', () => ({ pushNotification: vi.fn() }));

/**
 * Contador de alças ABERTAS — a medida que importa.
 *
 * Não conta chamadas: conta quantas alças estão vivas neste instante
 * (criadas menos revogadas). É exatamente o que o navegador está segurando na
 * memória, e é o número que estourava.
 */
const alcas = { abertas: new Set<string>(), criadas: 0 };

beforeEach(() => {
  cofre.clear();
  registro.clear();
  alcas.abertas.clear();
  alcas.criadas = 0;
  vi.stubGlobal('URL', {
    createObjectURL: (_blob: Blob) => {
      const url = `blob:fake/${alcas.criadas++}`;
      alcas.abertas.add(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      alcas.abertas.delete(url);
    },
  });
  vi.resetModules();
});

const faixa = (id: string): TrackDto =>
  ({ id, title: `Faixa ${id}`, artists: [], durationMs: 1000 }) as unknown as TrackDto;

/** Índice do cenário, com erro claro se o próprio teste estiver mal montado. */
function em(lista: readonly TrackDto[], i: number): TrackDto {
  const t = lista.at(i);
  if (!t) throw new Error(`cenário sem faixa no índice ${i}`);
  return t;
}

/** Popula o cofre + registro como se N faixas já tivessem sido baixadas. */
function jaBaixadas(n: number): TrackDto[] {
  const lista: TrackDto[] = [];
  for (let i = 0; i < n; i++) {
    const t = faixa(`t${i}`);
    cofre.set(t.id, new Blob(['x'.repeat(1024)], { type: 'audio/mpeg' }));
    registro.set(t.id, { track: t, sizeBytes: 1024 });
    lista.push(t);
  }
  return lista;
}

describe('alças de áudio dos downloads', () => {
  it('o boot NÃO abre alça nenhuma, por mais faixas baixadas que existam', async () => {
    jaBaixadas(500);
    const dm = await import('@/features/downloads/downloadManager');

    await dm.hydrateDownloads();

    // Este era o estouro: 500 alças abertas antes da primeira tela pintar.
    expect(alcas.abertas.size).toBe(0);
    expect(alcas.criadas).toBe(0);
  });

  it('nunca segura mais que o teto, e revoga de verdade o que sai', async () => {
    const lista = jaBaixadas(200);
    const dm = await import('@/features/downloads/downloadManager');

    for (const t of lista) await dm.ensureDownloadedAudioUrl(t.id);

    // 200 pedidas, mas o que fica VIVO é o teto — o resto foi revogado.
    expect(alcas.criadas).toBe(200);
    expect(alcas.abertas.size).toBeLessThanOrEqual(60);
    expect(alcas.abertas.size).toBe(60);
  });

  it('a faixa que acabou de tocar nunca é a podada', async () => {
    const lista = jaBaixadas(100);
    const dm = await import('@/features/downloads/downloadManager');

    for (const t of lista) await dm.ensureDownloadedAudioUrl(t.id);

    // A última pedida é a que está tocando: soltar a alça dela emudeceria a
    // música na hora. Por construção da fila LRU ela é sempre a mais recente.
    const ultima = em(lista, -1);
    expect(dm.localAudioUrl(ultima.id)).not.toBeNull();
    expect(alcas.abertas.has(dm.localAudioUrl(ultima.id) as string)).toBe(true);
  });

  it('alça podada não é faixa perdida: continua baixada e reabre sob demanda', async () => {
    const lista = jaBaixadas(100);
    const dm = await import('@/features/downloads/downloadManager');

    for (const t of lista) await dm.ensureDownloadedAudioUrl(t.id);

    const antiga = em(lista, 0); // primeira da fila = a primeira a ser podada
    expect(dm.localAudioUrl(antiga.id)).toBeNull(); // alça foi solta

    // ...mas os bytes continuam aqui, e o app tem de dizer isso. Se
    // `downloadStateOf` respondesse ao mapa de alças em vez de ao registro, a
    // faixa apareceria como "não baixada" e a pessoa a baixaria de novo.
    expect(dm.hasDownloadedAudio(antiga.id)).toBe(true);
    expect(dm.downloadStateOf(antiga.id).status).toBe('downloaded');

    const reaberta = await dm.ensureDownloadedAudioUrl(antiga.id);
    expect(reaberta).not.toBeNull();
    expect(dm.localAudioUrl(antiga.id)).toBe(reaberta);
  });

  it('pedir a mesma faixa de novo reaproveita a alça em vez de abrir outra', async () => {
    jaBaixadas(1);
    const dm = await import('@/features/downloads/downloadManager');

    const primeira = await dm.ensureDownloadedAudioUrl('t0');
    const segunda = await dm.ensureDownloadedAudioUrl('t0');

    expect(segunda).toBe(primeira);
    expect(alcas.criadas).toBe(1); // sem alça duplicada para o mesmo arquivo
  });

  it('bytes despejados pelo navegador corrigem o registro em vez de mentir', async () => {
    jaBaixadas(1);
    const dm = await import('@/features/downloads/downloadManager');

    cofre.delete('t0'); // o navegador recuperou espaço por conta própria

    expect(await dm.ensureDownloadedAudioUrl('t0')).toBeNull();
    // A poda saiu do boot (que varria tudo) e virou preguiçosa: acontece na
    // faixa pedida, no momento em que a verdade importa.
    expect(dm.hasDownloadedAudio('t0')).toBe(false);
    expect(dm.downloadStateOf('t0').status).toBe('idle');
  });

  it('faixa que nunca foi baixada não abre alça nem inventa URL', async () => {
    const dm = await import('@/features/downloads/downloadManager');

    expect(await dm.ensureDownloadedAudioUrl('inexistente')).toBeNull();
    expect(alcas.criadas).toBe(0);
  });
});
