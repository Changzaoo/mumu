/**
 * AS DUPLICATAS QUE SOBREVIVIAM A TUDO — e o aviso que sumia junto.
 *
 * Três defeitos diferentes, todos com o mesmo sintoma na tela ("a mesma música
 * duas vezes"), e um quarto que é pior que estético.
 *
 * 1. TÍTULO NÃO-LATINO NUNCA DEDUPLICAVA. `normName` terminava em
 *    `[^a-z0-9]`, então um título em hangul/kana/cirílico virava string vazia, e
 *    `dedupeKey` trata título vazio como "genérico demais para deduplicar com
 *    segurança" devolvendo `null`. Nenhuma cópia dessas faixas era jamais
 *    reunida — nem na tela, nem na limpeza que apaga. Elas se multiplicavam sem
 *    teto, e são justamente as faixas recém-adicionadas ao acervo.
 *
 * 2. O BALDE DE 3s CORTAVA NO MEIO. `Math.round(dur / 3000)` não é tolerância, é
 *    fronteira: 187,4s e 188,6s caem em baldes diferentes e viram músicas
 *    diferentes, separadas por um segundo.
 *
 * 3. O EXPLÍCITO ERA SORTEIO. Cópias são classificadas em separado e divergem;
 *    quem representa o grupo é escolhido por áudio/capa/idade, critérios que
 *    nada têm a ver com conteúdo. A mesma música aparecia explícita numa hora e
 *    limpa em outra — não é inconsistência de exibição, é a proteção falhando.
 *
 * O que estes testes NÃO podem deixar passar é o oposto: duas músicas
 * diferentes, ou duas gravações de durações realmente distintas, colapsando numa
 * só. Deduplicar apaga; um falso positivo aqui some com música da pessoa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import type { LibraryEntry } from '@/lib/local/localLibrary';
import { tituloDuracaoKey } from '@/lib/local/localLibrary';

vi.mock('@/lib/sync/catalogo', () => ({
  publicarNoCatalogo: vi.fn(),
  removerDoCatalogo: vi.fn(),
}));
vi.mock('@/lib/sync/sharedLibrary', () => ({ publishSharedTrack: vi.fn() }));
vi.mock('@/lib/lyrics/syncFromAudio', () => ({ queueLyricsSync: vi.fn() }));

function faixa(
  id: string,
  title: string,
  artist: string | null,
  durationMs: number,
  extra: Partial<TrackDto> = {},
): TrackDto {
  return {
    id,
    title,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: artist ? [{ id: `a:${artist}`, name: artist, slug: '', imageUrl: null }] : [],
    streamUrl: null,
    uploadedByUserId: null,
    ...extra,
  } as TrackDto;
}

const entrada = (track: TrackDto, addedAt = '2026-01-01T00:00:00.000Z'): LibraryEntry =>
  ({ track, addedAt, sizeBytes: 1000, mimeType: 'audio/mpeg' }) as LibraryEntry;

/** Semeia a biblioteca e devolve o módulo recém-carregado. */
async function comBiblioteca(entradas: LibraryEntry[]): Promise<{
  singles: () => TrackDto[];
}> {
  window.localStorage.clear();
  window.localStorage.setItem('aurial:library', JSON.stringify(entradas));
  vi.resetModules();
  return (await import('@/lib/local/localLibrary')) as unknown as { singles: () => TrackDto[] };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('a chave de identidade enxerga qualquer alfabeto', () => {
  it('coreano: duas cópias da mesma faixa têm a MESMA chave', () => {
    const a = faixa('local:1', '소리꾼', '스트레이 키즈', 187_000);
    const b = faixa('local:2', '소리꾼', null, 187_000);
    const ka = tituloDuracaoKey(a);
    expect(ka).not.toBeNull(); // antes: null, e por isso nunca deduplicava
    expect(ka).toBe(tituloDuracaoKey(b));
  });

  it('cirílico e japonês idem', () => {
    expect(tituloDuracaoKey(faixa('local:3', 'Кукушка', 'Кино', 226_000))).not.toBeNull();
    expect(tituloDuracaoKey(faixa('local:4', '打上花火', 'DAOKO', 275_000))).not.toBeNull();
  });

  it('mas músicas coreanas DIFERENTES seguem com chaves diferentes', () => {
    expect(tituloDuracaoKey(faixa('local:5', '소리꾼', null, 187_000))).not.toBe(
      tituloDuracaoKey(faixa('local:6', '별거 아니야', null, 187_000)),
    );
  });
});

describe('a lista mostrada não repete a mesma música', () => {
  it('junta cópias que caem em lados opostos da fronteira de 3s', async () => {
    // 187,4s e 188,6s: um segundo de diferença, baldes 62 e 63.
    const lib = await comBiblioteca([
      entrada(faixa('local:a', 'ÚLTIMA VEZ', 'Alee', 187_400)),
      entrada(faixa('local:b', 'ÚLTIMA VEZ', 'Alee', 188_600)),
    ]);
    expect(lib.singles()).toHaveLength(1);
  });

  it('junta as cópias de título coreano', async () => {
    const lib = await comBiblioteca([
      entrada(faixa('local:c', '소리꾼', '스트레이 키즈', 187_000)),
      entrada(faixa('local:d', '소리꾼', '스트레이 키즈', 187_000)),
    ]);
    expect(lib.singles()).toHaveLength(1);
  });

  // ── O QUE NÃO PODE ACONTECER ────────────────────────────────────────────
  it('NÃO junta músicas diferentes do mesmo artista e duração', async () => {
    const lib = await comBiblioteca([
      entrada(faixa('local:e', 'ESTRESSE', 'Alee', 164_000)),
      entrada(faixa('local:f', 'SEGREDO', 'Alee', 164_000)),
    ]);
    expect(lib.singles()).toHaveLength(2);
  });

  it('NÃO junta gravações de durações realmente distintas', async () => {
    // Versão de rádio × estendida: 2:44 e 5:00. Longe de qualquer vizinhança.
    const lib = await comBiblioteca([
      entrada(faixa('local:g', 'MESMA MÚSICA', 'Alee', 164_000)),
      entrada(faixa('local:h', 'MESMA MÚSICA', 'Alee', 300_000)),
    ]);
    expect(lib.singles()).toHaveLength(2);
  });
});

describe('o aviso de conteúdo explícito sobrevive à fusão', () => {
  it('se QUALQUER cópia é explícita, a que fica é explícita', async () => {
    // A limpa é a "preferida" pelos critérios de completude (tem capa), então
    // sem a fusão do veredito ela venceria e o aviso sumiria da tela.
    const lib = await comBiblioteca([
      entrada(
        faixa('local:i', 'PALAVRÃO', 'Alee', 200_000, {
          explicit: false,
          coverUrl: 'https://exemplo.test/capa.jpg',
        }),
      ),
      entrada(faixa('local:j', 'PALAVRÃO', 'Alee', 200_000, { explicit: true })),
    ]);

    const mostradas = lib.singles();
    expect(mostradas).toHaveLength(1);
    expect(mostradas[0]?.explicit).toBe(true);
  });

  it('duas cópias limpas continuam limpas — a fusão não inventa aviso', async () => {
    const lib = await comBiblioteca([
      entrada(faixa('local:k', 'LIMPA', 'Alee', 200_000, { explicit: false })),
      entrada(faixa('local:l', 'LIMPA', 'Alee', 200_000, { explicit: false })),
    ]);

    const mostradas = lib.singles();
    expect(mostradas).toHaveLength(1);
    expect(mostradas[0]?.explicit).toBe(false);
  });
});
