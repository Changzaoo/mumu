#!/usr/bin/env node
/**
 * O RELÓGIO DO ACERVO, PRÉ-COMPUTADO NO PC — para a letra acender junto com a
 * voz sem depender do servidor.
 *
 * Desde 28/10/2026 o importador de produção roda no vnmax com TEMPO_LOCAL=0:
 * nenhum alinhamento é feito lá (não cabe na RAM), e a letra fica com o tempo
 * bruto do LRCLIB, cronometrado para OUTRA gravação — segundos de erro. Este
 * laço roda AQUI (i5, 16 GB), devagar e sem parar, e publica cada alinhamento
 * em `aurial-indice-musicas/alinhamentos/<id>.json`; a borda do GitHub
 * (infra/cdn/github-worker) serve `GET /blob/<id>/alinhar?k=` a partir daí, e
 * o app lê a borda ANTES de pedir ao importador. Resultado: relógio certo,
 * sempre online, custo zero.
 *
 * Por faixa: listagem do acervo (pela própria borda, `/acervo`) → letra no
 * LRCLIB (mesma regra de aceitação do app, packages/shared/src/letra) → áudio
 * da borda → `palavras.py alinhar` (whisper `small`, ~1,5× o tempo da música
 * neste i5) → JSON no clone do índice → commit e push a cada lote.
 *
 * Uso (em apps/importer, com o python do importador no PATH ou PYTHON_PATH):
 *   node relogioDoAcervo.mjs                 # uma volta pelo acervo inteiro
 *   node relogioDoAcervo.mjs --continuo      # volta, dorme 30 min, volta…
 *   node relogioDoAcervo.mjs --max 20        # só 20 faixas (para testar)
 *   node relogioDoAcervo.mjs --so <id>       # só esta faixa
 *   node relogioDoAcervo.mjs --sem-push      # grava os JSON, não publica
 *
 * Retomável: o que já tem arquivo no clone é pulado; o que falhou (sem letra,
 * LRCLIB fora, áudio fora) fica em `estado.json` com data e é tentado de novo
 * só depois de REPETIR_APOS_DIAS. Uma instância por vez (trava com PID).
 */
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const sh = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── configuração ────────────────────────────────────────────────────────────
const BORDA = (process.env.AUDIO_BORDA ?? 'https://musicas.radinho.online').replace(/\/+$/, '');
const CLONE = process.env.INDICE_GIT_DIR ?? 'D:/Aurial/musicas-git/_aurial-indice-musicas';
const ESTADO_DIR = process.env.RELOGIO_DIR ?? 'D:/Aurial/relogio';
const PYTHON = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
const MODELO = process.env.WHISPER_MODELO || 'small';
const LOTE_PUSH = Number(process.env.RELOGIO_LOTE_PUSH ?? 10);
const REPETIR_APOS_DIAS = Number(process.env.RELOGIO_REPETIR_DIAS ?? 7);
const PAUSA_CONTINUO_MS = Number(process.env.RELOGIO_PAUSA_MIN ?? 30) * 60_000;
const TETO_ALINHAMENTO_MS = 40 * 60_000;
/** Música acima disto não é música de rádio (podcast, DJ set): não alinha. */
const DURACAO_MAX_S = 12 * 60;
const UA = 'radinho-relogio-do-acervo';

const args = process.argv.slice(2);
const opcao = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const CONTINUO = args.includes('--continuo');
const SEM_PUSH = args.includes('--sem-push');
const MAX = Number(opcao('--max') ?? Infinity);
const SO = opcao('--so');

