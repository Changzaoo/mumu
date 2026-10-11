#!/usr/bin/env node
/**
 * Manda faixas do cofre para o GitHub, em CONTÊINERES — repositórios que vão
 * enchendo um de cada vez. É o mesmo jeito do Changzaoo/gta-videos: arquivo
 * commitado direto (sem LFS) e um `indice.json` que diz o que tem lá dentro.
 *
 * POR QUE CONTÊINERES. O GitHub recusa arquivo acima de 100 MB e fica bravo com
 * repositório acima de 1 GB. Por isso cada contêiner (aurial-musicas-001, -002,
 * ...) tem um teto (`TETO_MB`, padrão 900). Quando a próxima faixa não cabe
 * mais, o script cria o repositório seguinte sozinho e continua por ele.
 *
 * PRIVADO POR PADRÃO. São faixas comerciais, e repositório público com música
 * dos outros leva DMCA — que derruba a conta inteira, inclusive o gta-videos.
 * `--publico` existe, mas só para material próprio ou liberado.
 *
 * Layout local (MUSICAS_GIT_DIR, padrão D:/Aurial/musicas-git):
 *   indice.json                 — id da faixa → contêiner e caminho (evita duplicar)
 *   aurial-musicas-001/
 *     indice.json               — as faixas deste contêiner
 *     faixas/<artista - titulo>.mp3
 *
 * Uso:
 *   node infra/scripts/musicas-para-o-git.mjs <id> [<id> ...] [--lote nome] [--publico]
 *   node infra/scripts/musicas-para-o-git.mjs --lista ids.txt [--lote nome]
 *   node infra/scripts/musicas-para-o-git.mjs --todas      — o cofre inteiro; retomável
 * Envio longo: o progresso é salvo a cada faixa e o push sai a cada PEDACO_MB
 * (200). Rodar de novo continua de onde parou. Contêiner cheio é apagado do
 * disco depois do push — o cofre não cabe duas vezes no D:.
 * O id é o da faixa no acervo (`local:<uuid>`), o nome do .bin no cofre, ou o
 * caminho do .bin. `--lote` vira subpasta (ex.: o vídeo onde a faixa entra).
 */
