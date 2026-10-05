/// <reference lib="dom" />
/**
 * O VOLTAR LEVA PARA ONDE A PESSOA ESTAVA (viewport de celular, 360x800).
 *
 *  - rolar a Biblioteca, abrir um artista e voltar: mesma posição de rolagem
 *    (o contêiner que rola é o `<main>`, não a janela) e a mesma aba;
 *  - abrir o player expandido e voltar: fecha o player e MANTÉM a rota;
 *  - o voltar seguinte, sim, navega.
 *
 * `page.goBack()` é o mesmo evento que o botão voltar do Android entrega ao
 * WebView (history.back → popstate).
 */
import { expect, test, type Page } from '@playwright/test';
import { semear } from './arnesComum';

test.use({ viewport: { width: 360, height: 800 } });

const rolagem = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);

test('voltar: mesma rolagem e aba na biblioteca; player expandido fecha sem mudar a rota', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto('/robots.txt');
  await semear(page, 600);
  await page.goto('/library');

  // Aba "Artistas": centenas de cartões, a página rola de verdade.
  await page.getByRole('tab', { name: /Artistas/ }).click();
  const links = page.locator('main a[href^="/artista/"]');
  await expect(links.first()).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    document.querySelector('main')?.scrollTo({ top: 900 });
  });
  await expect.poll(() => rolagem(page)).toBeGreaterThan(850);

  // Abre o artista que está na tela agora.
  const indice = await links.evaluateAll((els) =>
    els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.top > 150 && r.bottom < 700;
    }),
  );
  expect(indice).toBeGreaterThanOrEqual(0);
  // O clique pode rolar um pouco para alcançar o alvo: vale a ÚLTIMA posição
  // vista antes de sair, e não a lida antes do clique.
  await page.evaluate(() => {
    const main = document.querySelector('main');
    main?.addEventListener('scroll', () => {
      if (location.pathname !== '/library') return;
      (window as unknown as { __ultimo: number }).__ultimo = main.scrollTop;
    });
    (window as unknown as { __ultimo: number }).__ultimo = main?.scrollTop ?? -1;
  });
  await links.nth(indice).click();
  await expect(page).toHaveURL(/\/artista\//);
  await expect.poll(() => rolagem(page)).toBe(0); // PUSH começa do topo
  const urlDoArtista = page.url();
  const antes = await page.evaluate(() => (window as unknown as { __ultimo: number }).__ultimo);
  expect(antes).toBeGreaterThan(850);

  // Volta: a biblioteca reaparece EXATAMENTE onde estava, na mesma aba.
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect
    .poll(async () => Math.abs((await rolagem(page)) - antes), { timeout: 10_000 })
    .toBeLessThanOrEqual(4);
  await expect(page.getByRole('tab', { name: /Artistas/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // De novo no artista, agora com o player expandido por cima.
  await page.goForward();
  await expect(page).toHaveURL(urlDoArtista);
  await page
    .getByText(/Faixa de teste/)
    .first()
    .dblclick();
  const abrir = page.getByRole('button', { name: 'Abrir reprodução em tela cheia' });
  await expect(abrir).toBeVisible({ timeout: 20_000 });
  await abrir.click();
  const fechar = page.getByRole('button', { name: 'Fechar', exact: true }).first();
  await expect(fechar).toBeVisible();

  const entradas = await page.evaluate(() => window.history.length);
  await page.goBack();
  await expect(fechar).toBeHidden(); // só a camada saiu
  await expect(page).toHaveURL(urlDoArtista); // a rota ficou
  expect(await page.evaluate(() => window.history.length)).toBe(entradas);

  // Fechar pela UI não deixa entrada-fantasma: o voltar seguinte navega de verdade.
  await abrir.click();
  await expect(fechar).toBeVisible();
  await fechar.click();
  await expect(fechar).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
});
