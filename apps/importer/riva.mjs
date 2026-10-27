/**
 * Cliente Riva ASR (NVIDIA NVCF) — transcrição COM tempo por palavra.
 *
 * Existe por um motivo só: dar TEMPO a letras que só têm texto. O texto
 * continua vindo do LRCLIB; daqui sai apenas o relógio (ver
 * apps/web/src/lib/lyrics/align.ts).
 *
 * Decisões que valem explicação:
 *
 * - **parakeet-tdt-0.6b-v2 via Recognize (unário), não StreamingRecognize.**
 *   Sondei os dois na NVCF com áudio real: a função multilíngue
 *   `parakeet-1.1b-rnnt` (que usávamos) NUNCA devolve resultado FINAL nem
 *   `words[]` — só hipóteses interinas sem tempo. Resultado: a transcrição
 *   "não funcionava", devolvia zero palavra sempre. A `parakeet-tdt-0.6b-v2`
 *   responde a `Recognize` com `is_final` implícito e `words[]` com
 *   `start_time` de verdade — que é a razão de tudo isto existir. É unária: o
 *   StreamingRecognize dela devolve INVALID_ARGUMENT.
 *
 * - **Áudio inteiro numa mensagem só.** Provado: uma música de 6 min (WAV
 *   ~11,5 MB) transcreve em ~4,7 s. Basta subir o teto de mensagem do canal
 *   (o padrão do gRPC recusaria acima de 4 MB). Sem chunking: unário não
 *   fatia.
 *
 * - **Só inglês.** A tdt-0.6b-v2 é monolíngue (en); mandar `pt-BR` devolve
 *   INVALID_ARGUMENT. Nenhuma função NVCF hoje dá tempo POR PALAVRA em pt-BR
 *   (a whisper-large-v3 transcreve o texto em pt, mas sem offsets). Por isso o
 *   idioma padrão é `en-US`; faixa em outro idioma cai fora no alinhamento e
 *   mantém a letra plana — degradação segura.
 *
 * - **WAV 16 kHz mono.** Riva só aceita canal único e lê o cabeçalho WAV
 *   sozinho (encoding/sample_rate podem ser omitidos — confirmado). O ffmpeg
 *   que já usamos no import faz a conversão.
 *
 * - **TDT empata tempos.** Vários tokens saem no mesmo instante, então
 *   `start_time == end_time` é NORMAL e não indica erro.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.join(HERE, 'proto');
const PROTO_FILE = 'riva/proto/riva_asr.proto';

const RIVA_TARGET = process.env.RIVA_TARGET ?? 'grpc.nvcf.nvidia.com:443';
/** parakeet-tdt-0.6b-v2 — a ÚNICA função NVCF sondada que devolve `words[]`
 *  com tempo por palavra (offline/unária, inglês). */
const RIVA_FUNCTION_ID = process.env.RIVA_FUNCTION_ID ?? 'd3fe9151-442b-4204-a70d-5fcc597fd610';
/** en-US: a tdt-0.6b-v2 é monolíngue e recusa outros códigos com erro. */
const RIVA_LANGUAGE = process.env.RIVA_LANGUAGE ?? 'en-US';

/**
 * whisper-large-v3 — o caminho pt-BR (e qualquer idioma que não seja inglês).
 *
 * Sondado com trap brasileiro real: transcreve o texto em português
 * corretamente e AUTO-DETECTA o idioma (`language_code:["pt"]`). Não devolve
 * tempo POR PALAVRA — só resultados por SEGMENTO de ~30 s, cada um com
 * `audio_processed` (segundos acumulados = fim do segmento). É o relógio GROSSO
 * que temos para o acervo brasileiro que o LRCLIB não cobre; o web distribui as
 * linhas dentro de cada janela de 30 s (ver lib/lyrics/align.ts →
 * spreadLinesOverSpan). Nenhuma outra função NVCF dá tempo POR PALAVRA em pt-BR.
 */
const WHISPER_FUNCTION_ID =
  process.env.WHISPER_FUNCTION_ID ?? 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d';
/** 'multi' = o whisper detecta o idioma sozinho (confirmado na sondagem). */
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'multi';

