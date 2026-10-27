/**
 * SONDA DA TRANSCRIÇÃO — roda na máquina do importador e diz, com status de
 * verdade, qual caminho de transcrição funciona HOJE:
 *
 *  1. ambiente (chave NVIDIA, ffmpeg, python, faster-whisper, stable-ts,
 *     importador no ar);
 *  2. cada função ASR hospedada na NVIDIA (NVCF / Riva gRPC), com o código
 *     gRPC devolvido (0 = OK, o "200" do gRPC) e quantas palavras/segmentos;
 *  3. o faster-whisper local (palavras.py).
 *
 * Uso:  node apps/importer/diagnostico/sondarTranscricao.mjs [audio...]
 * Sem áudio, sintetiza uma fala curta em pt-BR e em inglês (voz do Windows).
 * Grava tudo em diagnostico/resultado-sonda.json e imprime um resumo.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORTER = path.dirname(HERE);
const ROOT = path.resolve(IMPORTER, '../..');
const SAIDA = path.join(HERE, 'resultado-sonda.json');
const resultado = { em: new Date().toISOString(), ambiente: {}, nvcf: [], local: [], erros: [] };
const log = (...a) => console.log('[sonda]', ...a);

// ── chave: ambiente do processo, depois os .env do repositório ──────────────
function lerEnv(arquivo) {
  try {
    const out = {};
    for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}
let origemDaChave = 'process.env';
if (!(process.env.NVIDIA_API_KEY ?? '').trim()) {
  origemDaChave = null;
  for (const f of [
    path.join(IMPORTER, '.env'),
    path.join(ROOT, '.env'),
    path.join(ROOT, '.env.local'),
    path.join(ROOT, 'apps/api/.env'),
    path.join(ROOT, '.env.production'),
  ]) {
    const v = (lerEnv(f).NVIDIA_API_KEY ?? '').trim();
    if (v) {
      process.env.NVIDIA_API_KEY = v;
      origemDaChave = f;
      break;
    }
  }
}
const KEY = (process.env.NVIDIA_API_KEY ?? '').trim();
resultado.ambiente.chaveNvidia = KEY
  ? { presente: true, origem: origemDaChave, prefixo: KEY.slice(0, 6), tamanho: KEY.length }
  : { presente: false };

const PYTHON = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
function versao(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    if (r.error) return { ok: false, erro: r.error.message };
    return { ok: r.status === 0, saida: (r.stdout + r.stderr).trim().split(/\r?\n/).slice(0, 3).join(' | ') };
  } catch (e) {
    return { ok: false, erro: String(e) };
  }
}
resultado.ambiente.node = process.version;
resultado.ambiente.plataforma = `${process.platform} ${os.release()}`;
resultado.ambiente.cpus = `${os.cpus().length}x ${os.cpus()[0]?.model ?? '?'}`;
resultado.ambiente.memoriaGB = Math.round(os.totalmem() / 1e9);
resultado.ambiente.ffmpeg = versao(FFMPEG, ['-version']);
resultado.ambiente.python = versao(PYTHON, ['--version']);
resultado.ambiente.fasterWhisper = versao(PYTHON, ['-c', 'import faster_whisper,sys;print(faster_whisper.__version__)']);
resultado.ambiente.stableTs = versao(PYTHON, ['-c', 'import stable_whisper;print(stable_whisper.__version__)']);
resultado.ambiente.ctranslate2 = versao(PYTHON, ['-c', 'import ctranslate2;print(ctranslate2.__version__, ctranslate2.get_cuda_device_count())']);
try {
  const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 8787}/health`, { signal: AbortSignal.timeout(4000) });
  resultado.ambiente.importador = { status: r.status, corpo: (await r.text()).slice(0, 300) };
} catch (e) {
  resultado.ambiente.importador = { status: 0, erro: e instanceof Error ? e.message : String(e) };
}
log('ambiente', JSON.stringify(resultado.ambiente, null, 1));

// ── áudios de teste ──────────────────────────────────────────────────────────
const tmp = path.join(os.tmpdir(), 'radinho-sonda');
mkdirSync(tmp, { recursive: true });
const FRASE_PT =
  'Eu saí de casa cedo, peguei minha bicicleta e fui trabalhar pela cidade de São Paulo. ' +
  'O sol estava forte, mas a música no fone deixava tudo mais leve.';
const FRASE_EN =
  'I left home early, grabbed my bicycle and rode across the city. ' +
  'The sun was hot, but the music in my headphones made everything feel lighter.';
function falar(texto, arquivo, cultura) {
  if (process.platform !== 'win32') return false;
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like '${cultura}*' } | Select-Object -First 1; ` +
    `if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.SetOutputToWaveFile('${arquivo}'); $s.Speak('${texto.replace(/'/g, "''")}'); $s.Dispose()`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 60_000 });
  return r.status === 0 && existsSync(arquivo);
}
const audios = process.argv.slice(2).map((a) => ({ nome: path.basename(a), arquivo: a, idioma: 'multi', esperado: null }));
if (audios.length === 0) {
  const pt = path.join(tmp, 'fala-pt.wav');
  const en = path.join(tmp, 'fala-en.wav');
  if (falar(FRASE_PT, pt, 'pt')) audios.push({ nome: 'fala-pt (sintética)', arquivo: pt, idioma: 'pt', esperado: FRASE_PT });
  if (falar(FRASE_EN, en, 'en')) audios.push({ nome: 'fala-en (sintética)', arquivo: en, idioma: 'en', esperado: FRASE_EN });
}
if (audios.length === 0) {
  resultado.erros.push('Nenhum áudio de teste (passe um arquivo como argumento).');
}

function paraWav16k(arquivo) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', arquivo, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], {
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(0, 200)}`);
  return r.stdout;
}

/** Semelhança grosseira (fração das palavras esperadas que apareceram). */
function acerto(esperado, obtido) {
  if (!esperado) return null;
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? [];
  const e = norm(esperado);
  const o = new Set(norm(obtido));
  return Math.round((e.filter((w) => o.has(w)).length / e.length) * 100);
}

