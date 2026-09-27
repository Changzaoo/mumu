/// <reference lib="dom" />
/**
 * REPRO TEMPORÁRIO — apagar depois de confirmar a causa.
 * "recarrega, aperta play, o botão não muda para Pausar".
 */
import { expect, test, type Page } from '@playwright/test';

const DURACAO_S = 30;

function trackDto() {
  return {
    id: 'local:repro-play',
    title: 'Faixa repro',
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
        contentHash: 'hash-repro',
      };
      const registro = await abrir('aurial-registro', 1, 'biblioteca');
      await gravar(registro, 'biblioteca', [entrada], 'entradas');
      const cofre = await abrir('aurial-offline', 1, 'audio');
      await gravar(cofre, 'audio', wav(), track.id);
    },
    { track: trackDto(), seg: DURACAO_S },
  );
}

function rodape(page: Page) {
  return page.getByRole('contentinfo');
}
function botao(page: Page, nome: string) {
  return rodape(page).getByRole('button', { name: nome }).first();
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

test('repro: recarregar e apertar play', async ({ page }) => {
  await page.goto('/robots.txt');
  await semear(page);
  await page.goto('/library');

  const primeira = page.getByText('Faixa repro').first();
  await expect(primeira).toBeVisible({ timeout: 20_000 });
  await primeira.dblclick();
  await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await estadoDoAudio(page))?.tempo ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(2);

  await page.reload();

  // Volta pausada, no ponto (comportamento padrão sem marca de update).
  await expect(botao(page, 'Reproduzir')).toBeVisible({ timeout: 20_000 });

  await botao(page, 'Reproduzir').click();

  await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await estadoDoAudio(page))?.tocando ?? false, { timeout: 10_000 })
    .toBe(true);
});