/**
 * RESERVAS NA NVIDIA — quando a função principal cai (NVCF tira função do ar,
 * troca o id, devolve UNAVAILABLE/NOT_FOUND/PERMISSION_DENIED), a transcrição
 * não pode simplesmente morrer: tenta a próxima função hospedada que fala a
 * mesma língua. A ordem é de qualidade; a que responder fica memorizada (ver
 * `funcaoQueFunciona`) para as próximas faixas não pagarem as tentativas.
 * Ids conferidos em build.nvidia.com (out/2026). Sobrescrevíveis por env, em
 * CSV `id:idioma`.
 */
function listaDeFuncoes(env, padrao) {
  const bruto = (process.env[env] ?? '').trim();
  if (!bruto) return padrao;
  return bruto
    .split(',')
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const [id, idioma] = par.split(':');
      return { modelo: id, id, idioma: idioma || null };
    });
}
/** Tempo POR PALAVRA (inglês). */
export const FUNCOES_PALAVRA = listaDeFuncoes('RIVA_FUNCOES_PALAVRA', [
  { modelo: 'parakeet-tdt-0.6b-v2', id: RIVA_FUNCTION_ID, idioma: null },
  { modelo: 'parakeet-ctc-1.1b-asr', id: '1598d209-5e27-4d3c-8079-4751568b1081', idioma: 'en-US' },
  { modelo: 'parakeet-ctc-0.6b-asr', id: 'd8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965', idioma: 'en-US' },
]);
/** Tempo POR SEGMENTO (pt-BR e qualquer outro idioma). */
export const FUNCOES_SEGMENTO = listaDeFuncoes('RIVA_FUNCOES_SEGMENTO', [
  { modelo: 'whisper-large-v3', id: WHISPER_FUNCTION_ID, idioma: null },
  // 25 idiomas, pt-BR incluso. Não devolve `audio_processed` em toda versão:
  // o tempo do segmento então sai das palavras (ver transcribeSegments).
  { modelo: 'parakeet-1.1b-rnnt-multilingual', id: '71203149-d3b7-4460-8231-1be2543a1fca', idioma: 'pt-BR' },
]);

/**
 * Códigos gRPC que dizem "esta FUNÇÃO não serve agora" — vale tentar outra.
 * Os demais (chave inválida = UNAUTHENTICATED, áudio ruim = INVALID_ARGUMENT
 * de forma geral) também passam para a próxima: o custo é uma chamada a mais,
 * e a alternativa era a faixa ficar sem letra.
 */
const memoria = new Map(); // tipo → índice da função que respondeu por último

/** Exportado para testes: reordena a lista pondo a que funcionou na frente. */
export function ordemDeTentativa(lista, preferido) {
  if (preferido == null || preferido <= 0 || preferido >= lista.length) return lista;
  return [lista[preferido], ...lista.filter((_, i) => i !== preferido)];
}

/** Erro com o código gRPC preservado (o log precisa dele para diagnóstico). */
export class RivaError extends Error {
  constructor(message, code, modelo) {
    super(message);
    this.code = code;
    this.modelo = modelo;
  }
}

/** Histórico curto das últimas tentativas — exposto em /ai/transcribe/estado. */
const historico = [];
function registrar(entrada) {
  historico.push({ em: new Date().toISOString(), ...entrada });
  while (historico.length > 30) historico.shift();
}
export function estadoDaTranscricao() {
  return {
    configurada: transcribeConfigured(),
    palavra: FUNCOES_PALAVRA.map((f) => f.modelo),
    segmento: FUNCOES_SEGMENTO.map((f) => f.modelo),
    funcionando: Object.fromEntries(
      [...memoria.entries()].map(([tipo, i]) => [
        tipo,
        (tipo === 'palavra' ? FUNCOES_PALAVRA : FUNCOES_SEGMENTO)[i]?.modelo ?? null,
      ]),
    ),
    historico: [...historico],
  };
}

/**
 * Escolhe o motor pelo idioma pedido. Inglês → TDT (tempo por palavra, o
 * melhor karaokê). Qualquer outra coisa (pt, es, 'multi', ausente) → whisper
 * (tempo por linha). Decidir aqui, e não no navegador, mantém o cliente burro.
 */
