import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Testes de PÁGINA levam ~4s para montar em jsdom (dezenas de componentes,
    // providers e stores). O padrão de 5s do vitest matava o teste ANTES de o
    // limite maior do findBy* (setup.ts) ter serventia — era a causa real das
    // falhas que mudavam a cada execução. Os dois limites precisam subir juntos.
    testTimeout: 30_000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/test/**', 'src/main.tsx'],
    },
  },
});
