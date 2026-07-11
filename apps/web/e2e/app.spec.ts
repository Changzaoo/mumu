import { expect, test } from '@playwright/test';

test.describe('Aurial shell smoke', () => {
  test('loads home, shows sidebar and navigates to /search', async ({ page }) => {
    await page.goto('/');

    // App shell mounts with the main navigation visible.
    const sidebar = page.getByRole('navigation', { name: 'Menu principal' });
    await expect(sidebar).toBeVisible();

    // Navigate to search via sidebar.
    await sidebar.getByRole('link', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/\/search/);
  });
});
