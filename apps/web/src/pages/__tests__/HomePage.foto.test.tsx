import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/audio/AudioEngine', () => ({
  audioEngine: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setRate: vi.fn(),
    preloadNext: vi.fn(),
    setEq: vi.fn(),
    setNormalizeVolume: vi.fn(),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getBufferedEnd: vi.fn(() => 0),
    on: vi.fn(() => () => undefined),
    analyser: null,
    setLocalSourceResolver: vi.fn(),
  },
  AudioEngine: class {},
}));
vi.mock('@/components/media/CommunityTracksRow', () => ({ CommunityTracksRow: () => null }));
vi.mock('@/components/media/DeviceTracksRow', () => ({ DeviceTracksRow: () => null }));
vi.mock('@/lib/artistImage', () => ({ useArtistImage: () => null }));

/** As prateleiras TARDIAS (recomendações, mixes) são o trabalho caro que não pode repetir a cada volta. */
const caros = vi.hoisted(() => ({ semanticos: 0 }));
vi.mock('@/lib/reco/semanticMixes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/reco/semanticMixes')>();
  return {
    ...real,
    buildSemanticMixes: (...args: Parameters<typeof real.buildSemanticMixes>) => {
      caros.semanticos += 1;
      return real.buildSemanticMixes(...args);
    },
  };
});

/** Quantas vezes a Home cedeu a thread enquanto montava a foto (fatias). */
const cedidas = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/perf/ceder', () => ({
  cederAThread: () => {
    cedidas.n += 1;
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  },
}));

import { makeTrack } from '@/test/factories';

function faixa(id: string, genero: string, titulo: string) {
  return {
    track: {
      ...makeTrack(id, { title: titulo }),
      genre: genero,
      artists: [{ id: `a:${genero}`, name: `Cantor de ${genero}`, slug: '', imageUrl: null }],
    },
    addedAt: new Date().toISOString(),
    sizeBytes: 1,
    mimeType: 'audio/mpeg',
  };
}

function semearBiblioteca(): void {
  const biblioteca = [
    ...Array.from({ length: 12 }, (_, i) => faixa(`r${i}`, 'Rock', `Rock ${i}`)),
    ...Array.from({ length: 8 }, (_, i) => faixa(`g${i}`, 'Gospel', `Gospel ${i}`)),
  ];
  window.localStorage.setItem('aurial:library', JSON.stringify(biblioteca));
}

function envolver(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Esvazia a store (apagar o banco ficaria bloqueado pela conexão do teste anterior). */
function apagarFotoDoDisco(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open('aurial-home-foto', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('foto')) req.result.createObjectStore('foto');
    };
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('foto', 'readwrite');
      tx.objectStore('foto').clear();
      const fim = (): void => {
        db.close();
        resolve();
      };
      tx.oncomplete = fim;
      tx.onerror = fim;
      tx.onabort = fim;
    };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  window.localStorage.clear();
  caros.semanticos = 0;
  cedidas.n = 0;
  await apagarFotoDoDisco();
});

