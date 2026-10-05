/**
 * Resume `.g34/*.jsonl` em tabelas: MEDIANA e dispersão (mín–máx)
 * por cenário. Uso:  node e2e/g34Resumo.mjs [carga|nav|fluidez|som|fundo]
 * Cada linha do jsonl é UMA repetição; agrupamos por (rota, estado, rótulo).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTA = join(process.cwd(), '.g34');
const grupo = process.argv[2] ?? 'carga';
const arq = join(PASTA, `${grupo}.jsonl`);
if (!existsSync(arq)) {
  console.log(`sem resultados: ${arq}`);
  process.exit(0);
}
const linhas = readFileSync(arq, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const med = (v) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v) => {
  const n = v.filter(Number.isFinite);
  if (!n.length) return '-';
  const lo = Math.min(...n), hi = Math.max(...n);
  const m = Math.round(med(n));
  return n.length > 1 && lo !== hi ? `${m} (${Math.round(lo)}-${Math.round(hi)})` : String(m);
};
const get = (l, caminho) => caminho.split('.').reduce((o, k) => (o == null ? o : o[k]), l);

function tabela(titulo, chaveGrupo, colunas, filtro = () => true) {
  const mapa = new Map();
  for (const l of linhas.filter(filtro)) {
    const k = chaveGrupo(l);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(l);
  }
  console.log(`\n### ${titulo}`);
  console.log(`| cenário | n | ${colunas.map((c) => c[0]).join(' | ')} |`);
  console.log(`|---|---|${colunas.map(() => '---').join('|')}|`);
  for (const [k, ls] of mapa) {
    console.log(`| ${k} | ${ls.length} | ${colunas.map(([, c]) => fmt(ls.map((l) => get(l, c)))).join(' | ')} |`);
  }
}

if (grupo === 'carga') {
  const cols = [
    ['TTFB', 'ttfb'], ['FCP', 'fcp'], ['LCP', 'lcp'], ['sem esqueleto', 'semEsqueleto'], ['load', 'load'],
    ['TBT', 'tbt'], ['últ. tarefa longa', 'ultimaTarefaLonga'], ['pior tarefa', 'piorTarefa'], ['CLS×1000', 'clsm'],
    ['JS kB', 'redeFinal.jsKb'], ['CSS kB', 'redeFinal.cssKb'], ['img kB', 'redeFinal.imgKb'], ['api kB', 'redeFinal.apiKb'],
    ['total kB', 'redeFinal.totalKb'], ['reqs', 'redeFinal.requisicoes'], ['heap MB', 'heapMb'], ['nós DOM', 'nosDom'],
  ];
  for (const l of linhas) l.clsm = Math.round((l.cls ?? 0) * 1000);
  for (const rotulo of [...new Set(linhas.map((l) => l.rotulo))]) {
    for (const estado of ['fria', 'quente']) {
      tabela(`carga ${estado} — ${rotulo} (ms, mediana (mín-máx))`, (l) => l.rota, cols, (l) => l.rotulo === rotulo && l.estado === estado);
    }
  }
} else {
  // Grupos livres: imprime todas as colunas numéricas por cenário.
  const chaves = [...new Set(linhas.flatMap((l) => Object.entries(l).filter(([, v]) => typeof v === 'number').map(([k]) => k)))].filter((k) => k !== 'rep');
  // `rotulo` separa rodadas comparáveis (ex.: `antes` × `depois` da biblioteca).
  tabela(
    `${grupo} (mediana (mín-máx))`,
    (l) => [l.cenario ?? l.rota, grupo === 'biblioteca' ? l.rotulo : null].filter(Boolean).join(' · '),
    chaves.map((k) => [k, k]),
  );
}
