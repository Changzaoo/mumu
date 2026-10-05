import { defineConfig } from '@playwright/test';
import { ARGS_CHROMIUM } from './e2e/motoG34';

/**
 * Arnês `perf:g34` — o app INTEIRO medido num Moto G34 5G emulado.
 *
 * Irmão dos configs de desempenho/memória, com duas diferenças que são o
 * motivo de ele existir:
 *
 *  1. Serve o `dist` por `e2e/g34Servidor.mjs`, não por `vite preview`: brotli
 *     como a Vercel, cabeçalhos de cache de produção, a API do acervo e as CDNs
 *     de capa em fixtures locais. Assim o estrangulamento de rede do CDP (4G)
 *     vale para TUDO o que o app baixa, e nada depende da internet do momento.
 *  2. Perfil de aparelho completo (tela, toque, UA, CPU, rede) em `motoG34.ts`.
 *
 * É preciso `pnpm build` antes (mede o `dist`). Uma medição por vez — a máquina
 * serve produção — e nenhum servidor sobra: o Playwright derruba o dele no fim.
 *
 *   pnpm perf:g34                       # tudo
 *   G34_GRUPO=carga pnpm perf:g34       # um grupo: carga | nav | fluidez | som | fundo | perfil
 *   G34_CPU=4 G34_REPS=5 pnpm perf:g34  # outra taxa de CPU / mais repetições
 *   node e2e/g34Resumo.mjs              # tabelas (mediana + dispersão) dos resultados
 */
export default defineConfig({
  testDir: './e2e',
  // Fora de test-results/g34: o Playwright limpa o outputDir a cada rodada e
  // as fixtures (acervo, capas) não podem ir junto.
  outputDir: './test-results/g34-saida',
  testMatch: /g34\.[a-z]+\.spec\.ts/,
  timeout: 40 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // actionTimeout: um seletor que não casa vira erro em 30 s, não um teste pendurado.
  use: { launchOptions: { args: ARGS_CHROMIUM }, actionTimeout: 30_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node e2e/g34Servidor.mjs',
    url: 'http://localhost:4180/__g34/desconhecidos',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
