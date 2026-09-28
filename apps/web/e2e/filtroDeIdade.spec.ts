/// <reference lib="dom" />
/**
 * IDADE × CONTEÚDO na tela de verdade: o que cada faixa etária VÊ na biblioteca.
 * Criança: só o comprovadamente limpo. Adolescente: nada explícito. Adulto: tudo.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function faixa(id: string, title: string) {
  return {
    id,
    title,
    durationMs: 180_000,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: null,
    artists: [{ id: 'a', name: 'Artista Teste', slug: 'a', imageUrl: null }],
    genre: 'K-Pop',
    coverUrl: null,
    streamUrl: null,
    uploadedByUserId: null,
  };
}

async function semearBiblioteca(page: Page): Promise<void> {
  await page.goto('/robots.txt');
  await page.evaluate(
    async (entradas) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('aurial-registro', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('biblioteca');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('biblioteca', 'readwrite');
        tx.objectStore('biblioteca').put(entradas, 'entradas');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    [
      {
        track: faixa('local:limpa', 'Musica Limpa'),
        addedAt: '2026-01-01',
        conteudoVeredicto: 'limpo',
      },
      {
        track: faixa('local:explicita', 'Musica Explicita'),
        addedAt: '2026-01-01',
        conteudoVeredicto: 'explicito',
      },
      { track: faixa('local:sem', 'Musica Sem Veredito'), addedAt: '2026-01-01' },
    ],
  );
}

async function comIdade(page: Page, dataNascimento: string): Promise<void> {
  await page.addInitScript((d) => {
    window.localStorage.setItem(
      'aurial:settings',
      JSON.stringify({ state: { dataNascimento: d }, version: 0 }),
    );
  }, dataNascimento);
}

async function visiveis(page: Page): Promise<string[]> {
  await page.goto('/library');
  await expect(page.getByText('Musica Limpa').first()).toBeVisible({ timeout: 20_000 });
  const todas = ['Musica Limpa', 'Musica Explicita', 'Musica Sem Veredito'];
  const saida: string[] = [];
  for (const t of todas) if ((await page.getByText(t).count()) > 0) saida.push(t);
  return saida;
}

test('criança vê só o comprovadamente limpo', async ({ page }) => {
  await comIdade(page, '2016-01');
  await semearBiblioteca(page);
  expect(await visiveis(page)).toEqual(['Musica Limpa']);
});

test('adolescente não vê o explícito', async ({ page }) => {
  await comIdade(page, '2011-01');
  await semearBiblioteca(page);
  expect(await visiveis(page)).toEqual(['Musica Limpa', 'Musica Sem Veredito']);
});

test('adulto vê tudo', async ({ page }) => {
  await comIdade(page, '1990-01');
  await semearBiblioteca(page);
  expect(await visiveis(page)).toEqual(['Musica Limpa', 'Musica Explicita', 'Musica Sem Veredito']);
});
