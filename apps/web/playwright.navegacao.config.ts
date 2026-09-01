import { defineConfig, devices } from '@playwright/test';

/**
 * Arnês de NAVEGAÇÃO (mesma receita do de desempenho) — separado do e2e de propósito.
 *
 * O `playwright.config.ts` sobe `pnpm dev`, e servidor de desenvolvimento não
 * serve para medir nada: o Vite entrega os módulos soltos, sem minificar e sem
 * juntar, mais o cliente de HMR. O custo de abertura ali não tem relação com o
 * que roda no celular de alguém — mediríamos o nosso ambiente, não o produto.
 *
 * Aqui é `vite preview` sobre o `dist` de verdade: mesmo bundle, mesma
 * minificação, mesmo service worker que vai para produção.
 *
 * Uma medição por vez (`workers: 1`, sem paralelismo): duas abas disputando a
 * mesma CPU tornariam o estrangulamento sem sentido — a segunda mediria a
 * primeira.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /navegacao\.spec\.ts/,
  // Uma rodada estrangulada a 6× leva minutos; o teto do e2e (30s) reprovaria
  // por relógio o que estamos justamente tentando medir.
  timeout: 15 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