import { readFile, writeFile, mkdir, copyFile, stat, access, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sh = promisify(execFile);
const COFRE = process.env.COFRE_DIR ?? 'D:/Aurial/cofre';
const RAIZ = process.env.MUSICAS_GIT_DIR ?? 'D:/Aurial/musicas-git';
const DONO = process.env.MUSICAS_GIT_DONO ?? 'Changzaoo';
const PREFIXO = 'aurial-musicas-';
// Trocável (um .mjs falso) para testar sem tocar no GitHub.
const gh = (a) => (process.env.GH_BIN ? sh(process.execPath, [process.env.GH_BIN, ...a]) : sh('gh', a));
const TETO = Number(process.env.TETO_MB ?? 900) * 1024 * 1024;
const MAX_ARQUIVO = 95 * 1024 * 1024; // o GitHub recusa a partir de 100 MB
// Push em pedaços: um envio de horas que cair perde no máximo isto.
const PEDACO = Number(process.env.PEDACO_MB ?? 200) * 1024 * 1024;

const args = process.argv.slice(2);
const opcao = (nome) => {
  const i = args.indexOf(nome);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const PUBLICO = args.includes('--publico');
if (PUBLICO) args.splice(args.indexOf('--publico'), 1);
const lote = opcao('--lote');
const lista = opcao('--lista');
const TODAS = args.includes('--todas');
if (TODAS) args.splice(args.indexOf('--todas'), 1);
const pedidos = [...args];
if (TODAS) pedidos.push(...(await readdir(COFRE)).filter((n) => n.endsWith('.bin')).sort());
if (lista) pedidos.push(...(await readFile(lista, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
if (!pedidos.length) {
  console.error('uso: musicas-para-o-git.mjs <id> [...] | --lista ids.txt | --todas  [--lote nome] [--publico]');
  process.exit(1);
}

const existe = (p) => access(p).then(() => true, () => false);
const lerJson = async (p, padrao) => ((await existe(p)) ? JSON.parse(await readFile(p, 'utf8')) : padrao);
const gravarJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
// Esta máquina não tem identidade global no git; quem assina é a deste repositório.
const quem = async (k) => (await sh('git', ['-C', import.meta.dirname, 'config', k]).catch(() => ({ stdout: '' }))).stdout.trim();
const IDENTIDADE = ['-c', `user.name=${(await quem('user.name')) || 'Aurial'}`, '-c', `user.email=${(await quem('user.email')) || 'aurial@local'}`];
const git = (dir, ...a) => sh('git', [...IDENTIDADE, '-C', dir, ...a], { maxBuffer: 1 << 26 });

/** Rede de horas falha às vezes: até 5 tentativas, esperando 10s, 20s, 40s... */
async function insistir(fazer) {
  for (let i = 0; ; i++) {
    try {
      return await fazer();
    } catch (e) {
      if (i >= 4) throw e;
      console.log(`! falhou (${(e.stderr || e.message).trim().split('\n')[0]}), tentando de novo`);
      await new Promise((r) => setTimeout(r, 10_000 * 2 ** i));
    }
  }
}

/** `local:<uuid>`, `local%3A<uuid>`, `local%3A<uuid>.bin` ou caminho → id e .bin */
function localizar(pedido) {
  const base = path.basename(pedido).replace(/\.(bin|json)$/, '');
  const id = decodeURIComponent(base);
  return { id, bin: path.join(COFRE, encodeURIComponent(id) + '.bin') };
}

async function etiquetas(bin) {
  try {
    const { stdout } = await sh('ffprobe', ['-v', 'quiet', '-show_entries', 'format_tags=title,artist', '-of', 'json', bin]);
    const t = JSON.parse(stdout).format?.tags ?? {};
    return { titulo: t.title ?? t.TITLE ?? null, artista: t.artist ?? t.ARTIST ?? null };
  } catch {
    return { titulo: null, artista: null };
  }
}

/** Faixa sem tag ID3: o nome sai da página de origem (o acervo mora no servidor). */
async function etiquetasDaOrigem(url) {
  if (!url) return { titulo: null, artista: null };
  try {
    const { stdout } = await sh('yt-dlp', ['--skip-download', '--no-warnings', '--print', '%(artist|)s\t%(track|)s\t%(uploader|)s\t%(title|)s', url], { timeout: 60_000 });
    // Sem trim: os campos vazios do começo são tabulações, e cortá-las desloca tudo.
    const [artista, faixa, canal, titulo] = stdout.replace(/\r?\n$/, '').split('\t');
    if (faixa) return { titulo: faixa, artista: artista || null };
    // "Artista - Título" já é o nome; o canal só entra quando o título não diz quem é.
    return titulo?.includes(' - ') ? { titulo, artista: null } : { titulo: titulo || null, artista: (canal || '').replace(/VEVO$|\s*- Topic$/, '') || null };
  } catch {
    return { titulo: null, artista: null };
  }
}

const limpar =(s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

async function tamanhoDoConteiner(dir) {
  const ind = await lerJson(path.join(dir, 'indice.json'), { faixas: [] });
  return ind.faixas.reduce((s, f) => s + f.bytes, 0);
}

async function criarConteiner(n) {
  const nome = PREFIXO + String(n).padStart(3, '0');
  const dir = path.join(RAIZ, nome);
  const remoto = `${DONO}/${nome}`;
  const jaNoGithub = await gh(['repo', 'view', remoto, '--json', 'name']).then(() => true, () => false);
  if (jaNoGithub) {
    if (!(await existe(path.join(dir, '.git')))) await gh(['repo', 'clone', remoto, dir]);
  } else {
    console.log(`→ criando contêiner ${remoto} (${PUBLICO ? 'público' : 'privado'})`);
    // Uma criação que caiu no meio deixa a pasta sem remoto: começa de novo.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'README.md'),
      `# ${nome}\n\nContêiner de faixas do Aurial para os vídeos. Gerado por \`infra/scripts/musicas-para-o-git.mjs\`.\n\n` +
        `- \`indice.json\` — as faixas deste contêiner\n- \`faixas/[lote/]artista - titulo.mp3\`\n\n` +
        `Quando este enche (~${TETO / 1024 / 1024} MB) as próximas vão para o contêiner seguinte.\n`,
    );
    await gravarJson(path.join(dir, 'indice.json'), { conteiner: nome, faixas: [] });
    await sh('git', ['init', '-b', 'main', dir]);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-m', `${nome}: contêiner novo`);
    // Criar e empurrar em passos separados: o GitHub solta 499/502 de vez em quando,
    // e a criação às vezes vale mesmo quando a resposta vem com erro.
    await insistir(async () => {
      const existe = await gh(['repo', 'view', remoto, '--json', 'name']).then(() => true, () => false);
      if (!existe) await gh(['repo', 'create', remoto, PUBLICO ? '--public' : '--private', '--description', 'Contêiner de faixas do Aurial para os vídeos']);
    });
    await git(dir, 'remote', 'add', 'origin', `${process.env.GIT_REMOTO_BASE ?? 'https://github.com/' + DONO}/${nome}`);
    await insistir(() => git(dir, 'push', '-u', 'origin', 'main'));
  }
  return { nome, dir, bytes: await tamanhoDoConteiner(dir) };
}

async function conteinerAtual() {
  await mkdir(RAIZ, { recursive: true });
  // O último número que existir no GitHub ou no disco é o contêiner aberto.
  const { stdout } = await gh(['repo', 'list', DONO, '--limit', '1000', '--json', 'name', '-q', '.[].name']);
  const nums = stdout.split('\n').filter((n) => n.startsWith(PREFIXO)).map((n) => Number(n.slice(PREFIXO.length)));
  const n = nums.length ? Math.max(...nums) : 1;
  const dir = path.join(RAIZ, PREFIXO + String(n).padStart(3, '0'));
  if (nums.length && (await existe(path.join(dir, '.git')))) {
    await git(dir, 'pull', '--ff-only').catch(() => {});
    return { nome: path.basename(dir), dir, bytes: await tamanhoDoConteiner(dir) };
  }
  return criarConteiner(n);
}

async function publicar(c, novas) {
  // Arquivo copiado num envio que caiu também sobe aqui: o status diz se há o que mandar.
  if (!novas && !(await git(c.dir, 'status', '--porcelain')).stdout.trim()) return;
  await git(c.dir, 'add', '-A');
  await git(c.dir, 'commit', '-m', `${c.nome}: +${novas} faixa(s)${lote ? ` — ${lote}` : ''}`);
  await insistir(() => git(c.dir, 'push', '-u', 'origin', 'main'));
  console.log(`✓ ${c.nome}: ${novas} faixa(s) enviadas (${(c.bytes / 1024 / 1024).toFixed(0)} MB no contêiner)`);
}

const geral = await lerJson(path.join(RAIZ, 'indice.json'), {});
let c = await conteinerAtual();
let novas = 0;
let pendentes = 0;
let feitas = 0;
const falhas = [];
const salvarGeral = () => gravarJson(path.join(RAIZ, 'indice.json'), geral);

for (const pedido of pedidos) {
  feitas++;
  const { id, bin } = localizar(pedido);
  if (geral[id]) {
    if (!TODAS) console.log(`= já está em ${geral[id].conteiner}: ${geral[id].arquivo}`);
    continue;
  }
  if (!(await existe(bin))) {
    falhas.push(`${id}: não está no cofre (podada?)`);
    continue;
  }
  const { size } = await stat(bin);
  if (size > MAX_ARQUIVO) {
    falhas.push(`${id}: ${(size / 1024 / 1024).toFixed(0)} MB, acima do limite do GitHub`);
    continue;
  }
  if (c.bytes + size > TETO) {
    await publicar(c, novas);
    novas = pendentes = 0;
    // O disco não comporta o cofre duas vezes: contêiner cheio e enviado sai daqui.
    const cheio = c.dir;
    c = await criarConteiner(Number(c.nome.slice(PREFIXO.length)) + 1);
    await rm(cheio, { recursive: true, force: true });
  }
  const meta = await lerJson(bin.replace(/\.bin$/, '.json'), {});
  let { titulo, artista } = await etiquetas(bin);
  if (!titulo) ({ titulo, artista } = await etiquetasDaOrigem(meta.sourceUrl));
  const ext = meta.contentType === 'audio/mpeg' || !meta.contentType ? '.mp3' : '.' + meta.contentType.split('/')[1];
  // Título que já começa pelo artista ("Katy Perry - I Kissed...") não repete o nome.
  const comArtista = artista && !titulo?.toLowerCase().startsWith(artista.toLowerCase()) ? [artista, titulo] : [titulo];
  const nomeBase = limpar(comArtista.filter(Boolean).join(' - ')) || id.replace(/[:]/g, '-');
  const pasta = path.join('faixas', ...(lote ? [limpar(lote)] : []));
  await mkdir(path.join(c.dir, pasta), { recursive: true });
  let arquivo = path.join(pasta, nomeBase + ext);
  if (await existe(path.join(c.dir, arquivo))) arquivo = path.join(pasta, `${nomeBase} [${id.slice(-8)}]${ext}`);
  try {
    await copyFile(bin, path.join(c.dir, arquivo));
  } catch (e) {
    falhas.push(`${id}: ${e.code ?? e.message} (podada durante o envio?)`);
    continue;
  }
  arquivo = arquivo.split(path.sep).join('/');

  const ind = await lerJson(path.join(c.dir, 'indice.json'), { conteiner: c.nome, faixas: [] });
  ind.faixas.push({ id, titulo, artista, arquivo, bytes: size, lote, origem: meta.sourceUrl ?? null });
  await gravarJson(path.join(c.dir, 'indice.json'), ind);
  geral[id] = { conteiner: c.nome, arquivo };
  await salvarGeral();
  c.bytes += size;
  pendentes += size;
  novas++;
  console.log(`+ [${feitas}/${pedidos.length}] ${arquivo}`);
  if (pendentes >= PEDACO) {
    await publicar(c, novas);
    novas = pendentes = 0;
  }
}

await publicar(c, novas);
await salvarGeral();
if (falhas.length) {
  console.log(`\n${falhas.length} faixa(s) não foram:`);
  for (const f of falhas) console.log('  - ' + f);
}
