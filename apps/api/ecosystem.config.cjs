// PM2 process file (bare-metal alternative to docker-compose).
// Usage: pnpm build && pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'aurial-api',
      cwd: __dirname,
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '900M',
      env: { NODE_ENV: 'production' },
      out_file: './logs/api.out.log',
      error_file: './logs/api.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'aurial-worker',
      cwd: __dirname,
      script: 'dist/workers/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1500M',
      env: { NODE_ENV: 'production' },
      out_file: './logs/worker.out.log',
      error_file: './logs/worker.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
