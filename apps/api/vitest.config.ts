import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Unit tests never touch a real DB/Redis — these values only satisfy
    // the fail-fast env validation on import.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      STREAM_TOKEN_SECRET: 'unit-test-secret-unit-test-secret',
      STORAGE_DRIVER: 'local',
      LOG_LEVEL: 'error',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/docs/**', 'src/workers/**'],
    },
  },
});
