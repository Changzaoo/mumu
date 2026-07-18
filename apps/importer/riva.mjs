/**
 * Cliente Riva ASR (NVIDIA NVCF) — transcrição COM tempo por palavra.
 *
 * Existe por um motivo só: dar TEMPO a letras que só têm texto. O texto
 * continua vindo do LRCLIB; daqui sai apenas o relógio (ver
 * apps/web/src/lib/lyrics/align.ts).
 *
 * Decisões que valem explicação:
 *
 * - **StreamingRecognize, não Recognize.** Offline vs streaming é propriedade
 *   do DEPLOY hospedado, não uma flag do cliente — e nós não controlamos o
 *   deploy. Os exemplos da NVIDIA para o modelo multilíngue usam streaming, e
 *   streaming funciona nos dois casos: mandamos o arquivo inteiro em pedaços e
 *   juntamos os resultados finais. Recognize poderia simplesmente não existir.
 *
 * - **WAV 16 kHz mono.** Riva só aceita canal único, e lê o cabeçalho WAV
 *   sozinho quando mandamos o arquivo inteiro. O ffmpeg que já usamos no
 *   import faz a conversão.
 *
 * - **RNNT empata tempos.** Nesta arquitetura vários tokens saem no mesmo
 *   instante, então `start_time == end_time` é NORMAL e não indica erro.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.join(HERE, 'proto');
const PROTO_FILE = 'riva/proto/riva_asr.proto';

const RIVA_TARGET = process.env.RIVA_TARGET ?? 'grpc.nvcf.nvidia.com:443';
/** parakeet-1.1b-rnnt-multilingual-asr (25 idiomas, inclui pt-BR). */
const RIVA_FUNCTION_ID =
  process.env.RIVA_FUNCTION_ID ?? '71203149-d3b7-4460-8231-1be2543a1fca';
/** 'multi' = detecção automática de idioma (o que os exemplos da NVIDIA usam). */
const RIVA_LANGUAGE = process.env.RIVA_LANGUAGE ?? 'multi';
const SAMPLE_RATE = 16000;
/** Pedaço enviado por vez (~0,5 s de PCM 16 kHz mono 16-bit). */
const CHUNK_BYTES = 16000;
/** Teto de espera — uma música de 5 min não pode pendurar o servidor. */
const TRANSCRIBE_TIMEOUT_MS = Number(process.env.RIVA_TIMEOUT_MS ?? 180_000);

let clientPromise = null;

/** Carrega os protos e cria o client uma única vez (o canal é reutilizável). */
async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const [grpc, protoLoader] = await Promise.all([
      import('@grpc/grpc-js'),
      import('@grpc/proto-loader'),
    ]);
    const definition = protoLoader.loadSync(PROTO_FILE, {
      keepCase: true,
      longs: String,
      defaults: true,
      oneofs: true,
      // A raiz, NÃO a pasta dos protos: os imports internos são
      // "riva/proto/..." e só resolvem a partir daqui.
      includeDirs: [PROTO_ROOT],
      // Sem `enums: String` — AudioEncoding é enviado como número.
    });
    const pkg = grpc.loadPackageDefinition(definition);
    const Asr = pkg.nvidia.riva.asr.RivaSpeechRecognition;
    return {
      grpc,
      client: new Asr(RIVA_TARGET, grpc.credentials.createSsl()),
    };
  })().catch((err) => {
    clientPromise = null; // permite nova tentativa numa próxima chamada
    throw err;
  });
  return clientPromise;
}

/** True quando a transcrição está configurada (chave presente). */
export function transcribeConfigured() {
  return Boolean((process.env.NVIDIA_API_KEY ?? '').trim());
}

/**
 * Converte qualquer áudio para WAV 16 kHz mono 16-bit via ffmpeg (stdin→stdout).
 * Retorna o Buffer do WAV completo — Riva lê o cabeçalho e dispensa informar
 * encoding/sample rate.
 */
export function toWav16k(inputBuffer, ffmpegBin) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ac',
      '1', // Riva aceita SOMENTE canal único
      '-ar',
      String(SAMPLE_RATE),
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      'pipe:1',
    ];
    const proc = spawn(ffmpegBin, args, { windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => {
      err += c;
      if (err.length > 4096) err = err.slice(-4096);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && out.length > 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg falhou ao converter áudio: ${err.slice(0, 200)}`));
    });
    proc.stdin.on('error', () => undefined); // EPIPE se o ffmpeg morrer antes
    proc.stdin.end(inputBuffer);
  });
}

/**
 * Transcreve um WAV e devolve [{ text, startMs }] — só as palavras, que é tudo
 * que o alinhamento precisa. Lança em falha; o chamador decide o que dizer.
 */
export async function transcribeWords(wavBuffer, { language } = {}) {
  const apiKey = (process.env.NVIDIA_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('NVIDIA_API_KEY ausente.');

  const { grpc, client } = await getClient();
  const metadata = new grpc.Metadata();
  metadata.add('function-id', RIVA_FUNCTION_ID);
  metadata.add('authorization', `Bearer ${apiKey}`);

  return await new Promise((resolve, reject) => {
    const words = [];
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try {
        call.cancel();
      } catch {
        /* já encerrada */
      }
      finish(reject, new Error('Transcrição excedeu o tempo limite.'));
    }, TRANSCRIBE_TIMEOUT_MS);

    const call = client.StreamingRecognize(metadata);

    call.on('data', (response) => {
      for (const result of response?.results ?? []) {
        // Só hipótese FINAL: as parciais mudam e trariam tempo instável.
        if (!result?.is_final) continue;
        const alternative = result.alternatives?.[0];
        for (const w of alternative?.words ?? []) {
          const text = typeof w?.word === 'string' ? w.word : '';
          if (!text) continue;
          words.push({ text, startMs: Number(w.start_time) || 0 });
        }
      }
    });
    call.on('error', (err) => finish(reject, err));
    call.on('end', () => finish(resolve, words));
    call.on('status', (status) => {
      if (status?.code !== 0 && !settled) {
        finish(reject, new Error(`Riva: ${status?.details ?? 'falha'} (${status?.code})`));
      }
    });

    // 1ª mensagem: só a configuração. As seguintes: só áudio.
    call.write({
      streaming_config: {
        config: {
          // encoding/sample_rate omitidos de propósito: mandamos o WAV
          // inteiro e o Riva lê o cabeçalho.
          language_code: language ?? RIVA_LANGUAGE,
          max_alternatives: 1,
          enable_automatic_punctuation: true,
          enable_word_time_offsets: true, // o motivo de tudo isto existir
          audio_channel_count: 1,
        },
        interim_results: false,
      },
    });

    for (let offset = 0; offset < wavBuffer.length; offset += CHUNK_BYTES) {
      call.write({ audio_content: wavBuffer.subarray(offset, offset + CHUNK_BYTES) });
    }
    call.end();
  });
}

/**
 * True quando os tempos vieram inúteis: todos iguais (ou todos zero) significa
 * que o modelo NÃO devolveu offsets de verdade — e sincronizar com isso
 * produziria um karaokê que não anda. Melhor tratar como falha e manter a
 * letra plana.
 */
export function timestampsAreDegenerate(words) {
  if (words.length < 2) return true;
  const distinct = new Set(words.map((w) => w.startMs));
  return distinct.size < Math.max(2, Math.floor(words.length * 0.2));
}
