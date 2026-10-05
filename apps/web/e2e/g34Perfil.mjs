/**
 * Lê `.g34/perfil-<nome>.cpuprofile` e imprime onde o tempo de CPU
 * foi parar: por função (arquivo:linha do código-fonte, via source map do
 * `dist-mapa`) e por arquivo/pacote. Tempos em ms SOB o estrangulamento de CPU.
 *
 *   node e2e/g34Perfil.mjs home-quente [pastaDoMapa]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SourceMap } from 'node:module';

const nome = process.argv[2];
const MAPA = process.argv[3] ?? join('.g34', 'dist-mapa');
const perfil = JSON.parse(readFileSync(join('.g34', `perfil-${nome}.cpuprofile`), 'utf8'));

const mapas = new Map();
function mapaDe(url) {
  const arq = url.replace(/^https?:\/\/[^/]+\//, '');
  if (!mapas.has(arq)) {
    const p = join(MAPA, `${arq}.map`);
    mapas.set(arq, existsSync(p) ? new SourceMap(JSON.parse(readFileSync(p, 'utf8'))) : null);
  }
  return mapas.get(arq);
}

const porNo = new Map(perfil.nodes.map((n) => [n.id, n]));
const proprio = new Map(); // nodeId -> µs
perfil.samples.forEach((id, i) => proprio.set(id, (proprio.get(id) ?? 0) + (perfil.timeDeltas[i] ?? 0)));
const total = [...proprio.values()].reduce((a, b) => a + b, 0) / 1000;

const limpar = (s) => s.replace(/^.*\/node_modules\/\.pnpm\//, '').replace(/^.*\/node_modules\//, 'node_modules/').replace(/^(\.\.\/)+/, '').replace(/^.*\/apps\/web\//, '');
const funcs = new Map();
const arquivos = new Map();
for (const [id, us] of proprio) {
  const n = porNo.get(id);
  const cf = n.callFrame;
  let fonte = cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '') : cf.functionName || '(nativo)';
  let nomeFn = cf.functionName || '(anônima)';
  const m = cf.url ? mapaDe(cf.url) : null;
  if (m) {
    const e = m.findEntry(cf.lineNumber, cf.columnNumber);
    if (e && e.originalSource) {
      fonte = `${limpar(e.originalSource)}:${e.originalLine + 1}`;
      if (!cf.functionName && e.name) nomeFn = e.name;
    }
  }
  const k = `${nomeFn} @ ${fonte}`;
  funcs.set(k, (funcs.get(k) ?? 0) + us / 1000);
  let arq = fonte.replace(/:\d+$/, '');
  if (arq.startsWith('node_modules/')) {
    const mm = arq.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/);
    arq = `pkg ${mm ? mm[1] : arq}`;
  }
  arquivos.set(arq, (arquivos.get(arq) ?? 0) + us / 1000);
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`\n=== ${nome}: ${Math.round(total)} ms de amostras (estrangulado) ===`);
console.log('\n-- por função (self ms) --');
for (const [k, v] of top(funcs, 30)) console.log(`${String(Math.round(v)).padStart(7)}  ${k}`);
console.log('\n-- por arquivo/pacote (self ms) --');
for (const [k, v] of top(arquivos, 25)) console.log(`${String(Math.round(v)).padStart(7)}  ${k}`);

// ── tempo INCLUSIVO (função + tudo que ela chamou), só de src/ e packages/ ──────
function chaveDe(n) {
  const cf = n.callFrame;
  const m = cf.url ? mapaDe(cf.url) : null;
  if (m) {
    const e = m.findEntry(cf.lineNumber, cf.columnNumber);
    if (e && e.originalSource) return `${e.name || cf.functionName || '(anônima)'} @ ${limpar(e.originalSource)}:${e.originalLine + 1}`;
  }
  return `${cf.functionName || '(anônima)'} @ ${cf.url ? cf.url.replace(/^https?:\/\/[^/]+/, '') : '(nativo)'}`;
}
const filhos = new Map(perfil.nodes.map((n) => [n.id, n.children ?? []]));
const inclusivo = new Map();
function descer(id, ativos) {
  const n = porNo.get(id);
  const k = chaveDe(n);
  const novo = !ativos.has(k);
  if (novo) ativos.add(k);
  let t = (proprio.get(id) ?? 0) / 1000;
  for (const c of filhos.get(id)) t += descer(c, ativos);
  if (novo) {
    ativos.delete(k);
    inclusivo.set(k, (inclusivo.get(k) ?? 0) + t);
  }
  return t;
}
descer(perfil.nodes[0].id, new Set());
console.log('\n-- inclusivo (função + filhos), só código do app (ms) --');
const doApp = [...inclusivo].filter(([k]) => /@ (src\/|packages\/)/.test(k));
for (const [k, v] of doApp.sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(`${String(Math.round(v)).padStart(7)}  ${k}`);
