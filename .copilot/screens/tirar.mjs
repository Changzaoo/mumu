/* Capturas da fase 6. Edge headless resolve o caso simples (uma URL, um tema),
   mas não sabe emular `prefers-reduced-transparency` por linha de comando — e é
   justamente essa regra que a fase 6 precisa ver com os olhos. Então aqui a
   emulação sai por CDP, que aceita a media feature crua. */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4177';
const DIR = 'D:/Projetos/musicas/.copilot/screens/';

const navegador = await chromium.launch({ channel: 'msedge' });

async function tirar(nome, { rota = '/', esquema = 'dark', transparenciaReduzida = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: esquema,
  });
  const pagina = await contexto.newPage();
  if (transparenciaReduzida) {
    const cdp = await contexto.newCDPSession(pagina);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: esquema },
        { name: 'prefers-reduced-transparency', value: 'reduce' },
      ],
    });
  }
  await pagina.goto(BASE + rota, { waitUntil: 'networkidle' }).catch(() => {});
  await pagina.waitForTimeout(2500);
  await pagina.screenshot({ path: `${DIR}${nome}.png` });
  console.log(nome, 'ok');
  await contexto.close();
}

await tirar('home', {});
await tirar('home-claro', { esquema: 'light' });
await tirar('home-transparencia-reduzida', { transparenciaReduzida: true });
await tirar('buscar', { rota: '/search' });
await tirar('descobrir', { rota: '/discover' });
await navegador.close();
