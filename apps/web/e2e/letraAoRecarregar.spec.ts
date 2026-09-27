/// <reference lib="dom" />
/**
 * A LETRA DEPOIS DA ATUALIZAÇÃO — e o clique na palavra.
 *
 * Quando sai versão nova, o app recarrega sozinho com a música tocando. A tela
 * tem que voltar como estava (reprodução expandida, letra aberta), a letra tem
 * que estar na linha que está sendo cantada, e clicar numa palavra leva a
 * música ao instante DELA — não ao começo da frase.
 */
import { expect, test, type Page } from '@playwright/test';

const DURACAO_S = 30;

// Letra sincronizada da faixa de teste, com tempo por palavra (<mm:ss.xx>).
const LRC = [
  '[00:00.00] <00:00.00>um <00:01.00>dois <00:02.00>tres',
  '[00:04.00] <00:04.00>quatro <00:05.00>cinco <00:06.00>seis',
  '[00:08.00] <00:08.00>sete <00:09.00>oito <00:10.00>nove',
  '[00:12.00] <00:12.00>dez <00:13.00>onze <00:14.00>doze',
  '[00:16.00] <00:16.00>treze <00:17.50>quatorze <00:19.00>quinze',
  '[00:20.00] <00:20.00>dezesseis <00:22.00>dezessete',
].join(String.fromCharCode(10));

function trackDto() {
  return {
    id: 'local:repro-play-tocando',
    title: 'Faixa repro tocando',
    durationMs: DURACAO_S * 1000,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: null,
    artists: [{ id: 'a', name: 'Artista', slug: 'a' }],
    genre: 'Pop',
    coverUrl: null,
    streamUrl: null,
    uploadedByUserId: null,
  };
}

async function semear(page: Page): Promise<void> {
  await page.evaluate(
    async ({ track, seg }) => {
      const TAXA = 8000;
      function wav(): Blob {
        const amostras = TAXA * seg;
        const buffer = new ArrayBuffer(44 + amostras * 2);
        const view = new DataView(buffer);
        const texto = (pos: number, s: string): void => {
          for (let i = 0; i < s.length; i += 1) view.setUint8(pos + i, s.charCodeAt(i));
        };
        texto(0, 'RIFF');
        view.setUint32(4, 36 + amostras * 2, true);
        texto(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, TAXA, true);
        view.setUint32(28, TAXA * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        texto(36, 'data');
        view.setUint32(40, amostras * 2, true);
        for (let i = 0; i < amostras; i += 1) {
          view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 330 * i) / TAXA) * 8000, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
      }
      const abrir = (nome: string, versao: number, loja: string): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open(nome, versao);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(loja)) db.createObjectStore(loja);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const gravar = (db: IDBDatabase, loja: string, valor: unknown, chave: string) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(loja, 'readwrite');
          tx.objectStore(loja).put(valor, chave);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      const entrada = {
        track,
        addedAt: new Date().toISOString(),
        sizeBytes: TAXA * seg * 2 + 44,
        mimeType: 'audio/wav',
        contentHash: 'hash-repro-tocando',
      };
      const registro = await abrir('aurial-registro', 1, 'biblioteca');
      await gravar(registro, 'biblioteca', [entrada], 'entradas');
      const cofre = await abrir('aurial-offline', 1, 'audio');
      await gravar(cofre, 'audio', wav(), track.id);
    },
    { track: trackDto(), seg: DURACAO_S },
  );
}

async function estadoDoAudio(page: Page): Promise<{ tocando: boolean; tempo: number } | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const howls: any[] = (window as any).Howler?._howls ?? [];
    const nos: HTMLAudioElement[] = howls
      .map((h: any) => h?._sounds?.[0]?._node)
      .filter((n: unknown): n is HTMLAudioElement => Boolean(n));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ativo = nos.find((n) => !n.paused && n.currentTime > 0) ?? nos[0];
    if (!ativo) return null;
    return { tocando: !ativo.paused, tempo: ativo.currentTime };
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://lrclib.net/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        route.request().url().includes('/api/search')
          ? []
          : {
              id: 1,
              trackName: 'Faixa repro tocando',
              artistName: 'Artista',
              duration: DURACAO_S,
              syncedLyrics: LRC,
              plainLyrics: null,
            },
      ),
    }),
  );
});

async function linhaAtual(page: Page): Promise<string> {
  return (
    (await page.locator('[aria-label="Letra da música"] [aria-current="true"]').textContent()) ?? ''
  );
}

