/// <reference lib="dom" />
/**
 * RECARREGAR COM A MÚSICA TOCANDO VOLTA TOCANDO, NO PONTO CERTO.
 *
 * O pedido: depois de uma atualização do PWA (que recarrega a página sozinha
 * — ver `pwa.ts`), a música tem que voltar do PONTO exato e TOCAR sozinha, sem
 * a pessoa precisar apertar nada.
 *
 * `pwa.ts` marca essa intenção gravando `aurial:resume` com `tocando: true`
 * (ver `prepararRetomadaTocando`) ANTES de recarregar — e é exatamente essa
 * marca que este teste escreve à mão, para exercitar `initPlayerEngine` num
 * `<audio>` de VERDADE sem depender do ciclo de vida real de um service worker
 * (lento e instável para uma suíte de e2e). O que os testes de unidade em
 * `playerStore` não podem provar — que um `<audio>` de navegador de verdade,
 * com autoplay liberado (`--autoplay-policy=no-user-gesture-required`, o caso
 * em que Chrome com Media Engagement alto ou um PWA instalado permitem o
 * play() automático), realmente retoma o som no segundo certo — é o que este
 * arquivo prende.
 *
 * O caso em que o navegador RECUSA (sem a flag acima, iOS, aba nova sem
 * histórico de mídia) tem prova própria em
 * `stores/__tests__/resumirAoAbrir.test.ts`: o convite discreto substitui o
 * toast de erro, e a faixa fica pronta e no ponto certo mesmo assim.
 */
import { expect, test, type Page } from '@playwright/test';

// Autoplay sem gesto nenhum — o caso "permitido" que este arquivo verifica.
// Sem isto, o `play()` automático do boot seria recusado por política do
// próprio Chromium de teste, e o teste provaria o convite, não a retomada.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

const DURACAO_S = 30;
const TRACK_ID = 'local:e2e-resumo';

/** O mesmo `TrackDto` grava DUAS vezes: no registro/cofre (para tocar) e em
 *  `aurial:resume` (para o boot saber o que retomar) — precisa ser idêntico
 *  nos dois, senão `readResume` aponta para uma faixa que a biblioteca não tem. */
function trackDto() {
  return {
    id: TRACK_ID,
    title: 'Faixa de retomada',
    durationMs: DURACAO_S * 1000,
    trackNumber: 1,
    discNumber: 1,
    explicit: false,
    playsCount: 0,
    dominantColor: null,
    loudnessLufs: null,
    isLiked: false,
    album: null,
    artists: [{ id: 'artista-resumo', name: 'Artista de Prova', slug: 'artista-resumo' }],
    genre: 'Pop',
    coverUrl: null,
    streamUrl: null,
    uploadedByUserId: null,
  };
}

/** Semeia registro + áudio (um WAV gerado no navegador) para a faixa acima —
 *  mesma técnica de `reproducao.spec.ts`: som real, não um dublê de `<audio>`. */
async function semear(page: Page): Promise<void> {
  await page.evaluate(
    async ({ track, seg }) => {
      const TAXA = 8000;
      function wav(): Blob {
        const amostras = TAXA * seg;
        const buffer = new ArrayBuffer(44 + amostras * 2);
        const view = new DataView(buffer);
        const texto = (pos: number, s: string): void => {
          for (let i = 0; i < s.length; i += 1) view.setUint8(pos + i, s.charCodeAt(i));
        };
        texto(0, 'RIFF');
        view.setUint32(4, 36 + amostras * 2, true);
        texto(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, TAXA, true);
        view.setUint32(28, TAXA * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        texto(36, 'data');
        view.setUint32(40, amostras * 2, true);
        for (let i = 0; i < amostras; i += 1) {
          view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 330 * i) / TAXA) * 8000, true);
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
      const gravar = (db: IDBDatabase, loja: string, valor: unknown, chave: string) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(loja, 'readwrite');
          tx.objectStore(loja).put(valor, chave);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });

      const entrada = {
        track,
        addedAt: new Date().toISOString(),
        sizeBytes: TAXA * seg * 2 + 44,
        mimeType: 'audio/wav',
        contentHash: 'hash-e2e-resumo',
      };
      const registro = await abrir('aurial-registro', 1, 'biblioteca');
      await gravar(registro, 'biblioteca', [entrada], 'entradas');
      const cofre = await abrir('aurial-offline', 1, 'audio');
      await gravar(cofre, 'audio', wav(), track.id);
    },
    { track: trackDto(), seg: DURACAO_S },
  );
}

/** Grava a marca que `pwa.ts` grava antes de recarregar por atualização — ver
 *  `prepararRetomadaTocando` em `playerStore.ts`. */
async function marcarRetomadaTocando(page: Page, progress: number): Promise<void> {
  await page.evaluate(
    ({ track, progress }) => {
      window.localStorage.setItem(
        'aurial:resume',
        JSON.stringify({ track, progress, tocando: true }),
      );
    },
    { track: trackDto(), progress },
  );
}

function rodape(page: Page) {
  return page.getByRole('contentinfo');
}
function botao(page: Page, nome: string) {
  return rodape(page).getByRole('button', { name: nome }).first();
}

/** Mesmo truque de `reproducao.spec.ts`: o Howler cria `Audio()` solto (fora
 *  do documento), então o estado real só sai perguntando ao Howler global. */
async function estadoDoAudio(page: Page): Promise<{ tocando: boolean; tempo: number } | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const howls: any[] = (window as any).Howler?._howls ?? [];
    const nos: HTMLAudioElement[] = howls
      .map((h: any) => h?._sounds?.[0]?._node)
      .filter((n: unknown): n is HTMLAudioElement => Boolean(n));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ativo = nos.find((n) => !n.paused && n.currentTime > 0) ?? nos[0];
    if (!ativo) return null;
    return { tocando: !ativo.paused, tempo: ativo.currentTime };
  });
}

test.describe('retomar sozinho depois de uma atualização', () => {
  test('volta TOCANDO perto do segundo em que estava', async ({ page }) => {
    // Semeia em página vazia da mesma origem — igual a `reproducao.spec.ts`,
    // evita a corrida de o app persistir biblioteca vazia por cima da semente.
    await page.goto('/robots.txt');
    await semear(page);
    await page.goto('/library');

    const primeira = page.getByText('Faixa de retomada').first();
    await expect(primeira).toBeVisible({ timeout: 20_000 });
    await primeira.dblclick();
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });

    // Avança um pouco de verdade — não é um número inventado, é o relógio real.
    await expect
      .poll(async () => (await estadoDoAudio(page))?.tempo ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(3);
    const antes = (await estadoDoAudio(page))?.tempo ?? 0;

    // A marca que o atualizador do PWA grava antes de recarregar (ver `pwa.ts`).
    await marcarRetomadaTocando(page, antes);
    await page.reload();

    // TOCANDO sozinha, sem clique nenhum — é o pedido inteiro.
    await expect(botao(page, 'Pausar')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await estadoDoAudio(page))?.tocando ?? false, { timeout: 15_000 })
      .toBe(true);
    // E perto do PONTO salvo — não recomeçou do zero.
    const depois = (await estadoDoAudio(page))?.tempo ?? 0;
    expect(depois).toBeGreaterThanOrEqual(antes - 1);
  });
});
