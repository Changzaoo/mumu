import { defineConfig, devices } from '@playwright/test';

/**
 * Arnês de MEMÓRIA — irmão do de desempenho, e separado dele de propósito.
 *
 * O de desempenho responde "quanto o dedo ficou sem resposta". Este responde
 * outra pergunta, que nenhum número dele alcança: "quanta RAM a aba segura
 * parada". São eixos diferentes — um boot fluido pode terminar segurando um
 * giga, e foi exatamente esse o relato ("passa de 1,4 GB só com a aba aberta").
 *
 * Roda sobre `vite preview` pelo mesmo motivo do outro: servidor de dev entrega
 * módulo solto e cliente de HMR, e mediríamos o nosso ambiente em vez do
 * produto.
 *
 * `--enable-precise-memory-info` desliga o arredondamento que o Chrome aplica a
 * `performance.memory` por privacidade. Sem a flag o heap vem quantizado em
 * degraus grossos e duas medições diferentes dão o mesmo número — o que
 * esconderia justamente a melhora que se quer provar.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /memoria\.spec\.ts/,
  timeout: 10 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    video: 'off',
    launchOptions: {
      args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