describe('Home — a foto e a volta', () => {
  it(
    'voltar à Home não recalcula as prateleiras nem refaz o trabalho caro',
    { timeout: 60_000 },
    async () => {
      semearBiblioteca();
      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      localLibrary.marcarAssentada();
      const albumGroups = vi.spyOn(localLibrary, 'albumGroups');
      const genreGroups = vi.spyOn(localLibrary, 'genreGroups');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = envolver(queryClient);

      // 1ª visita: tira a foto e calcula as prateleiras tardias (em folga).
      const primeira = render(<HomePage />, { wrapper });
      expect(await screen.findByText('Gospel')).toBeInTheDocument();
      await waitFor(() => expect(caros.semanticos).toBeGreaterThan(0), { timeout: 8_000 });
      const calculos = {
        albuns: albumGroups.mock.calls.length,
        generos: genreGroups.mock.calls.length,
        semanticos: caros.semanticos,
      };
      expect(calculos.albuns).toBeGreaterThan(0);

      // Sai da Home (a página desmonta, como no router) e VOLTA, várias vezes.
      let atual = primeira;
      for (let volta = 0; volta < 4; volta++) {
        atual.unmount();
        atual = render(<HomePage />, { wrapper });
        // Na volta a foto sai no primeiro quadro: sem esqueleto, sem esperar nada.
        expect(screen.getByText('Gospel')).toBeInTheDocument();
        expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      }
      const ultima = atual;
      // Dá folga para qualquer trabalho ocioso indevido acontecer.
      await new Promise((r) => setTimeout(r, 800));

      expect(albumGroups.mock.calls.length).toBe(calculos.albuns);
      expect(genreGroups.mock.calls.length).toBe(calculos.generos);
      expect(caros.semanticos).toBe(calculos.semanticos);
      ultima.unmount();
    },
  );

  it(
    'importar música tira uma foto nova (a biblioteca mudou de tamanho)',
    { timeout: 60_000 },
    async () => {
      semearBiblioteca();
      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      localLibrary.marcarAssentada();
      const albumGroups = vi.spyOn(localLibrary, 'albumGroups');
      const wrapper = envolver(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

      const primeira = render(<HomePage />, { wrapper });
      expect(await screen.findByText('Gospel')).toBeInTheDocument();
      const antes = albumGroups.mock.calls.length;
      primeira.unmount();

      // Entra uma faixa de um gênero novo.
      localLibrary.aplicarCatalogo([
        { ...faixa('j0', 'Jazz', 'Jazz 0'), tocavel: true, origem: 'catalogo' } as never,
      ]);
      render(<HomePage />, { wrapper });
      await screen.findByText('Gospel');
      expect(albumGroups.mock.calls.length).toBeGreaterThan(antes);
    },
  );

  it(
    'pinta com a foto da última visita ANTES de a biblioteca assentar',
    { timeout: 60_000 },
    async () => {
      const { salvarFotoDaHome } = await import('@/lib/perf/fotoDaHome');
      await salvarFotoDaHome({
        tronco: {
          key: 'genre:Forró',
          titulo: 'Forró',
          subtitulo: 'O que mais toca por aqui',
          faixas: [
            {
              id: 'f1',
              title: 'Asa Branca',
              artist: 'Luiz Gonzaga',
              coverUrl: null,
              durationMs: 1000,
            },
          ],
        },
        ramos: [
          {
            key: 'ramo:1',
            titulo: 'Forró para descobrir',
            subtitulo: 'Pelo que você ouve',
            faixas: [
              { id: 'f2', title: 'Xote', artist: 'Dominguinhos', coverUrl: null, durationMs: 1000 },
            ],
          },
        ],
        daSemente: [],
        artistas: [{ name: 'Luiz Gonzaga', coverUrl: null }],
      });

      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      const wrapper = envolver(new QueryClient({ defaultOptions: { queries: { retry: false } } }));

      // A biblioteca NÃO assentou (nem foi lida): só há a foto guardada.
      expect(localLibrary.bibliotecaAssentada()).toBe(false);
      render(<HomePage />, { wrapper });

      expect(await screen.findByText('Forró')).toBeInTheDocument();
      expect(screen.getByText('Forró para descobrir')).toBeInTheDocument();
      expect(screen.getAllByText('Asa Branca').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Luiz Gonzaga').length).toBeGreaterThan(0);
      // Sem esqueleto: o primeiro quadro já tem conteúdo.
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(localLibrary.bibliotecaAssentada()).toBe(false);
    },
  );

  it(
    'biblioteca grande: a foto é montada em fatias (cede a thread), com o mesmo conteúdo',
    { timeout: 60_000 },
    async () => {
      const grande = Array.from({ length: 1_600 }, (_, i) =>
        faixa(`g${i}`, i % 2 ? 'Rock' : 'Gospel', `Faixa ${i}`),
      );
      window.localStorage.setItem('aurial:library', JSON.stringify(grande));
      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      localLibrary.marcarAssentada();
      const wrapper = envolver(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
      const { container } = render(<HomePage />, { wrapper });

      // No primeiro quadro ainda não há foto: o render NÃO carregou o trabalho caro.
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(await screen.findByText('Gospel', {}, { timeout: 15_000 })).toBeInTheDocument();
      expect(screen.getByText('Rock')).toBeInTheDocument();
      // Os passos de `passosDaHome` devolveram a vez ao navegador.
      expect(cedidas.n).toBeGreaterThanOrEqual(4);
    },
  );

  it('sem foto guardada e sem biblioteca, o esqueleto continua', { timeout: 60_000 }, async () => {
    const { default: HomePage } = await import('@/pages/HomePage');
    const wrapper = envolver(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    const { container } = render(<HomePage />, { wrapper });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it(
    'a foto real é guardada para a próxima abertura (só a primeira dobra)',
    { timeout: 60_000 },
    async () => {
      semearBiblioteca();
      const { default: HomePage } = await import('@/pages/HomePage');
      const localLibrary = await import('@/lib/local/localLibrary');
      const { lerFotoDaHome } = await import('@/lib/perf/fotoDaHome');
      localLibrary.marcarAssentada();
      const wrapper = envolver(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
      render(<HomePage />, { wrapper });
      await screen.findByText('Gospel');

      await waitFor(async () => expect(await lerFotoDaHome()).not.toBeNull(), { timeout: 8_000 });
      const salva = (await lerFotoDaHome())!;
      expect(salva.tronco?.titulo).toBeTruthy();
      // Só ids/título/artista/capa — nada de URL de áudio na foto.
      const texto = JSON.stringify(salva);
      expect(texto).not.toContain('streamUrl');
      expect(texto).not.toContain('master.m3u8');
      // Prateleiras de 15 cartões no máximo (a primeira dobra).
      expect(salva.tronco!.faixas.length).toBeLessThanOrEqual(15);
    },
  );
});
