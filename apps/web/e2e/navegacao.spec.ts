/// <reference lib="dom" />
/**
 * QUANTO DEMORA TROCAR DE PÁGINA PELO MENU — medido, não deduzido.
 *
 * O relato: "quando aperto em alguns botões do menu demora muito pra carregar
 * outras páginas, e deveria ser quase instantâneo". Antes de otimizar qualquer
 * coisa, este arnês diz QUAIS páginas demoram, QUANTO, e em que aparelho.
 *
 * O QUE SE MEDE. Do clique no link até a página estar DE PÉ na tela:
 *   - a URL trocou;
 *   - não há mais esqueleto (`.skeleton`) dentro de <main> — nem o do Suspense
 *     nem os de carregamento de dados da própria página;
 *   - dois quadros pintaram depois disso (o que o olho chama de "apareceu").
 *
 * É a definição do sintoma: o usuário não distingue "chunk baixando",
 * "componente montando" e "dados chegando" — ele vê a página que não veio.
 *
 * Rede cortada e biblioteca semeada, como no arnês de abertura: as páginas
 * locais (biblioteca, curtidas, histórico) mostram conteúdo real do IndexedDB;
 * as de rede caem no estado de erro/vazio — que também deve ser rápido.
 */
import { expect, test, type Page } from '@playwright/test';
import { isolarDaRede, semear } from './arnesComum';

const APARELHOS = [
  { nome: 'desktop (1x)', cpu: 1 },
  { nome: 'celular fraco (6x)', cpu: 6 },
] as const;

const FAIXAS = 5_000;

/** Os destinos do menu (Sidebar + abas do celular). */
// `/artistas` fica de fora de propósito: na Sidebar de desktop ele é um FILTRO
// da biblioteca, não um link — só o menu "mais" do celular tem o link direto.
const DESTINOS = ['/library', '/search', '/discover', '/liked', '/history', '/'] as const;

/** Quanto esperar o app assentar depois do boot antes de começar a clicar. */
const ASSENTAR_MS = 8_000;
/** Teto por navegação: acima disso a página é dada como pendurada. */
const TETO_NAV_MS = 20_000;

interface MedidaNav {
  destino: string;
  ms: number;
  bloqueioMs: number;
}

/**
 * Clica no link `href` e espera a página ficar de pé, DENTRO do navegador —
 * medir por RPC do Playwright somaria as idas e vindas do protocolo à conta.
 * Também soma as tarefas longas (>50ms) do trajeto: é o travamento que o dedo
 * sente por cima do tempo total.
 */
async function medirNavegacao(page: Page, destino: string): Promise<MedidaNav> {
  const resultado = await page.evaluate(
    async ({ href, teto }) => {
      const link = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
      if (!link) return { ms: -1, bloqueioMs: -1 };

      let bloqueioMs = 0;
      const observer = new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) bloqueioMs += entrada.duration - 50;
      });
      try {
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        /* navegador sem longtask: fica só o tempo total */
      }

      const t0 = performance.now();
      link.click();

      const ms = await new Promise<number>((resolve) => {
        const checar = (): void => {
          const chegou = location.pathname === href;
          const semEsqueleto = !document.querySelector('main .skeleton');
          if (chegou && semEsqueleto) {
            // Dois quadros: o que o olho chama de "apareceu".
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - t0)),
            );
            return;
          }
          if (performance.now() - t0 > teto) {
            resolve(-(performance.now() - t0)); // negativo = estourou o teto
            return;
          }
          setTimeout(checar, 16);
        };
        checar();
      });
      observer.disconnect();
      return { ms, bloqueioMs: Math.round(bloqueioMs) };
    },
    { href: destino, teto: TETO_NAV_MS },
  );
  return { destino, ...resultado };
}

test.describe('navegação pelo menu', () => {
  for (const aparelho of APARELHOS) {
    test(`${aparelho.nome} · ${FAIXAS} faixas`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
      await isolarDaRede(page);
      const cdp = await page.context().newCDPSession(page);

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.goto('/');
      await semear(page, FAIXAS);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(ASSENTAR_MS);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: aparelho.cpu });

      const medidas: MedidaNav[] = [];
      for (const destino of DESTINOS) {
        medidas.push(await medirNavegacao(page, destino));
        // Pequena folga entre cliques: navegação real não é metralhadora, e a
        // folga deixa efeitos da página anterior (imports ociosos) aparecerem
        // na conta da página deles, não da próxima.
        await page.waitForTimeout(500);
      }

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      // eslint-disable-next-line no-console -- é a saída do arnês
      console.log(
        `\n  ${aparelho.nome} · ${FAIXAS} faixas — clique → página de pé\n` +
          medidas
            .map((m) => {
              const rotulo = m.destino.padEnd(12);
              if (m.ms === -1) return `    ${rotulo} link não encontrado`;
              if (m.ms < 0) return `    ${rotulo} PENDUROU (> ${Math.round(-m.ms)}ms)`;
              return `    ${rotulo} ${Math.round(m.ms)}ms  (travado ${m.bloqueioMs}ms)`;
            })
            .join('\n'),
      );

      // O arnês tem de ter medido de verdade: todo destino do menu existe.
      for (const m of medidas) expect(m.ms, `${m.destino} sem link no menu`).not.toBe(-1);
    });
  }
});
