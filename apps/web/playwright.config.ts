import { defineConfig, devices } from '@playwright/test';

/**
 * A PORTA É CONFIGURÁVEL, E ISSO NÃO É DETALHE.
 *
 * `reuseExistingServer` é o que evita subir um Vite novo a cada execução — mas
 * ele reusa QUALQUER coisa que atenda na porta, inclusive outro projeto. Numa
 * máquina de desenvolvimento com mais de um app, 5173 é a porta de todo mundo,
 * e o resultado é a suíte inteira falhando contra um site que não é este: quinze
 * testes vermelhos que não dizem nada sobre este código.
 *
 * Com `E2E_PORT`, quem já tem a 5173 ocupada roda em outra e obtém um resultado
 * que significa alguma coisa.
 */
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  /**
   * AS SPECS DE MEDIÇÃO NÃO RODAM AQUI — e antes rodavam, sempre vermelhas.
   *
   * `desempenho`, `memoria` e `navegacao` medem o produto sobre `vite preview`
   * (bundle real, minificado, com service worker) na porta 4173, e cortam a
   * rede com `isolarDaRede`, que só libera o que aquele servidor entrega. Sem
   * este filtro elas caíam neste config, que sobe o servidor de DEV noutra
   * porta: cada pedido era abortado e as quinze acabavam em `ERR_FAILED` — um
   * portão que não podia ficar verde, e por isso não media nada.
   *
   * Elas têm config próprio: `pnpm perf` e `pnpm perf:memoria`.
   */
  testIgnore: /(desempenho|memoria|navegacao)\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