// ── a regra de aceitação do app (packages/shared, já buildado) ──────────────
const shared = await import(
  pathToFileURL(path.join(HERE, '../../packages/shared/dist/letra/index.js')).href
);
const { escolherLinhaDoLrclib, julgarLinhaDoLrclib, lrcSemTempo, limparTituloDaLetra } = shared;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Nome do arquivo no repositório: o id sem caracteres que o Windows recusa. */
export function nomeDoArquivoDeAlinhamento(id) {
  return `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

/** Inglês ou não, pela densidade de palavras comuns — a mesma ideia do app. */
export function idiomaDaLetra(linhas) {
  const t = linhas.join(' ').toLowerCase();
  if (/[ãõáâàéêíóôúüçñ]/.test(t)) return 'pt';
  const ingles = (
    t.match(
      /\b(the|you|and|is|to|of|in|it|my|me|we|your|are|this|that|with|for|on|be|don't|i'm|can't|love|baby|yeah)\b/g,
    ) ?? []
  ).length;
  const palavras = (t.match(/[a-z']+/g) ?? []).length || 1;
  return ingles / palavras > 0.12 ? 'en' : 'pt';
}

/** Linhas que valem alinhar: sem cabeçalhos "[Refrão]" nem vazias. */
export function linhasParaAlinhar(texto) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]+\]$/.test(l) && !/^\(?(verse|chorus|refr[ãa]o|bridge|intro|outro)\b[^)]*\)?:?$/i.test(l))
    .map((l) => l.slice(0, 300));
}

// ── estado ──────────────────────────────────────────────────────────────────
const ESTADO = path.join(ESTADO_DIR, 'estado.json');
const TRAVA = path.join(ESTADO_DIR, 'trava.pid');

async function lerEstado() {
  try {
    return JSON.parse(await readFile(ESTADO, 'utf8'));
  } catch {
    return { falhas: {}, feitas: 0 };
  }
}
async function gravarEstado(e) {
  await mkdir(ESTADO_DIR, { recursive: true });
  const tmp = `${ESTADO}.tmp`;
  await writeFile(tmp, JSON.stringify(e, null, 1));
  await rename(tmp, ESTADO);
}

function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function travar() {
  await mkdir(ESTADO_DIR, { recursive: true });
  try {
    const pid = Number(await readFile(TRAVA, 'utf8'));
    if (pid && pid !== process.pid && processoVivo(pid)) {
      log(`já há uma instância rodando (pid ${pid}); saindo.`);
      process.exit(0);
    }
  } catch {
    /* sem trava */
  }
  await writeFile(TRAVA, String(process.pid));
}

// ── rede ────────────────────────────────────────────────────────────────────
async function json(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers ?? {}) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** A listagem do acervo pela borda (sempre no ar), com remoteUrl e k. */
async function listarAcervo() {
  const corpo = await json(`${BORDA}/acervo`);
  const entradas = Array.isArray(corpo?.data) ? corpo.data : [];
  return entradas
    .filter((e) => e?.track?.id && e.remoteUrl && /\/blob\//.test(e.remoteUrl))
    .map((e) => {
      const u = new URL(e.remoteUrl);
      return {
        id: e.track.id,
        k: u.searchParams.get('k'),
        title: String(e.track.title ?? '').trim(),
        artists: (e.track.artists ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean),
        album: e.track.album?.title ?? null,
        durationSec: Math.round((e.track.durationMs ?? 0) / 1000),
      };
    })
    .filter((f) => f.k && f.title);
}

/**
 * A letra desta faixa no LRCLIB — a MESMA escolha que o app faz (get exato com
 * duração, depois busca solta julgada por título/artista/duração). Texto com
 * tempo ou sem tempo, tanto faz: quem dá o tempo é o alinhamento.
 */
async function letraDoLrclib(f) {
  const nomes = f.artists.filter((a) => a !== 'Desconhecido').slice(0, 2);
  const titulos = [...new Set([limparTituloDaLetra(f.title) || f.title, f.title])];
  for (const title of titulos) {
    for (const artist of nomes) {
      if (!f.durationSec) break;
      const u = new URL('https://lrclib.net/api/get');
      u.searchParams.set('track_name', title);
      u.searchParams.set('artist_name', artist);
      if (f.album) u.searchParams.set('album_name', f.album);
      u.searchParams.set('duration', String(f.durationSec));
      const row = await json(u.toString()).catch(() => null);
      if (row && julgarLinhaDoLrclib(row, title, nomes, f.durationSec).aceita) return row;
    }
  }
  for (const title of titulos) {
    for (const artist of [...nomes, undefined]) {
      const u = new URL('https://lrclib.net/api/search');
      u.searchParams.set('track_name', title);
      if (artist) u.searchParams.set('artist_name', artist);
      const rows = await json(u.toString()).catch(() => null);
      const melhor = escolherLinhaDoLrclib(rows, title, nomes, f.durationSec);
      if (melhor) return melhor;
    }
  }
  return null;
}

async function baixarAudio(f, destino) {
  const r = await fetch(`${BORDA}/blob/${encodeURIComponent(f.id)}?k=${encodeURIComponent(f.k)}`, {
    headers: { 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`áudio ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length < 50_000) throw new Error('áudio pequeno demais');
  await writeFile(destino, bytes);
  return bytes.length;
}