// ── NVCF (Riva gRPC) ─────────────────────────────────────────────────────────
const CANDIDATOS = [
  { modelo: 'whisper-large-v3', id: 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d', idiomas: ['multi', 'pt', 'en'], palavras: [false, true] },
  { modelo: 'parakeet-tdt-0.6b-v2', id: 'd3fe9151-442b-4204-a70d-5fcc597fd610', idiomas: ['en-US'], palavras: [true] },
  { modelo: 'parakeet-1.1b-rnnt-multilingual', id: '71203149-d3b7-4460-8231-1be2543a1fca', idiomas: ['pt-BR', 'en-US', 'multi'], palavras: [true] },
  { modelo: 'parakeet-ctc-1.1b-asr', id: '1598d209-5e27-4d3c-8079-4751568b1081', idiomas: ['en-US'], palavras: [true] },
  { modelo: 'parakeet-ctc-0.6b-asr', id: 'd8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965', idiomas: ['en-US'], palavras: [true] },
  { modelo: 'canary-1b', id: 'b0e8b4a5-217c-40b7-9b96-17d84e666317', idiomas: ['pt-BR', 'en-US'], palavras: [true] },
  { modelo: 'canary-0.6b-turbo', id: 'c367545c-964a-42b1-b16f-40c262ae3646', idiomas: ['pt-BR', 'en-US'], palavras: [true] },
];
if (KEY) {
  const [grpc, protoLoader] = await Promise.all([import('@grpc/grpc-js'), import('@grpc/proto-loader')]);
  const def = protoLoader.loadSync('riva/proto/riva_asr.proto', {
    keepCase: true, longs: String, defaults: true, oneofs: true, includeDirs: [path.join(IMPORTER, 'proto')],
  });
  const Asr = grpc.loadPackageDefinition(def).nvidia.riva.asr.RivaSpeechRecognition;
  const client = new Asr(process.env.RIVA_TARGET ?? 'grpc.nvcf.nvidia.com:443', grpc.credentials.createSsl(), {
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  });
  for (const audio of audios) {
    let wav;
    try {
      wav = paraWav16k(audio.arquivo);
    } catch (e) {
      resultado.erros.push(`${audio.nome}: ${e.message}`);
      continue;
    }
    for (const c of CANDIDATOS) {
      for (const idioma of c.idiomas) {
        // Em áudio sintético, não faz sentido mandar inglês para a fala em pt e vice-versa.
        if (audio.esperado && idioma !== 'multi' && !idioma.startsWith(audio.idioma)) continue;
        for (const palavras of c.palavras) {
          const md = new grpc.Metadata();
          md.add('function-id', c.id);
          md.add('authorization', `Bearer ${KEY}`);
          const inicio = Date.now();
          const req = {
            config: {
              language_code: idioma,
              max_alternatives: 1,
              enable_automatic_punctuation: true,
              enable_word_time_offsets: palavras,
              audio_channel_count: 1,
            },
            audio: wav,
          };
          const linha = { audio: audio.nome, modelo: c.modelo, functionId: c.id, idioma, palavrasPedidas: palavras };
          try {
            const resp = await new Promise((res, rej) =>
              client.Recognize(req, md, { deadline: new Date(Date.now() + 180_000) }, (err, r) => (err ? rej(err) : res(r))),
            );
            const textos = [];
            let nPalavras = 0;
            let tempos = new Set();
            for (const r of resp?.results ?? []) {
              const alt = r.alternatives?.[0];
              if (alt?.transcript) textos.push(alt.transcript.trim());
              for (const w of alt?.words ?? []) {
                nPalavras += 1;
                tempos.add(Number(w.start_time));
              }
            }
            const texto = textos.join(' ');
            Object.assign(linha, {
              grpc: 0,
              ok: true,
              ms: Date.now() - inicio,
              resultados: resp?.results?.length ?? 0,
              palavrasComTempo: nPalavras,
              temposDistintos: tempos.size,
              acertoPct: acerto(audio.esperado, texto),
              texto: texto.slice(0, 300),
            });
          } catch (err) {
            Object.assign(linha, { grpc: err.code, ok: false, ms: Date.now() - inicio, erro: String(err.details ?? err.message).slice(0, 300) });
          }
          resultado.nvcf.push(linha);
          log(`${linha.ok ? 'OK ' : 'ERR'} ${c.modelo} [${idioma}${palavras ? ' +palavras' : ''}] ${audio.nome} →`,
            linha.ok ? `${linha.resultados} res, ${linha.palavrasComTempo} palavras, acerto ${linha.acertoPct ?? '?'}%: ${linha.texto?.slice(0, 120)}` : `gRPC ${linha.grpc}: ${linha.erro}`);
        }
      }
    }
  }
  client.close();
} else {
  resultado.erros.push('NVIDIA_API_KEY não encontrada no ambiente nem nos .env do repositório.');
}

// ── faster-whisper local (palavras.py) ───────────────────────────────────────
const MODELOS_LOCAIS = (process.env.SONDA_MODELOS || process.env.WHISPER_MODELO || 'small').split(',');
for (const MODELO_LOCAL of MODELOS_LOCAIS)
for (const audio of audios) {
  const saida = path.join(tmp, `local-${Date.now()}.json`);
  const inicio = Date.now();
  const lingua = audio.idioma === 'en' ? 'en' : audio.idioma === 'pt' ? 'pt' : '';
  const r = await new Promise((res) => {
    const p = spawn(PYTHON, [path.join(IMPORTER, 'palavras.py'), 'transcrever', audio.arquivo, saida, lingua, MODELO_LOCAL, ''], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let erro = '';
    p.stderr.on('data', (c) => (erro = (erro + c).slice(-1500)));
    p.on('error', (e) => res({ codigo: -1, erro: e.message }));
    p.on('close', (codigo) => res({ codigo, erro }));
  });
  const linha = { audio: audio.nome, motor: `faster-whisper ${MODELO_LOCAL}`, codigo: r.codigo, ms: Date.now() - inicio };
  log(`local ${MODELO_LOCAL} levou ${Math.round(linha.ms / 1000)}s`);
  if (r.codigo === 0) {
    try {
      const j = JSON.parse(readFileSync(saida, 'utf8'));
      const texto = (j.words ?? []).map((w) => w.text).join(' ');
      Object.assign(linha, { ok: true, modeloUsado: j.modelo, idioma: j.language, palavras: j.words?.length ?? 0, acertoPct: acerto(audio.esperado, texto), texto: texto.slice(0, 300) });
    } catch (e) {
      Object.assign(linha, { ok: false, erro: String(e) });
    }
  } else {
    Object.assign(linha, { ok: false, erro: r.erro.slice(-600) });
  }
  resultado.local.push(linha);
  log(`${linha.ok ? 'OK ' : 'ERR'} local ${linha.motor} ${audio.nome} →`, linha.ok ? `${linha.palavras} palavras, acerto ${linha.acertoPct ?? '?'}%` : linha.erro);
}

writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));
log('resultado gravado em', SAIDA);
