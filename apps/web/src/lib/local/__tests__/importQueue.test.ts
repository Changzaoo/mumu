import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `importQueue` é o que faz "colar o link e fechar a aba" funcionar de
 * verdade: o item persiste em `localStorage` e só o AddMusicDialog (a
 * principal porta de entrada, aberta a QUALQUER usuário) sabe que enfileirou —
 * sem uma notificação no sino, um erro definitivo vira um link que nunca chega
 * e ninguém percebe. Estes testes cobrem exatamente essas duas garantias:
 * `forcePlaylist` (link ambíguo `watch?v=…&list=…`) e a notificação nos
 * finais sem volta (auth, faixa permanentemente indisponível).
 */

const findBySource = vi.fn<(url: string) => { id: string; title: string } | null>(() => null);
const addByUrl = vi.fn<(url: string, opts?: { silent?: boolean }) => Promise<{ title: string }>>();
vi.mock('@/lib/local/localLibrary', () => ({
  findBySource: (url: string) => findBySource(url),
  addByUrl: (url: string, opts?: { silent?: boolean }) => addByUrl(url, opts),
}));

const isPlaylistUrl = vi.fn<(url: string) => boolean>(() => false);
const fetchPlaylistEntries =
  vi.fn<(url: string) => Promise<{ title: string; entries: { url: string; title: string }[] }>>();
vi.mock('@/lib/local/importerHelper', () => ({
  isPlaylistUrl: (url: string) => isPlaylistUrl(url),
  fetchPlaylistEntries: (url: string) => fetchPlaylistEntries(url),
}));

vi.mock('@/lib/firebase', () => ({
  subscribeAuth: () => () => undefined,
}));

const pushNotification = vi.fn();
vi.mock('@/stores/notificationsStore', () => ({
  pushNotification: (...a: unknown[]) => pushNotification(...a),
}));

const naContaRegistrar = vi.fn();
const naContaMarcar = vi.fn();
const naContaTocar = vi.fn();
vi.mock('@/lib/local/importacoesNaConta', () => ({
  registrar: (...a: unknown[]) => naContaRegistrar(...a),
  marcar: (...a: unknown[]) => naContaMarcar(...a),
  tocar: (...a: unknown[]) => naContaTocar(...a),
}));

async function carregar() {
  vi.resetModules();
  window.localStorage.clear();
  return import('../importQueue');
}

/** Espera a fila drenar (poucas microtasks/timers de tick 0 bastam nos casos
 *  testados — nenhum aqui depende de backoff real). */
async function assentar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('importQueue', () => {
  beforeEach(() => {
    findBySource.mockReturnValue(null);
    addByUrl.mockReset();
    isPlaylistUrl.mockReturnValue(false);
    fetchPlaylistEntries.mockReset();
    pushNotification.mockClear();
    naContaRegistrar.mockClear();
    naContaMarcar.mockClear();
    naContaTocar.mockClear();
  });

  it('forcePlaylist expande mesmo quando isPlaylistUrl diz que é uma faixa só', async () => {
    // O link `watch?v=…&list=…` do "compartilhar" do YouTube no celular: a
    // pessoa escolheu explicitamente "playlist inteira mesmo assim", mas o
    // link sozinho aponta para UM vídeo — sem a flag a fila trataria como
    // faixa única e o resto da lista se perderia.
    isPlaylistUrl.mockReturnValue(false);
    fetchPlaylistEntries.mockResolvedValue({
      title: 'Lista',
      entries: [
        { url: 'https://youtu.be/a', title: 'A' },
        { url: 'https://youtu.be/b', title: 'B' },
      ],
    });
    const q = await carregar();
    q.enqueue('https://www.youtube.com/watch?v=x&list=y', { forcePlaylist: true });
    await assentar();

    expect(fetchPlaylistEntries).toHaveBeenCalledWith('https://www.youtube.com/watch?v=x&list=y');
    const urls = q.list().map((i) => i.url);
    expect(urls).toContain('https://youtu.be/a');
    expect(urls).toContain('https://youtu.be/b');
  });

  it('sem forcePlaylist, o mesmo link ambíguo baixa só a faixa', async () => {
    isPlaylistUrl.mockReturnValue(false);
    addByUrl.mockResolvedValue({ title: 'Só a faixa' });
    const q = await carregar();
    q.enqueue('https://www.youtube.com/watch?v=x&list=y');
    await assentar();

    expect(fetchPlaylistEntries).not.toHaveBeenCalled();
    expect(addByUrl).toHaveBeenCalledWith('https://www.youtube.com/watch?v=x&list=y', {
      silent: true,
    });
  });

  it('erro permanente (422/404) vira notificação — quem fechou o diálogo não vê o painel', async () => {
    const erro = Object.assign(new Error('Vídeo indisponível'), { status: 422 });
    addByUrl.mockRejectedValue(erro);
    const q = await carregar();
    q.enqueue('https://youtu.be/morto');
    await assentar();

    const item = q.list()[0];
    expect(item?.status).toBe('error');
    expect(item?.permanent).toBe(true);
    expect(pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'Não deu para baixar' }),
    );
  });

  it('401/403 pausa a fila inteira por auth e notifica uma vez', async () => {
    const erro = Object.assign(new Error('Sem permissão'), { status: 401 });
    addByUrl.mockRejectedValue(erro);
    const q = await carregar();
    q.enqueue('https://youtu.be/sem-login');
    await assentar();

    expect(q.pauseReason()).toBe('auth');
    expect(pushNotification).toHaveBeenCalledTimes(1);
    expect(pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'Downloads pausados' }),
    );
  });

  it('sucesso não notifica — a faixa só aparece na biblioteca', async () => {
    addByUrl.mockResolvedValue({ title: 'Faixa boa' });
    const q = await carregar();
    q.enqueue('https://youtu.be/boa');
    await assentar();

    expect(q.list()[0]?.status).toBe('done');
    expect(pushNotification).not.toHaveBeenCalled();
  });

  it('item ganhando a vez avisa a conta (tocar) — sem isso o servidor rouba a faixa de uma fila ocupada', async () => {
    // Regressão: `atualizadoEm` do registro na conta ficava parado no instante
    // em que o link foi colado. Numa fila ocupada (poucas vagas de download) um
    // item podia continuar "pendente" por mais de 8 minutos só ESPERANDO a vez,
    // e o worker do servidor (CARENCIA_MIN) baixava a mesma faixa de novo com
    // outro id — duplicata. `tocar` precisa ser chamado assim que o item começa
    // a processar, antes de qualquer await.
    addByUrl.mockResolvedValue({ title: 'Faixa boa' });
    const q = await carregar();
    q.enqueue('https://youtu.be/boa');
    await assentar();

    expect(naContaTocar).toHaveBeenCalledWith('https://youtu.be/boa');
  });
});
