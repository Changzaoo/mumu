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

    /**
     * Self-hosted link importer (yt-dlp). OFF by default and intended for
     * single-operator, self-hosted use with content you are authorized to
     * download. Never enable this on a public deployment.
     */
    LINK_IMPORT_ENABLED: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['true', 'false']),
      )
      .default('false')
      .transform((v) => v === 'true'),
    /** Path to the yt-dlp binary; falls back to `yt-dlp` on PATH. */
    YTDLP_PATH: optionalString,

    /**
     * Automatic lyric transcription (OpenAI Whisper CLI). OFF by default:
     * it needs the `whisper` python package installed on the worker host and
     * costs minutes of CPU per track. Runs on its own queue, so a slow or
     * missing Whisper never blocks an upload from going READY.
     */
    WHISPER_ENABLED: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['true', 'false']),
      )
      .default('false')
      .transform((v) => v === 'true'),
    /** Path to the whisper binary; falls back to `whisper` on PATH. */
    WHISPER_PATH: optionalString,
    /** Whisper model size. `small` is the accuracy/speed sweet spot for lyrics. */
    WHISPER_MODEL: z.string().default('small'),
    /** Force a language (ISO 639-1). Empty = let Whisper auto-detect. */
    WHISPER_LANGUAGE: optionalString,
    /** Hard wall-clock cap per transcription; the child is killed past it. */
    WHISPER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(3 * 3600_000)
      .default(900_000),

    /**
     * Curadoria de metadata 24/7 (worker `curation`). Sem a chave da NVIDIA o
     * worker nem sobe — corrigir nome de artista exige o modelo.
     */
    CURATION_ENABLED: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['true', 'false']),
      )
      .default('false')
      .transform((v) => v === 'true'),
    NVIDIA_API_KEY: optionalString,
    NVIDIA_BASE: z.string().default('https://integrate.api.nvidia.com/v1'),
    NVIDIA_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
    /** Chamadas em voo simultâneas. São ligadas em rede, não em CPU. */
    NVIDIA_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    NVIDIA_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
    /** Faixas auditadas por volta, por usuário. */
    CURATION_BATCH: z.coerce.number().int().min(1).max(500).default(40),
    /**
     * Intervalo entre voltas — DE HORA EM HORA.
     *
     * O motivo ORIGINAL deste número era a cota do Firestore: cada volta lia
     * `CURATION_BATCH * 4` documentos por usuário, e a 15 minutos isso dava ~15
     * mil leituras por usuário por dia, contra um limite de 50 mil do projeto
     * inteiro. Estourou, e derrubou acervo, sincronia e curtidas juntos.
     *
     * ESSA RAZÃO MORREU: a curadoria lê do nosso Postgres (ver curation.worker),
     * onde a mesma varredura é um `SELECT` indexado e não custa nada.
     *
     * O número FICA de hora em hora por outro motivo, que continua valendo: cada
     * volta gasta até `CURATION_BATCH` auditorias na NVIDIA. Diminuir o intervalo
     * multiplica o consumo do modelo na mesma proporção, sem apressar a parte que
     * de fato aparece na tela — a revisão de categorias é regra pura e já varre o
     * acervo INTEIRO a cada volta, sem janela.
     */
    CURATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(60 * 60_000),

    /**
     * De quanto em quanto tempo o agente do acervo confere se as cópias do
     * cofre ainda servem (ver `acervoFiel.worker`).
     *
     * Cinco minutos, com lote pequeno, dá a volta no acervo em algumas horas —
     * de propósito. O cofre roda na MESMA máquina que serve música: descobrir
     * uma cópia morta uma hora mais tarde não custa nada, sufocar o importador
     * no meio de uma reprodução custa.
     */
    ACERVO_FIEL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .default(5 * 60_000),
    /** Só re-audita uma faixa depois disso (evita reprocessar a mesma sempre). */
    CURATION_RECHECK_DAYS: z.coerce.number().int().min(1).default(30),

    // ── Varredura de madrugada (ver varreduraNoturna.worker) ────────────────
    /**
     * Onde o importador atende, VISTO DE DENTRO do container da API.
     *
     * Vazio desliga a varredura inteira — é o interruptor geral. Preferir o
     * endereço interno (o importador roda na mesma máquina) a passar pelo
     * túnel público: sair para a internet e voltar para o mesmo host paga
     * latência e trava numa proteção de bot que não existe aqui dentro.
     */
    IMPORTER_URL: optionalString,
    /**
     * O endereço PÚBLICO do importador — o que os navegadores usam.
     *
     * Existe separado do `IMPORTER_URL` porque a varredura GRAVA a URL da cópia
     * dentro do acervo, e essa URL vai parar no celular de quem ouve. Montá-la
     * com o endereço interno (`localhost`, IP de rede docker) produziria um
     * acervo cheio de links que só funcionam de dentro do servidor: reparo que
     * parece ter dado certo no log e não toca em lugar nenhum. Vazio = usa o
     * `IMPORTER_URL`, o que só é correto quando os dois são o mesmo endereço.
     */
    IMPORTER_PUBLIC_URL: optionalString,
    /**
     * O crachá de máquina para falar com o importador (`IMPORT_SERVICE_TOKEN`
     * em apps/importer/server.mjs). Sem ele a varredura não sobe: o importador
     * é fechado por conta do Firebase e um worker não tem conta.
     */
    IMPORT_SERVICE_TOKEN: optionalString,
    /**
     * A JANELA — por que "de madrugada" e não "o tempo todo".
     *
     * Reimportar é a coisa mais cara que esta máquina faz: um yt-dlp por faixa,
     * baixando da internet, na MESMA máquina que serve o áudio de quem está
     * ouvindo. Rodando de dia, o conserto de faixas que ninguém pediu agora
     * competiria com a música que alguém pediu agora. Hora local do servidor.
     */
    VARREDURA_HORA_INICIO: z.coerce.number().int().min(0).max(23).default(3),
    VARREDURA_HORA_FIM: z.coerce.number().int().min(0).max(23).default(6),
    /** Teto de faixas por noite: uma varredura previsível é melhor que uma
     *  rápida, e o acervo não vai a lugar nenhum. */
    VARREDURA_MAX_POR_NOITE: z.coerce.number().int().min(1).default(80),
    /**
     * FOLGA MÍNIMA NO COFRE, em bytes, para a varredura valer a pena.
     *
     * O cofre é MENOR que o acervo (18 GB de teto para ~42 GB de música), e
     * podar é regime normal. Num cofre cheio, cada faixa que a varredura traz
     * de volta expulsa outra pelo LRU — mil reparos numa noite produziriam mil
     * faixas quebradas novas, e a manhã seguinte pareceria idêntica à anterior.
     * Sem esta folga a varredura NÃO roda, e diz no log por quê: um agente que
     * anda em círculos gastando banda é pior que um agente parado.
     */
    VARREDURA_FOLGA_MINIMA_BYTES: z.coerce
      .number()
      .int()
      .min(0)
      .default(2 * 1024 * 1024 * 1024),

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
