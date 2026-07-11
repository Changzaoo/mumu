import 'dotenv/config';
import { z } from 'zod';

/** Treat empty strings from .env as "unset" for optional vars. */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    /** Comma-separated CORS allowlist. */
    WEB_ORIGIN: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgresql://...)'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    FIREBASE_PROJECT_ID: optionalString,
    FIREBASE_CLIENT_EMAIL: optionalString,
    FIREBASE_PRIVATE_KEY: optionalString,

    STORAGE_DRIVER: z.enum(['local', 'r2', 's3', 'supabase']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    R2_ACCOUNT_ID: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    R2_BUCKET: optionalString,
    R2_PUBLIC_BASE_URL: optionalString,
    SUPABASE_URL: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_BUCKET: optionalString,

    STREAM_TOKEN_SECRET: z
      .string()
      .min(16, 'STREAM_TOKEN_SECRET must be at least 16 chars (use 64 random chars)'),

    FFMPEG_PATH: optionalString,
    FFPROBE_PATH: optionalString,

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 'r2' || cfg.STORAGE_DRIVER === 's3') {
      for (const key of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=${cfg.STORAGE_DRIVER}`,
          });
        }
      }
    }
    const firebaseKeys = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
    ] as const;
    const set = firebaseKeys.filter((k) => cfg[k]);
    if (set.length > 0 && set.length < firebaseKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [firebaseKeys.find((k) => !cfg[k]) ?? 'FIREBASE_PROJECT_ID'],
        message:
          'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together',
      });
    }
    if (cfg.NODE_ENV === 'production' && set.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_PROJECT_ID'],
        message: 'Firebase Admin credentials are required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Fail fast with an actionable message — logger is not available yet.
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    console.error(
      `[config] Invalid environment:\n${lines.join('\n')}\nSee .env.example at the repo root.`,
    );
    process.exit(1);
  }
  return result.data;
}

export const env: Env = parseEnv();

export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
export const isProd = env.NODE_ENV === 'production';

export const webOrigins: string[] = env.WEB_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