export function pickEngine(language) {
  const lang = (language ?? '').trim().toLowerCase();
  return lang.startsWith('en') ? 'word' : 'segment';
}
const SAMPLE_RATE = 16000;
/** Teto de espera — uma música de 5 min não pode pendurar o servidor. */
const TRANSCRIBE_TIMEOUT_MS = Number(process.env.RIVA_TIMEOUT_MS ?? 180_000);
/** Uma música inteira em WAV 16 kHz passa de 10 MB; o padrão do gRPC (4 MB)
 *  recusaria a mensagem. Unário manda tudo de uma vez, então o canal precisa
 *  aceitar o arquivo inteiro nos dois sentidos. */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

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
      client: new Asr(RIVA_TARGET, grpc.credentials.createSsl(), {
        'grpc.max_send_message_length': MAX_MESSAGE_BYTES,
        'grpc.max_receive_message_length': MAX_MESSAGE_BYTES,
      }),
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

/** Uma chamada Recognize (unária) a UMA função NVCF. Lança RivaError. */
async function recognize(funcao, config, wavBuffer) {
  const apiKey = (process.env.NVIDIA_API_KEY ?? '').trim();
  if (!apiKey) throw new RivaError('NVIDIA_API_KEY ausente.', 'SEM_CHAVE', funcao.modelo);

  const { grpc, client } = await getClient();
  const metadata = new grpc.Metadata();
  metadata.add('function-id', funcao.id);
  metadata.add('authorization', `Bearer ${apiKey}`);
  // Recognize é UNÁRIO: mandamos o áudio inteiro e recebemos a resposta final
  // de uma vez. O deadline substitui o timer manual do fluxo em streaming.
  const deadline = new Date(Date.now() + TRANSCRIBE_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    client.Recognize({ config, audio: wavBuffer }, metadata, { deadline }, (err, resp) => {
      if (err) {
        reject(
          new RivaError(
            `Riva ${funcao.modelo}: ${err.details ?? err.message ?? 'falha'} (${err.code})`,
            err.code,
            funcao.modelo,
          ),
        );
        return;
      }
      resolve(resp);
    });
  });
}

/**
 * Percorre a lista de funções até uma devolver algo UTILIZÁVEL (`extrair`
 * devolve null quando a resposta veio vazia/sem tempo). A primeira que serve
 * vira a preferida do processo. Lança o último erro se nenhuma serviu.
 */
async function comReservas(tipo, lista, montarConfig, extrair, wavBuffer) {
  const ordem = ordemDeTentativa(
    lista.map((f, i) => ({ ...f, i })),
    memoria.get(tipo),
  );
  let ultimo = null;
  for (const funcao of ordem) {
    const inicio = Date.now();
    try {
      const resp = await recognize(funcao, montarConfig(funcao), wavBuffer);
      const util = extrair(resp);
      if (util && util.length > 0) {
        memoria.set(tipo, funcao.i);
        registrar({ tipo, modelo: funcao.modelo, ok: true, itens: util.length, ms: Date.now() - inicio });
        return util;
      }
      ultimo = new RivaError(`Riva ${funcao.modelo}: resposta sem texto/tempo utilizável`, 'VAZIO', funcao.modelo);
    } catch (err) {
      ultimo = err;
      // Sem chave não adianta tentar outra função.
      if (err instanceof RivaError && err.code === 'SEM_CHAVE') throw err;
    }
    registrar({ tipo, modelo: funcao.modelo, ok: false, codigo: ultimo.code, erro: ultimo.message, ms: Date.now() - inicio });
    console.warn('[radinho-importer] transcrição NVIDIA falhou —', ultimo.message, '→ tentando a próxima');
  }
  throw ultimo ?? new RivaError('Nenhuma função de transcrição configurada.', 'SEM_FUNCAO', null);
}

/**
 * Transcreve um WAV e devolve [{ text, startMs }] — só as palavras, que é tudo
 * que o alinhamento precisa. Lança em falha; o chamador decide o que dizer.
 */
