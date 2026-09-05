/// <reference lib="dom" />
/**
 * O FLUXO PRINCIPAL, COM SOM DE VERDADE.
 *
 * A suíte de e2e cobria abrir o app e navegar. Nada nela tocava música — e
 * "não ter nenhum bug de execução de música" é o pedido inteiro. Os testes de
 * unidade provam as REGRAS (token de geração, reconciliação de intenção,
 * duração não-finita) contra dublês de `<audio>`; o que nenhum deles pode
 * provar é que um `HTMLAudioElement` de navegador, com bytes reais, sai do
 * `readyState 0`, avança o relógio e emite `ended` no fim.
 *
 * Por isso aqui o áudio é REAL: um WAV gerado no navegador e gravado no cofre
 * (IndexedDB `aurial-offline`), exatamente onde o app grava o que foi baixado.
 * O resto do teste só clica e observa o que a pessoa veria.
 *
 * A referência de DOM vale para os corpos de `page.evaluate`, que rodam no
 * navegador — mesma razão de `arnesComum.ts`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const FAIXAS = 3;
/** Longo o bastante para o teste agir antes de a faixa acabar. */
const SEGUNDOS = 12;

/**
 * Semeia registro + áudio: N entradas do PRÓPRIO aparelho, cada uma com um WAV
 * de `segundos` no cofre.
 *
 * O WAV é gerado aqui, e não versionado como arquivo, de propósito: um binário
 * no repositório obrigaria a confiar que ele continua decodificável, e o ponto
 * do teste é não confiar em nada que não seja executado. Frequência diferente
 * por faixa para que uma troca errada seja audível na depuração manual.
 */
async function semearComAudio(page: Page, segundos = SEGUNDOS): Promise<void> {
  await page.evaluate(
    async ({ faixas, seg }) => {
      const TAXA = 8000;

      function wav(hz: number): Blob {
        const amostras = TAXA * seg;
        const buffer = new ArrayBuffer(44 + amostras * 2);
        const view = new DataView(buffer);
        const texto = (pos: number, s: string): void => {
          for (let i = 0; i < s.length; i += 1) view.setUint8(pos + i, s.charCodeAt(i));
        };
        texto(0, 'RIFF');
        view.setUint32(4, 36 + amostras * 2, true);
        texto(8, 'WAVEfmt ');
        view.setUint32(16, 16, true); // tamanho do bloco fmt
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, TAXA, true);
        view.setUint32(28, TAXA * 2, true); // bytes por segundo
        view.setUint16(32, 2, true); // alinhamento de bloco
        view.setUint16(34, 16, true); // bits por amostra
        texto(36, 'data');
        view.setUint32(40, amostras * 2, true);
        for (let i = 0; i < amostras; i += 1) {
          view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * hz * i) / TAXA) * 8000, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
      }

      const abrir = (nome: string, versao: number, loja: string): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open(nome, versao);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(loja)) db.createObjectStore(loja);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

      const gravar = (
        db: IDBDatabase,
        loja: string,
        valor: unknown,
        chave: string,
      ): Promise<void> =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(loja, 'readwrite');
          tx.objectStore(loja).put(valor, chave);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });

      const entradas = Array.from({ length: faixas }, (_, i) => ({
        track: {
          id: `local:e2e-${i}`,
          title: `Faixa de prova ${i}`,
          durationMs: seg * 1000,
          trackNumber: i + 1,
          discNumber: 1,
          explicit: false,
          playsCount: 0,
          dominantColor: null,
          loudnessLufs: null,
          isLiked: false,
          album: null,
          artists: [{ id: 'artista-prova', name: 'Artista de Prova', slug: 'artista-prova' }],
          genre: 'Pop',
          coverUrl: null,
          streamUrl: null,
          uploadedByUserId: null,
        },
        addedAt: new Date(Date.now() - i * 60_000).toISOString(),
        sizeBytes: TAXA * seg * 2 + 44,
        mimeType: 'audio/wav',
        contentHash: `hash-e2e-${i}`,
      }));

      const registro = await abrir('aurial-registro', 1, 'biblioteca');
      await gravar(registro, 'biblioteca', entradas, 'entradas');

      const cofre = await abrir('aurial-offline', 1, 'audio');
      for (let i = 0; i < faixas; i += 1) {
        await gravar(cofre, 'audio', wav(220 + i * 110), `local:e2e-${i}`);
      }
    },
    { faixas: FAIXAS, seg: segundos },
  );
}

/**
 * A semeadura acontece em `/robots.txt`, e a escolha é o conserto de uma
 * intermitência real: semeando com o app JÁ ABERTO, ele às vezes persistia a
 * biblioteca vazia que tinha em memória POR CIMA das entradas recém-gravadas, e
 * o teste seguinte encontrava a biblioteca deserta. `robots.txt` é a mesma
 * origem (mesmo IndexedDB) sem uma linha de código do app rodando.
 */
async function abrirBibliotecaSemeada(page: Page, segundos = SEGUNDOS): Promise<Locator> {
  await page.goto('/robots.txt');
  await semearComAudio(page, segundos);
  await page.goto('/library');
  const primeira = page.getByText('Faixa de prova 0').first();
  await expect(primeira).toBeVisible({ timeout: 20_000 });
  return primeira;
}

/**
 * O rodapé é onde vive o player. `PlayerBar` (desktop) e `MiniPlayer` (celular)
 * expõem os MESMOS rótulos, então tudo aqui é escopado ao rodapé e resolvido
 * pelo primeiro — no tamanho de tela deste projeto, o visível é o PlayerBar.
 */
