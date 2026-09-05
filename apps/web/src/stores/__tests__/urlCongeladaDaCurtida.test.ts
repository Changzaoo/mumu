/**
 * A URL QUE APODRECE DENTRO DA CURTIDA — "antes tocava, hoje não toca".
 *
 * O sintoma relatado: uma faixa marcada como favorita há meses para de tocar,
 * enquanto a MESMA faixa, aberta pela busca ou pelo álbum, toca normalmente.
 *
 * A cadeia, medida no ar em 2026-09-01 com "FACAS E MACHADOS" (Matuê):
 *
 *  1. `localLikes` guarda um `TrackDto` INTEIRO junto do id da curtida
 *     (`aurial:local-liked-tracks`), e nunca mais o atualiza — `applyAdd`
 *     retorna cedo quando o id já está lá. Esse DTO carrega a `streamUrl` do
 *     dia em que a pessoa curtiu.
 *  2. A `streamUrl` de faixa importada é a cópia do cofre, e ela termina em
 *     `?k=<token>`. O token é `crypto.randomBytes(16)` sorteado a CADA
 *     `POST /blob` (apps/importer/server.mjs) — reenviar a faixa (recuperação
 *     do cofre, reimportação, cura automática) troca o token.
 *  3. O cofre responde 403 a quem chega com o token velho. E 403 é exatamente
 *     a prova de morte que o player aceita (`sondarFonteEmParalelo`).
 *  4. `ensurePlayableSource` confia em `track.streamUrl` só por ela existir, e
 *     devolve a faixa sem perguntar nada — o endereço vivo, que o acervo tem e
 *     entrega em `GET /catalogo/:id`, nunca é buscado.
 *  5. Quando a URL velha morre, `resolveNextSource` procura o socorro na
 *     ENTRADA da biblioteca; mas a listagem do acervo ficou magra e não traz
 *     mais `remoteUrl` nem `sourceUrl`, e essa função nunca chama
 *     `garantirDetalhe`. Não há para onde cair, e a faixa é declarada
 *     indisponível com a cópia boa intacta no servidor.
 *
 * Conferido antes de escrever isto: as três cópias de "FACAS E MACHADOS" no
 * acervo estão `tocavel: true` e respondem `206 audio/mpeg` a um
 * `Range: bytes=0-0`. O defeito é do lado do app, não do cofre.
 *
 * O que estes testes guardam é a regra que faltava: para uma faixa importada,
 * quem manda no endereço é o REGISTRO (que se hidrata do servidor), não a
 * fotografia que uma lista tirou meses atrás.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackDto } from '@radinho/shared';

type Handler = (payload: unknown) => void;
const engineHandlers = new Map<string, Handler[]>();

vi.mock('@/lib/audio/AudioEngine', () => {
  const engine = {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    setLocalSourceResolver: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    isTrackEnded: vi.fn(() => false),
    on: vi.fn((event: string, handler: Handler) => {
      const list = engineHandlers.get(event) ?? [];
      list.push(handler);
      engineHandlers.set(event, list);
      return () => undefined;
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    currentTrack: null,
    analyser: null,
  };
  return { audioEngine: engine, AudioEngine: class {} };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(() => Promise.resolve({ data: undefined })),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  buildQuery: () => '',
  resolveMediaUrl: (url: string) => url,
}));

vi.mock('@/lib/audio/mediaSession', () => ({ initMediaSession: vi.fn() }));

// Sem áudio local neste aparelho: é a premissa de todo o arquivo. Só assim o
// player precisa resolver um endereço, que é o que está em teste.
const remoteUrlFor = vi.fn<(id: string) => string | null>(() => null);
const sourceUrlFor = vi.fn<(id: string) => string | null>(() => null);
const reportDeadRemote = vi.fn<(id: string, deadUrl: string) => void>();
vi.mock('@/lib/local/localLibrary', () => ({
  hydrate: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasLocalAudio: vi.fn(() => false),
  ensureLocalAudioUrl: vi.fn(() => Promise.resolve(null)),
  remoteUrlFor: (id: string) => remoteUrlFor(id),
  reportDeadRemote: (id: string, deadUrl: string) => reportDeadRemote(id, deadUrl),
  sourceUrlFor: (id: string) => sourceUrlFor(id),
  setTrackDuration: vi.fn(),
}));

vi.mock('@/features/downloads/downloadManager', () => ({
  hydrateDownloads: vi.fn(() => Promise.resolve()),
  localAudioUrl: vi.fn(() => null),
  hasDownloadedAudio: vi.fn(() => false),
  ensureDownloadedAudioUrl: vi.fn(() => Promise.resolve(null)),
  rebaixarAoFalhar: vi.fn(),
}));

/**
 * `garantirDetalhe` é o único caminho até o endereço VIVO: ele busca
 * `GET /catalogo/:id` e escreve o resultado de volta na entrada. Aqui ele
 * simula essa hidratação preenchendo o que `remoteUrlFor` passa a responder.
 */
const garantirDetalhe = vi.fn<(id: string) => Promise<boolean>>(() => Promise.resolve(false));
vi.mock('@/lib/local/detalheDaFaixa', () => ({
  garantirDetalhe: (id: string) => garantirDetalhe(id),
  informarFila: vi.fn(),
}));

const buildStreamUrl = vi.fn<(url: string) => Promise<string | null>>(() => Promise.resolve(null));
vi.mock('@/lib/local/importerHelper', () => ({
  buildStreamUrl: (url: string) => buildStreamUrl(url),
  importerHostLabel: (host: string) => (/youtube\.com$/i.test(host) ? 'YouTube' : null),
}));