async function alinhar(audio, idioma, linhas, saida) {
  const texto = `${saida}.letra.txt`;
  await writeFile(texto, linhas.join('\n'), 'utf8');
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [path.join(HERE, 'palavras.py'), 'alinhar', audio, saida, idioma, MODELO, texto], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    try {
      // Abaixo do normal, não ociosa: em prioridade ociosa o whisper ficou 30 min
      // com 5 s de CPU enquanto testes rodavam (03/11/2026).
      os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* sem permissão */
    }
    let erro = '';
    proc.stderr.on('data', (c) => {
      erro = (erro + c).slice(-1500);
    });
    const matar = () => {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
      else proc.kill();
    };
    const teto = setTimeout(matar, TETO_ALINHAMENTO_MS);
    proc.on('error', reject);
    proc.on('close', async (codigo) => {
      clearTimeout(teto);
      await rm(texto, { force: true }).catch(() => undefined);
      if (codigo !== 0) return reject(new Error(`palavras.py saiu com ${codigo}: ${erro.slice(-300)}`));
      try {
        resolve(JSON.parse(await readFile(saida, 'utf8')));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ── git ─────────────────────────────────────────────────────────────────────
const git = (a) => sh('git', a, { cwd: CLONE, windowsHide: true });

async function publicar(quantas) {
  if (SEM_PUSH) return;
  await git(['add', 'alinhamentos']);
  const { stdout } = await git(['status', '--porcelain', 'alinhamentos']);
  if (!stdout.trim()) return;
  await git(['-c', 'user.name=relogio', '-c', 'user.email=relogio@radinho.online', 'commit', '-q', '-m', `relógio: ${quantas} alinhamento(s)`]);
  try {
    await git(['pull', '-q', '--rebase', 'origin', 'main']);
  } catch (e) {
    log('pull --rebase falhou (segue para o push):', e.message?.slice(0, 200));
  }
  await git(['push', '-q', 'origin', 'HEAD:main']);
  log(`publicado: ${quantas} alinhamento(s)`);
}

// ── a volta ─────────────────────────────────────────────────────────────────
async function umaVolta() {
  const estado = await lerEstado();
  const dirAl = path.join(CLONE, 'alinhamentos');
  await mkdir(dirAl, { recursive: true });
  const prontos = new Set(await readdir(dirAl));
  const faixas = (await listarAcervo()).filter((f) => !SO || f.id === SO);
  log(`acervo: ${faixas.length} faixas tocáveis; ${prontos.size} alinhamentos já publicados`);
  const agora = Date.now();
  const fila = faixas.filter((f) => {
    if (prontos.has(nomeDoArquivoDeAlinhamento(f.id))) return false;
    if (f.durationSec > DURACAO_MAX_S || f.durationSec < 20) return false;
    const falha = estado.falhas[f.id];
    return !falha || agora - Date.parse(falha.em) > REPETIR_APOS_DIAS * 86_400_000;
  });
  log(`fila: ${fila.length} faixa(s) a alinhar`);
  let feitas = 0;
  let desdeOPush = 0;
  const tmp = path.join(os.tmpdir(), `relogio-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  for (const f of fila) {
    if (feitas >= MAX) break;
    const inicio = Date.now();
    const rotulo = `${f.artists.join(', ')} - ${f.title}`;
    try {
      const row = await letraDoLrclib(f);
      if (!row) {
        estado.falhas[f.id] = { em: new Date().toISOString(), motivo: 'sem-letra' };
        await gravarEstado(estado);
        log(`sem letra: ${rotulo}`);
        continue;
      }
      const texto = row.plainLyrics?.trim() ? row.plainLyrics : lrcSemTempo(row.syncedLyrics).join('\n');
      const linhas = linhasParaAlinhar(texto);
      if (linhas.length < 4 || linhas.length > 600) throw new Error(`letra com ${linhas.length} linhas`);
      const idioma = idiomaDaLetra(linhas);
      const audio = path.join(tmp, 'audio.bin');
      const saida = path.join(tmp, 'al.json');
      const bytes = await baixarAudio(f, audio);
      const r = await alinhar(audio, idioma, linhas, saida);
      if (!Array.isArray(r.linhas) || r.linhas.length !== linhas.length) throw new Error('alinhamento incompleto');
      const doc = {
        linhas: r.linhas.map((l, i) => ({ text: linhas[i], startMs: l.startMs, endMs: l.endMs, words: l.words ?? [] })),
        esperadas: r.esperadas ?? linhas.length,
        motor: `alinhamento-${MODELO}`,
        idioma,
        letra: { fonte: 'lrclib', id: row.id ?? null, comTempo: Boolean(row.syncedLyrics) },
        em: new Date().toISOString(),
      };
      const destino = path.join(dirAl, nomeDoArquivoDeAlinhamento(f.id));
      await writeFile(`${destino}.tmp`, JSON.stringify(doc));
      await rename(`${destino}.tmp`, destino);
      await rm(audio, { force: true });
      await rm(saida, { force: true });
      delete estado.falhas[f.id];
      estado.feitas = (estado.feitas ?? 0) + 1;
      await gravarEstado(estado);
      feitas += 1;
      desdeOPush += 1;
      log(`ok (${idioma}, ${Math.round(bytes / 1e6)}MB, ${Math.round((Date.now() - inicio) / 1000)}s): ${rotulo}`);
      if (desdeOPush >= LOTE_PUSH) {
        await publicar(desdeOPush).catch((e) => log('publicar falhou:', e.message?.slice(0, 200)));
        desdeOPush = 0;
      }
    } catch (e) {
      estado.falhas[f.id] = { em: new Date().toISOString(), motivo: String(e.message ?? e).slice(0, 200) };
      await gravarEstado(estado);
      log(`falhou (${Math.round((Date.now() - inicio) / 1000)}s): ${rotulo}: ${String(e.message ?? e).slice(0, 160)}`);
    }
  }
  if (desdeOPush > 0) await publicar(desdeOPush).catch((e) => log('publicar falhou:', e.message?.slice(0, 200)));
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  return feitas;
}

async function main() {
  await travar();
  if (!existsSync(CLONE)) throw new Error(`clone do índice não existe: ${CLONE}`);
  for (;;) {
    const n = await umaVolta();
    if (!CONTINUO || Number.isFinite(MAX)) {
      log(`fim: ${n} alinhamento(s) nesta volta`);
      break;
    }
    log(`volta terminada (${n}); dormindo ${PAUSA_CONTINUO_MS / 60_000} min`);
    await new Promise((r) => setTimeout(r, PAUSA_CONTINUO_MS));
  }
  await rm(TRAVA, { force: true }).catch(() => undefined);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