test('atualizou com a letra aberta: volta expandida, na letra, na linha certa', async ({
  page,
}) => {
  await page.goto('/robots.txt');
  await semear(page);
  await page.evaluate((track) => {
    window.localStorage.setItem(
      'aurial:resume',
      JSON.stringify({ track, progress: 9.2, tocando: true }),
    );
    window.sessionStorage.setItem(
      'aurial:tela-ao-recarregar',
      JSON.stringify({ nowPlayingOpen: true, lyricsOpen: true, queueOpen: false }),
    );
  }, trackDto());
  await page.goto('/library');

  // A letra está na tela sem ninguém abrir nada.
  await expect(page.locator('[aria-label="Letra da música"]')).toBeVisible({ timeout: 20_000 });
  // Um toque qualquer (a política pode ter barrado o autoplay) e o som anda.
  await page.mouse.click(5, 5);
  await expect
    .poll(async () => (await estadoDoAudio(page))?.tocando ?? false, { timeout: 10_000 })
    .toBe(true);
  // Voltou perto de 9,2 s: a linha cantada é "sete oito nove", e segue andando.
  await expect.poll(() => linhaAtual(page), { timeout: 5_000 }).toContain('oito');
  await expect.poll(() => linhaAtual(page), { timeout: 8_000 }).toContain('dez');
});

test('clicar numa palavra leva a música ao instante DELA', async ({ page }) => {
  await page.goto('/robots.txt');
  await semear(page);
  await page.evaluate((track) => {
    window.localStorage.setItem(
      'aurial:resume',
      JSON.stringify({ track, progress: 2, tocando: true }),
    );
    window.sessionStorage.setItem(
      'aurial:tela-ao-recarregar',
      JSON.stringify({ nowPlayingOpen: true, lyricsOpen: true, queueOpen: false }),
    );
  }, trackDto());
  await page.goto('/library');
  const letra = page.locator('[aria-label="Letra da música"]');
  await expect(letra).toBeVisible({ timeout: 20_000 });
  await page.mouse.click(5, 5);
  await expect
    .poll(async () => (await estadoDoAudio(page))?.tocando ?? false, { timeout: 10_000 })
    .toBe(true);

  // "quatorze" começa em 17,5 s — a frase começa em 16 s.
  await letra.getByText('quatorze', { exact: true }).click();
  const tempo = (await estadoDoAudio(page))?.tempo ?? 0;
  expect(tempo).toBeGreaterThan(17.3);
  expect(tempo).toBeLessThan(18.2);
});

test('recarregar à mão com a letra aberta: volta expandida, na letra', async ({ page }) => {
  await page.goto('/robots.txt');
  await semear(page);
  await page.evaluate((track) => {
    window.localStorage.setItem('aurial:resume', JSON.stringify({ track, progress: 3 }));
  }, trackDto());
  await page.goto('/library');
  // Abre a letra pelo botão da barra (abre a reprodução expandida junto).
  await page.getByRole('contentinfo').getByRole('button', { name: 'Letra' }).click();
  await expect(page.locator('[aria-label="Letra da música"]')).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.locator('[aria-label="Letra da música"]')).toBeVisible({ timeout: 20_000 });
});

test('a retomada nunca toca o começo antes de pular: o primeiro som já sai no ponto', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __primeiroSom: number | null }).__primeiroSom = null;
    // Os elementos do Howler não ficam no DOM — o evento 'playing' não passa
    // pelo document. Mede-se no próprio play(): o ponto em que o som sai.
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      const p = original.call(this);
      const el: HTMLMediaElement = this as HTMLMediaElement;
      void p.then(
        () => {
          const w = window as unknown as { __primeiroSom: number | null };
          if (w.__primeiroSom === null && el.src.startsWith('blob:'))
            w.__primeiroSom = el.currentTime;
        },
        () => undefined,
      );
      return p;
    };
  });
  await page.goto('/robots.txt');
  await semear(page);
  await page.evaluate((track) => {
    window.localStorage.setItem(
      'aurial:resume',
      JSON.stringify({ track, progress: 12.4, tocando: true }),
    );
  }, trackDto());
  await page.goto('/library');
  await page.mouse.click(5, 5);
  const primeiro = await page
    .waitForFunction(
      () => {
        const v = (window as unknown as { __primeiroSom: number | null }).__primeiroSom;
        return v === null ? false : { v };
      },
      null,
      { timeout: 15_000 },
    )
    .then(async (h) => ((await h.jsonValue()) as { v: number }).v);
  expect(primeiro).toBeGreaterThan(11.9);
});