import { initPlayerEngine, usePlayerStore } from '@/stores/playerStore';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { makeTrack } from '@/test/factories';

/** A cópia do cofre como a curtida a fotografou — token de meses atrás. */
const URL_CONGELADA = 'https://importer.example/blob/local%3Afacas?k=28fd134da88d7b18';
/** A mesma faixa, mesmo cofre, token de hoje. É esta que responde 206. */
const URL_VIVA = 'https://importer.example/blob/local%3Afacas?k=4517651280b91929';

const ID = 'local:facas';

/** A faixa como sai de `localLikes.list()`: DTO congelado, com URL velha. */
function faixaCurtida(): TrackDto {
  return makeTrack(ID, { title: 'FACAS E MACHADOS', streamUrl: URL_CONGELADA });
}

/** O que o engine recebeu para tocar. */
function urlCarregada(): string | null {
  const load = vi.mocked(audioEngine.load);
  const ultima = load.mock.calls.at(-1);
  return (ultima?.[0] as TrackDto | undefined)?.streamUrl ?? null;
}

/** Entrega ao player o mesmo evento que o elemento de áudio produz quando a
 *  fonte não carrega — é ele que dispara a busca pela próxima fonte. */
function emitirErroDeCarga(): void {
  const track = usePlayerStore.getState().currentTrack;
  for (const handler of engineHandlers.get('error') ?? []) {
    handler({ message: 'Não foi possível reproduzir esta faixa.', track, kind: 'load' });
  }
}

const initialState = usePlayerStore.getState();

initPlayerEngine();

beforeEach(() => {
  usePlayerStore.setState(initialState, true);
  vi.clearAllMocks();
  remoteUrlFor.mockReturnValue(null);
  sourceUrlFor.mockReturnValue(null);
  buildStreamUrl.mockResolvedValue(null);
  garantirDetalhe.mockResolvedValue(false);
});

describe('a curtida guarda uma fotografia, não o endereço atual', () => {
  it('o registro hidratado manda na URL congelada do DTO', async () => {
    // O registro já sabe o endereço de hoje (o assimilador passou por ele).
    remoteUrlFor.mockReturnValue(URL_VIVA);

    usePlayerStore.getState().playTrack(faixaCurtida(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    // ANTES: carregava URL_CONGELADA e o cofre respondia 403.
    expect(urlCarregada()).toBe(URL_VIVA);
  });

  it('entrada ainda MAGRA: busca o detalhe em vez de confiar na fotografia', async () => {
    // A entrada do acervo chega sem URL nenhuma — só o bit `tocavel`. O
    // endereço vivo só existe depois de `garantirDetalhe`.
    garantirDetalhe.mockImplementation(() => {
      remoteUrlFor.mockReturnValue(URL_VIVA);
      return Promise.resolve(true);
    });

    usePlayerStore.getState().playTrack(faixaCurtida(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    expect(garantirDetalhe).toHaveBeenCalledWith(ID);
    expect(urlCarregada()).toBe(URL_VIVA);
  });

  it('sem nada melhor no registro, a URL da curtida ainda é tentada', async () => {
    // O contrário do defeito também não pode acontecer: quando o registro não
    // tem endereço nenhum, a fotografia é a única pista e vale tentar. Perder
    // isto trocaria um defeito por outro — faixa que hoje toca ficaria muda.
    usePlayerStore.getState().playTrack(faixaCurtida(), { source: 'library' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    expect(urlCarregada()).toBe(URL_CONGELADA);
  });

  it('faixa que NÃO é do acervo local não paga ida à rede', async () => {
    // Rádio, podcast, faixa compartilhada: a `streamUrl` que vem com elas é a
    // única que existe e é a boa. Nada a hidratar, nada a perguntar.
    const radio = makeTrack('radio:1', { streamUrl: 'https://stream.example/live.mp3' });
    usePlayerStore.getState().playTrack(radio, { source: 'radio' });
    await vi.waitFor(() => expect(audioEngine.load).toHaveBeenCalled());

    expect(garantirDetalhe).not.toHaveBeenCalled();
    expect(urlCarregada()).toBe('https://stream.example/live.mp3');
  });
});

describe('quando a URL congelada morre, ainda há para onde cair', () => {
  it('o socorro hidrata o detalhe em vez de desistir', async () => {
    // O registro TAMBÉM está velho: ele foi hidratado de um instantâneo do
    // acervo guardado no IndexedDB, de quando a URL ainda valia. É o caso comum
    // — o cache do acervo é entregue no boot, antes de qualquer rede.
    remoteUrlFor.mockReturnValue(URL_CONGELADA);

    // A cura projetada em `reportDeadRemote`: confirmado o 403, a URL podre é
    // apagada da entrada JUSTAMENTE para que a próxima busca traga a atual.
    reportDeadRemote.mockImplementation(() => {
      remoteUrlFor.mockReturnValue(null);
    });
    garantirDetalhe.mockImplementation(() => {
      remoteUrlFor.mockReturnValue(URL_VIVA);
      return Promise.resolve(true);
    });

    usePlayerStore.getState().playTrack(faixaCurtida(), { source: 'library' });
    await vi.waitFor(() => expect(urlCarregada()).toBe(URL_CONGELADA));

    // O cofre recusa a URL velha (403) — o player reporta e procura a próxima.
    emitirErroDeCarga();

    // ANTES: `resolveNextSource` lia o registro (agora vazio), achava null e o
    // player parava com "Faixa indisponível" — com a cópia boa viva no cofre.
    await vi.waitFor(() => expect(urlCarregada()).toBe(URL_VIVA));
  });
});
