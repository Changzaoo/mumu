/**
 * A varredura de durações lê o cabeçalho da cópia no cofre — e só o cabeçalho.
 *
 * O cofre aqui é um dublê HTTP local que serve um MP3 montado byte a byte (com
 * capa embutida GRANDE, para forçar a segunda leitura) e respeita Range, como o
 * `/blob` do importador. O banco é um dublê que registra o que foi gravado.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, unknown> = {};
vi.mock('../config/index.js', () => ({ env }));
vi.mock('../core/logger.js', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
  },
}));
const $queryRaw = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const $executeRaw = vi.fn(async (..._a: unknown[]): Promise<number> => 0);
vi.mock('../infra/db/prisma.js', () => ({ prisma: { $queryRaw, $executeRaw } }));
const upsertCatalogTrack = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack }));

const { divergeMuito, medirCopia, medirLote, urlParaLer } = await import('./duracoes.worker.js');

// ── o MP3 do dublê ───────────────────────────────────────────────
const QUADRO = 417; // MPEG-1 III, 128 kbps, 44,1 kHz
function mp3(quadros: number, capa: number): Buffer {
  const id3 = Buffer.alloc(10 + capa);
  id3.write('ID3', 0, 'latin1');
  id3[3] = 4;
  id3[6] = (capa >> 21) & 0x7f;
  id3[7] = (capa >> 14) & 0x7f;
  id3[8] = (capa >> 7) & 0x7f;
  id3[9] = capa & 0x7f;
  const quadro = () => {
    const q = Buffer.alloc(QUADRO);
    q.set([0xff, 0xfb, 0x90, 0x00]);
    return q;
  };
  const info = quadro();
  info.write('Info', 36, 'latin1');
  info.writeUInt32BE(0x0f, 40);
  info.writeUInt32BE(quadros, 44);
  return Buffer.concat([id3, info, quadro(), quadro()]);
}
const QUATRO_MIN = 9188; // quadros ≈ 240 s
const arquivo = mp3(QUATRO_MIN, 300_000); // capa de 300 KB: não cabe na 1ª leitura
const esperado = Math.round((QUATRO_MIN * 1152 * 1000) / 44100);

let servidor: Server;
let base = '';
const pedidos: string[] = [];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    pedidos.push(`${req.url} ${req.headers.range ?? ''} ${req.headers.authorization ?? ''}`);
    if (req.url?.startsWith('/blob/morta')) {
      res.writeHead(404).end();
      return;
    }
    if (req.url?.startsWith('/blob/texto')) {
      res.writeHead(200, { 'Content-Length': '5' }).end('olá!!');
      return;
    }
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    const ini = m ? Number(m[1]) : 0;
    const fim = Math.min(m ? Number(m[2]) : arquivo.length - 1, arquivo.length - 1);
    res.writeHead(m ? 206 : 200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(fim - ini + 1),
      ...(m ? { 'Content-Range': `bytes ${ini}-${fim}/${arquivo.length}` } : {}),
    });
    res.end(arquivo.subarray(ini, fim + 1));
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => {
  pedidos.length = 0;
  $queryRaw.mockReset().mockResolvedValue([]);
  $executeRaw.mockReset().mockResolvedValue(0);
  upsertCatalogTrack.mockReset();
  delete env.IMPORTER_URL;
});

describe('medirCopia', () => {
  it('lê a duração do cabeçalho em duas leituras curtas, sem baixar a música', async () => {
    expect(await medirCopia(`${base}/blob/local:1?k=t`)).toBe(esperado);
    expect(pedidos).toHaveLength(2); // a capa não coube: pulou a etiqueta
    for (const p of pedidos) expect(p).toMatch(/bytes=\d+-\d+/);
    // Nenhum crachá nosso vai junto: quem abre a cópia é o token da URL.
    for (const p of pedidos) expect(p.endsWith(' ')).toBe(true);
  });

  it('404 é "morta"; arquivo que não é MP3 é "não sei"; rede fora é "incerta"', async () => {
    expect(await medirCopia(`${base}/blob/morta?k=t`)).toBe('morta');
    expect(await medirCopia(`${base}/blob/texto?k=t`)).toBeNull();
    expect(await medirCopia('http://127.0.0.1:1/blob/x?k=t')).toBe('incerta');
  });
});

describe('urlParaLer', () => {
  it('troca o endereço público pelo interno quando é o cofre', () => {
    env.IMPORTER_URL = 'http://importer:8790/';
    expect(urlParaLer('https://importer.exemplo/blob/local%3A1?k=abc')).toBe(
      'http://importer:8790/blob/local%3A1?k=abc',
    );
    expect(urlParaLer('https://outro.cdn/audio.mp3')).toBe('https://outro.cdn/audio.mp3');
    expect(urlParaLer('blob:http://x/1')).toBeNull();
    expect(urlParaLer('lixo')).toBeNull();
  });
});

describe('divergeMuito', () => {
  it('a medida vence o 0:14 gravado; arredondamento não é divergência', () => {
    expect(divergeMuito(14_000, 240_000)).toBe(true);
    expect(divergeMuito(0, 240_000)).toBe(true);
    expect(divergeMuito(null, 240_000)).toBe(true);
    expect(divergeMuito(Number.NaN, 240_000)).toBe(true);
    expect(divergeMuito(239_000, 240_000)).toBe(false);
  });
});

describe('medirLote', () => {
  it('grava a duração medida no acervo e leva às bibliotecas', async () => {
    $queryRaw.mockResolvedValueOnce([
      {
        id: 'local:1',
        data: {
          track: { id: 'local:1', durationMs: 14_000 },
          remoteUrl: `${base}/blob/local:1?k=t`,
        },
      },
    ]);
    $executeRaw.mockResolvedValue(2);
    const r = await medirLote();
    expect(r).toMatchObject({ vistas: 1, medidas: 1, semMedida: 0 });
    const [id, gravada] = upsertCatalogTrack.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('local:1');
    expect((gravada.track as { durationMs: number }).durationMs).toBe(esperado);
    expect(gravada.duracaoMedidaEm).toEqual(expect.any(String));
    // Biblioteca da faixa + preenchimento em lote pelo acervo.
    expect($executeRaw).toHaveBeenCalledTimes(2);
    const [partes] = $executeRaw.mock.calls[0] as unknown as [string[]];
    expect(partes.join('?')).toMatch(/"updatedAt" = now\(\)/);
  });

  it('não é MP3: marca e sai da fila, sem gravar 0 e sem mexer no carimbo', async () => {
    $queryRaw.mockResolvedValueOnce([
      { id: 'local:2', data: { track: { id: 'local:2' }, remoteUrl: `${base}/blob/texto?k=t` } },
    ]);
    const r = await medirLote();
    expect(r).toMatchObject({ vistas: 1, medidas: 0, semMedida: 1 });
    expect(upsertCatalogTrack).not.toHaveBeenCalled();
    const [partes, ...valores] = $executeRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    expect(partes.join('?')).toMatch(/UPDATE "CatalogTrack"/);
    expect(partes.join('?')).not.toMatch(/updatedAt/);
    expect(valores).toContain('duracaoSemMedida');
  });

  it('rede fora não marca nada: tenta na próxima volta', async () => {
    $queryRaw.mockResolvedValueOnce([
      {
        id: 'local:3',
        data: { track: { id: 'local:3' }, remoteUrl: 'http://127.0.0.1:1/blob/x?k=t' },
      },
    ]);
    const r = await medirLote();
    expect(r).toMatchObject({ vistas: 1, medidas: 0, semMedida: 0 });
    expect(upsertCatalogTrack).not.toHaveBeenCalled();
    // Só o preenchimento das bibliotecas pelo acervo rodou.
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });
});
