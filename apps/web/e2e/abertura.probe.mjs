/**
 * SONDA DA ABERTURA NO MOTO G34 — a cena anda com a linha principal ocupada?
 *
 * Queixa do dono (29/10/2026): "no moto g34 tá toda lagada e não deu pra ver
 * nada". A prova que interessa não é "parece bonito no PC", é:
 *
 *  1. NENHUMA animação da cena ficou fora do compositor. O rastreio do Chrome
 *     anota, em cada animação, `compositeFailed` (≠ 0 = andou na linha
 *     principal, que é a que o app ocupa subindo). Esperado: zero falhas.
 *  2. A cena aparece cedo: o primeiro quadro com a abertura vem antes do JS
 *     do app terminar (ela está no index.html).
 *  3. Os quadros em sequência mostram cada ato (screenshots na pasta de saída).
 *
 * Uso (com o `dist` servido — `pnpm build` e `npx vite preview --port 4317`):
 *   node e2e/abertura.probe.mjs [saida] [cpu]
 *   ABERTURA_URL=http://localhost:4317 node e2e/abertura.probe.mjs /tmp/ab 4
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const URL_ = process.env.ABERTURA_URL ?? 'http://localhost:4317';
const SAIDA = process.argv[2] ?? 'test-results/abertura';
const CPU = Number(process.argv[3] ?? 4);
mkdirSync(SAIDA, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; moto g34 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

const rastro = join(SAIDA, 'rastro.json');
await browser.startTracing(page, {
  path: rastro,
  categories: ['devtools.timeline', 'blink.animations', 'disabled-by-default-devtools.timeline'],
});

const t0 = Date.now();
await page.goto(URL_, { waitUntil: 'commit' });
await page.waitForSelector('#abertura', { state: 'attached' });
const quadros = [400, 1100, 1500, 2000, 2800, 3300, 3950, 4450, 5000];
for (const ms of quadros) {
  const falta = ms - (Date.now() - t0);
  if (falta > 0) await page.waitForTimeout(falta);
  await page.screenshot({ path: join(SAIDA, `quadro-${String(ms).padStart(4, '0')}.png`) });
}
const app = await page
  .waitForFunction(() => !document.getElementById('abertura'), null, { timeout: 30_000 })
  .then(() => Date.now() - t0)
  .catch(() => null);
await browser.stopTracing();

const eventos = JSON.parse(readFileSync(rastro, 'utf8')).traceEvents ?? JSON.parse(readFileSync(rastro, 'utf8'));
const animacoes = new Map();
for (const ev of eventos) {
  if (ev.name !== 'Animation') continue;
  const d = ev.args?.data ?? {};
  const id = ev.id2?.local ?? ev.id ?? '?';
  const a = animacoes.get(id) ?? { nome: d.name, falhou: 0, props: new Set() };
  if (d.name) a.nome = d.name;
  if (d.compositeFailed) a.falhou |= d.compositeFailed;
  for (const p of d.unsupportedProperties ?? []) a.props.add(p);
  animacoes.set(id, a);
}
const todas = [...animacoes.values()];
const falhas = todas.filter((a) => a.falhou);
const tarefasLongas = eventos.filter(
  (ev) => ev.name === 'RunTask' && ev.dur > 50_000 && ev.ts,
).length;
const resumo = {
  cpu: CPU,
  animacoes: todas.length,
  foraDoCompositor: falhas.map((a) => ({ nome: a.nome, motivo: a.falhou, props: [...a.props] })),
  tarefasLongasNaLinhaPrincipal: tarefasLongas,
  aberturaSaiuEmMs: app,
};
writeFileSync(join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 2));
console.log(JSON.stringify(resumo, null, 2));
await browser.close();
