import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-precise-memory-info'] });
const page = await (await browser.newContext()).newPage();
let bytesRede = 0;
page.on('response', async (r) => { const h = r.headers()['content-length']; if (h) bytesRede += Number(h); });
const t0 = Date.now();
await page.goto('https://aurial.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const tDom = ((Date.now()-t0)/1000).toFixed(1);
await page.locator('[aria-label^="Reproduzir "]').first().waitFor({ timeout: 180000 });
const tFaixas = ((Date.now()-t0)/1000).toFixed(1);
await page.waitForTimeout(6000);
const m = await page.evaluate(() => {
  const p = performance.memory || {};
  const nav = performance.getEntriesByType('navigation')[0] || {};
  return {
    heapMB: p.usedJSHeapSize ? +(p.usedJSHeapSize/1048576).toFixed(1) : null,
    heapLimiteMB: p.jsHeapSizeLimit ? +(p.jsHeapSizeLimit/1048576).toFixed(0) : null,
    domReady: +(nav.domContentLoadedEventEnd/1000).toFixed(1),
  };
});
console.log(JSON.stringify({ tDom_s: +tDom, tPrimeirasFaixas_s: +tFaixas, redeMB: +(bytesRede/1048576).toFixed(1), ...m }, null, 2));
await browser.close();