export async function transcribeWords(wavBuffer, { language } = {}) {
  return comReservas(
    'palavra',
    FUNCOES_PALAVRA,
    (funcao) => ({
      // encoding/sample_rate omitidos de propósito: o Riva lê o cabeçalho WAV.
      language_code: funcao.idioma ?? language ?? RIVA_LANGUAGE,
      max_alternatives: 1,
      enable_automatic_punctuation: true,
      enable_word_time_offsets: true, // o motivo de tudo isto existir
      audio_channel_count: 1,
    }),
    (response) => {
      const words = [];
      for (const result of response?.results ?? []) {
        const alternative = result.alternatives?.[0];
        for (const w of alternative?.words ?? []) {
          const text = typeof w?.word === 'string' ? w.word : '';
          if (!text) continue;
          words.push({ text, startMs: Number(w.start_time) || 0 });
        }
      }
      // Tempos todos iguais = o modelo não deu offset de verdade: reserva.
      return words.length > 0 && !timestampsAreDegenerate(words) ? words : null;
    },
    wavBuffer,
  );
}

/** Exportado para testes: resposta do Riva → segmentos `{ text, startMs, endMs }`. */
export function segmentosDaResposta(response) {
  const segments = [];
  let prevEndMs = 0;
  for (const result of response?.results ?? []) {
    const alt = result.alternatives?.[0];
    const text = (alt?.transcript ?? '').trim();
    // `audio_processed` vem em SEGUNDOS (fim acumulado do segmento). Função que
    // não o preenche (parakeet multilíngue) ainda manda tempo por palavra: o
    // fim do segmento é a última palavra.
    let endMs = Math.round((Number(result.audio_processed) || 0) * 1000);
    const palavras = alt?.words ?? [];
    if (endMs <= prevEndMs && palavras.length > 0) {
      endMs = Math.max(...palavras.map((w) => Number(w.end_time) || Number(w.start_time) || 0));
    }
    const primeira = palavras.length > 0 ? Number(palavras[0].start_time) : NaN;
    const startMs = Number.isFinite(primeira) && primeira >= prevEndMs ? primeira : prevEndMs;
    if (endMs > prevEndMs) prevEndMs = endMs;
    // Segmento sem letra/dígito (ex.: "🎶" de trecho instrumental) não vira
    // linha, mas ainda AVANÇA o relógio para o próximo começar no lugar certo.
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    segments.push({ text, startMs, endMs: Math.max(endMs, startMs) });
  }
  // Sem relógio nenhum (todos terminando em 0) o segmento não serve de tempo.
  if (segments.length > 1 && segments.every((s) => s.endMs === 0)) return [];
  return segments;
}

/**
 * Transcreve um WAV com o whisper e devolve SEGMENTOS `[{ text, startMs, endMs }]`.
 *
 * O whisper hospedado fatia em janelas de ~30 s e devolve um `result` por
 * janela; `audio_processed` é o fim acumulado dela (em segundos). O começo de um
 * segmento é o fim do anterior. Sem tempo por palavra — o texto de cada janela
 * é distribuído em linhas do lado do web. Lança em falha (depois de esgotar as
 * reservas da NVIDIA).
 */
export async function transcribeSegments(wavBuffer, { language } = {}) {
  const pedido = language && language !== 'multi' ? language : null;
  return comReservas(
    'segmento',
    FUNCOES_SEGMENTO,
    (funcao) => ({
      // O whisper RECUSA código vazio (erro). 'multi' o deixa detectar sozinho.
      // Reserva com idioma fixo (parakeet multilíngue = pt-BR) usa o dela,
      // a não ser que o pedido seja explícito.
      language_code: funcao.idioma ? (pedido && pedido.includes('-') ? pedido : funcao.idioma) : (pedido ?? WHISPER_LANGUAGE),
      max_alternatives: 1,
      enable_automatic_punctuation: true,
      // Pedir offsets não custa nada ao whisper e salva a reserva sem
      // `audio_processed`.
      enable_word_time_offsets: Boolean(funcao.idioma),
      audio_channel_count: 1,
    }),
    segmentosDaResposta,
    wavBuffer,
  );
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