function rodape(page: Page): Locator {
  return page.getByRole('contentinfo');
}

function botao(page: Page, nome: string): Locator {
  return rodape(page).getByRole('button', { name: nome }).first();
}

/** O título da faixa carregada, lido da barra do player. */
function tituloNaBarra(page: Page): Locator {
  return rodape(page).locator('button', { hasText: 'Faixa de prova' }).first();
}

/** Segundos decorridos, lidos de onde a pessoa lê: a barra de posição. */
async function posicao(page: Page): Promise<number> {
  const alca = page.locator('[aria-label="Posição da faixa"] [role="slider"]').first();
  return Number((await alca.getAttribute('aria-valuenow')) ?? '-1');
}

/**
 * Estado do `<audio>` que está com o som.
 *
 * Vai pelo Howler porque os elementos NÃO ficam no documento — `html5: true`
 * cria `Audio()` solto, então `document.querySelectorAll('audio')` devolve
 * lista vazia mesmo com a música tocando alto.
 */
async function estadoDoAudio(page: Page): Promise<{
  tocando: boolean;
  tempo: number;
  duracao: number;
  src: string;
} | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const howls: any[] = (window as any).Howler?._howls ?? [];
    const nos: HTMLAudioElement[] = howls
      .map((h: any) => h?._sounds?.[0]?._node)
      .filter((n: unknown): n is HTMLAudioElement => Boolean(n));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ativo = nos.find((n) => !n.paused && n.currentTime > 0) ?? nos[0];
    if (!ativo) return null;
    return {
      tocando: !ativo.paused,
      tempo: ativo.currentTime,
      duracao: ativo.duration,
      src: ativo.currentSrc || ativo.src,
    };
  });
}

test.describe('reprodução de ponta a ponta', () => {
  test('tocar uma faixa: sai som, o relógio anda e a duração não é 0:00', async ({ page }) => {
    const primeira = await abrirBibliotecaSemeada(page);
    await primeira.dblclick();

    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });

    // RF2 — duração finita e maior que zero chega ao elemento de áudio.
    await expect
      .poll(async () => (await estadoDoAudio(page))?.duracao ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(1);

    const estado = await estadoDoAudio(page);
    expect(estado?.tocando).toBe(true);
    expect(Number.isFinite(estado?.duracao)).toBe(true);
    // Toca do cofre local: alça de blob, não a rede.
    expect(estado?.src).toMatch(/^blob:/);

    // O relógio da tela ANDA — é o que separa "tocando" de "spinner eterno".
    await expect.poll(() => posicao(page), { timeout: 15_000 }).toBeGreaterThan(0);
    // E o total exibido não é 0:00 (a falha clássica desta tela).
    await expect(rodape(page)).not.toContainText('0:00 ');
  });

  test('pausar e retomar não perde a posição', async ({ page }) => {
    const primeira = await abrirBibliotecaSemeada(page);
    await primeira.dblclick();
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await estadoDoAudio(page))?.tempo ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    await botao(page, 'Pausar').click();
    await expect(botao(page, 'Reproduzir')).toBeVisible();
    const parado = (await estadoDoAudio(page))?.tempo ?? 0;
    expect(parado).toBeGreaterThan(0);

    await botao(page, 'Reproduzir').click();
    await expect(botao(page, 'Pausar')).toBeVisible();
    // Retomou de onde parou — não voltou ao começo nem pulou.
    await expect
      .poll(async () => (await estadoDoAudio(page))?.tempo ?? 0, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(parado);
  });

  test('RF1 — rajada de troca de faixa não deixa o player parado', async ({ page }) => {
    const primeira = await abrirBibliotecaSemeada(page);
    await primeira.dblclick();
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });

    // Dois avanços em rajada, sem esperar entre eles: é a corrida que o token de
    // geração existe para resolver — evento da faixa velha chegando DEPOIS do
    // load da nova. Ficam 0 → 1 → 2, dentro da fila de três.
    const proxima = botao(page, 'Próxima');
    await proxima.click();
    await proxima.click();

    await expect(tituloNaBarra(page)).toHaveText('Faixa de prova 2', { timeout: 15_000 });
    // A intenção era tocar; ao fim da rajada tem que estar TOCANDO, não parado.
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await estadoDoAudio(page))?.tempo ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('RF3 — a fila anda sozinha quando a faixa acaba', async ({ page }) => {
    // Faixas de 2s: dá para ver o fim chegar dentro do tempo do teste.
    const primeira = await abrirBibliotecaSemeada(page, 2);
    await primeira.dblclick();
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });

    // A prova é a IDENTIDADE mudar sozinha, não só o tempo voltar a zero.
    await expect(tituloNaBarra(page)).toHaveText('Faixa de prova 0', { timeout: 10_000 });
    await expect(tituloNaBarra(page)).toHaveText('Faixa de prova 1', { timeout: 20_000 });
    await expect(botao(page, 'Pausar')).toBeVisible();
  });

  test('voltar para a faixa anterior funciona no meio da fila', async ({ page }) => {
    const primeira = await abrirBibliotecaSemeada(page);
    await primeira.dblclick();
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });

    await botao(page, 'Próxima').click();
    await expect(tituloNaBarra(page)).toHaveText('Faixa de prova 1', { timeout: 15_000 });

    await botao(page, 'Anterior').click();
    await expect(tituloNaBarra(page)).toHaveText('Faixa de prova 0', { timeout: 15_000 });
    await expect(botao(page, 'Pausar')).toBeVisible();
  });
});
