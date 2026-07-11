// ──────────────────────────────────────────────────────────────
// Aurial — PM2 ecosystem (bare-metal alternative to docker compose).
//
// Use this when running the API directly on the server (Node 22 + ffmpeg
// installed on the host, Postgres/Redis running natively or via the dev
// compose file). The Docker path (infra/docker/docker-compose.prod.yml)
// is the primary deploy method — pick one, not both.
//
// Prereqs on the server:
//   pnpm install --frozen-lockfile
//   pnpm --filter @aurial/shared build && pnpm --filter @aurial/api build
//   cp .env.example apps/api/.env   # then fill in production values
//
// Start / persist:
//   pm2 start infra/pm2/ecosystem.config.cjs
//   pm2 save && pm2 startup        # resurrect on boot
//
// Log rotation: PM2 does NOT rotate logs by itself — install the module
// once per server or disks fill up:
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 50M
//   pm2 set pm2-logrotate:retain 14
//   pm2 set pm2-logrotate:compress true
// ──────────────────────────────────────────────────────────────

const path = require('node:path');

// Resolve apps/api relative to this file so `pm2 start` works from any cwd.
const apiDir = path.resolve(__dirname, '../../apps/api');

/** Shared settings for both processes. */
const base = {
  cwd: apiDir,
  // Node 22 native env loading — reads apps/api/.env (no dotenv needed).
  node_args: '--env-file=.env',
  env: {
    NODE_ENV: 'production',
  },
  autorestart: true,
  max_memory_restart: '512M',
  // Backoff instead of hot restart loops when the process crashes at boot.
  exp_backoff_restart_delay: 200,
  kill_timeout: 8000, // allow graceful shutdown (drain sockets, close queues)
  time: true, // prefix logs with timestamps
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'aurial-api',
      script: 'dist/main.js', // = pnpm --filter @aurial/api start
      // Keep a single instance: socket.io (/ws) needs sticky sessions —
      // do NOT switch to cluster mode without adding @socket.io/sticky.
      instances: 1,
      exec_mode: 'fork',
    },
    {
      ...base,
      name: 'aurial-worker',
      script: 'dist/workers/index.js', // = pnpm --filter @aurial/api start:worker
      instances: 1,
      exec_mode: 'fork',
      // FFmpeg jobs are heavier than HTTP traffic.
      max_memory_restart: '1024M',
    },
  ],
};
