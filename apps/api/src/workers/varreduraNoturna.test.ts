/**
 * DUAS COISAS PRECISAM SER ÓBVIAS NESTE AGENTE.
 *
 * A primeira é a JANELA. "Madrugada" quase sempre atravessa a meia-noite, e
 * `hora >= inicio && hora < fim` — a forma que todo mundo escreve primeiro —
 * responde `false` a noite inteira quando o início é 22 e o fim é 5. O agente
 * simplesmente nunca rodaria, sem erro nenhum no log.
 *
 * A segunda é a FOLGA NO COFRE. O cofre é menor que o acervo, então num cofre
 * cheio cada faixa reparada expulsa outra pelo LRU: a varredura gastaria a noite
 * para deixar o acervo exatamente como estava. Não trabalhar, nesse caso, é o
 * comportamento correto — e é o que estes testes travam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = {
  IMPORTER_URL: 'http://importer:8790',
  IMPORTER_PUBLIC_URL: 'https://importer.exemplo',
  IMPORT_SERVICE_TOKEN: 'x'.repeat(48),
  VARREDURA_HORA_INICIO: 3,
  VARREDURA_HORA_FIM: 6,
  VARREDURA_MAX_POR_NOITE: 80,
  VARREDURA_FOLGA_MINIMA_BYTES: 2_000_000_000,
};

vi.mock('../config/index.js', () => ({ env }));
vi.mock('../core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../infra/db/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }));
vi.mock('../modules/catalog/catalog.repository.js', () => ({ upsertCatalogTrack: vi.fn() }));

const { dentroDaJanela, folgaReal, varrerUmaVez } = await import('./varreduraNoturna.worker.js');

describe('folgaReal', () => {
  it('DISCO VAZIO E TETO CHEIO: manda o teto — foi o bug real', () => {
    // Estado medido no servidor em 2026-08-30: 3,93 GB livres no disco e 92 MB
    // de folga sob o teto. Olhando só o disco, a varredura teria rodado a noite
    // inteira expulsando uma faixa a cada faixa que trouxesse de volta.
    expect(
      folgaReal({
        livreBytes: 4_221_714_432,
        tetoBytes: 19_327_352_832,
        bytesEmBins: 19_230_541_183,
      }),
    ).toBe(96_811_649);
  });

  it('TETO FOLGADO E DISCO CHEIO: manda o disco', () => {
    expect(folgaReal({ livreBytes: 50_000_000, tetoBytes: 1e12, bytesEmBins: 1 })).toBe(50_000_000);
  });

  it('cofre acima do teto não devolve folga negativa', () => {
    expect(folgaReal({ livreBytes: 9e9, tetoBytes: 100, bytesEmBins: 500 })).toBe(0);
  });

  it('usa o que existe quando falta um dos números', () => {
    expect(folgaReal({ livreBytes: 123 })).toBe(123);
    expect(folgaReal({ tetoBytes: 1000, bytesEmBins: 400 })).toBe(600);
  });

  it('sem número nenhum é "não sei" — e não sei vale como não trabalhe', () => {
    expect(folgaReal({})).toBeNull();
    expect(folgaReal({ tetoBytes: 1000 })).toBeNull();
  });
});

describe('dentroDaJanela', () => {
  it('janela normal: 3h às 6h', () => {
    expect(dentroDaJanela(2, 3, 6)).toBe(false);
    expect(dentroDaJanela(3, 3, 6)).toBe(true);
    expect(dentroDaJanela(5, 3, 6)).toBe(true);
    expect(dentroDaJanela(6, 3, 6)).toBe(false); // fim é exclusivo
  });

  it('janela que ATRAVESSA a meia-noite: 22h às 5h', () => {
    // O caso que a forma ingênua erra — e erra em silêncio, nunca rodando.
    expect(dentroDaJanela(23, 22, 5)).toBe(true);
    expect(dentroDaJanela(0, 22, 5)).toBe(true);
    expect(dentroDaJanela(4, 22, 5)).toBe(true);
    expect(dentroDaJanela(5, 22, 5)).toBe(false);
    expect(dentroDaJanela(12, 22, 5)).toBe(false);
    expect(dentroDaJanela(21, 22, 5)).toBe(false);
  });

  it('início igual ao fim significa o dia inteiro', () => {
    for (const h of [0, 7, 13, 23]) expect(dentroDaJanela(h, 0, 0)).toBe(true);
  });
});

describe('varrerUmaVez — as travas', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    env.IMPORTER_URL = 'http://importer:8790';
    env.IMPORT_SERVICE_TOKEN = 'x'.repeat(48);
    env.VARREDURA_HORA_INICIO = 3;
    env.VARREDURA_HORA_FIM = 6;
  });

  const madrugada = new Date('2026-08-30T04:00:00');

  it('sem IMPORTER_URL não faz nada e diz por quê', async () => {
    env.IMPORTER_URL = '';
    const r = await varrerUmaVez(madrugada);
    expect(r.rodou).toBe(false);
    expect(r.motivo).toMatch(/IMPORTER_URL/);
  });

  it('sem crachá de máquina não faz nada', async () => {
    // O importador é fechado por conta do Firebase; sem o token de serviço toda
    // chamada voltaria 403 e a varredura seria uma metralhadora de recusas.
    env.IMPORT_SERVICE_TOKEN = '';
    const r = await varrerUmaVez(madrugada);
    expect(r.rodou).toBe(false);
    expect(r.motivo).toMatch(/IMPORT_SERVICE_TOKEN/);
  });

  it('fora da janela não trabalha', async () => {
    const meioDia = new Date('2026-08-30T12:00:00');
    const r = await varrerUmaVez(meioDia);
    expect(r.rodou).toBe(false);
    expect(r.motivo).toBe('fora da janela');
  });

  it('COFRE CHEIO: não repara, porque reparar expulsaria outra faixa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ pronto: true, livreBytes: 100_000_000 }), // 100 MB
      })),
    );
    const r = await varrerUmaVez(madrugada);
    expect(r.rodou).toBe(false);
    expect(r.motivo).toMatch(/sem folga/);
    expect(r.reparadas).toBe(0);
  });

  it('cofre que não responde não é tratado como cofre vazio', async () => {
    // Silêncio do cofre não é permissão: sem saber a folga, trabalhar seria
    // apostar a noite num palpite.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('sem rede');
      }),
    );
    const r = await varrerUmaVez(madrugada);
    expect(r.rodou).toBe(false);
    expect(r.motivo).toBe('cofre não respondeu');
  });

  it('APAGÃO DA FONTE: desiste em vez de enterrar a fila inteira', async () => {
    // 2026-08-30: o YouTube limitou a sessão e passou a responder "Video
    // unavailable" para TUDO. O importador lia isso como faixa morta e mandava
    // `permanent: true`; a varredura carimbava `reparoImpossivel`, que é para
    // sempre. Uma hora ruim teria convertido centenas de faixas vivas em faixas
    // oficialmente mortas. Falha isolada é faixa; falha em série é o mundo.
    //
    // A janela vai aberta (início === fim) porque o laço reconfere o horário com
    // o relógio de parede a cada faixa — de propósito, para não invadir a manhã
    // de quem já está ouvindo. Sem isto o teste só passaria entre 3h e 6h.
    env.VARREDURA_HORA_INICIO = 0;
    env.VARREDURA_HORA_FIM = 0;
    // A pausa entre faixas é de 5 s de verdade — educação com quem está
    // ouvindo, não algo a testar aqui. Sem encurtá-la, provar a trava custaria
    // 40 s de espera parada.
    vi.stubGlobal('setTimeout', ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    const { prisma } = await import('../infra/db/prisma.js');
    const { upsertCatalogTrack } = await import('../modules/catalog/catalog.repository.js');
    vi.mocked(upsertCatalogTrack).mockClear();
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) => ({
        id: `t${i}`,
        data: { sourceUrl: 'https://www.youtube.com/watch?v=x' },
      })),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/cofre/estado')) {
          return { ok: true, json: async () => ({ pronto: true, livreBytes: 50_000_000_000 }) };
        }
        // 500 = a fonte não respondeu direito. Transiente, que é o que denuncia
        // apagão — 400 significaria "link não suportado", faixa morta.
        return { ok: false, status: 500, json: async () => ({}) };
      }),
    );

    const r = await varrerUmaVez(new Date());

    expect(r.rodou).toBe(true);
    expect(r.motivo).toMatch(/seguidas/);
    // O essencial: quase nada foi carimbado. Sem a trava seriam 60.
    expect(vi.mocked(upsertCatalogTrack).mock.calls.length).toBeLessThan(10);
    vi.unstubAllGlobals();
  });

  it('com folga e sem candidatas, roda e não repara nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ pronto: true, livreBytes: 50_000_000_000 }),
      })),
    );
    const r = await varrerUmaVez(madrugada);
    expect(r.rodou).toBe(true);
    expect(r.reparadas).toBe(0);
  });
});

describe('apagão x cauda ruim da fila', () => {
  const madrugada = new Date();

  beforeEach(() => {
    vi.restoreAllMocks();
    env.IMPORTER_URL = 'http://importer:8790';
    env.IMPORT_SERVICE_TOKEN = 'x'.repeat(48);
    env.VARREDURA_HORA_INICIO = 0;
    env.VARREDURA_HORA_FIM = 0;
  });

  it('FAIXA MORTA EM SÉRIE NÃO É APAGÃO — a varredura segue', async () => {
    // Medido em produção: a trava disparou com o importador no ar e o YouTube
    // respondendo normalmente. A fila tinha chegado na cauda de vídeos
    // removidos. Contá-los como apagão fazia a varredura parar a cada 8 faixas
    // e andar quatro por rodada.
    vi.stubGlobal('setTimeout', ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    const { prisma } = await import('../infra/db/prisma.js');
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, i) => ({
        id: `morta${i}`,
        data: { sourceUrl: 'https://www.youtube.com/watch?v=x' },
      })),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/cofre/estado')) {
          return { ok: true, json: async () => ({ pronto: true, livreBytes: 50_000_000_000 }) };
        }
        // 400 = link não suportado: a fonte RESPONDEU, e disse que morreu.
        return { ok: false, status: 400, json: async () => ({}) };
      }),
    );

    const r = await varrerUmaVez(madrugada);

    expect(r.motivo).toBeUndefined();
    expect(r.impossiveis).toBe(30);
    vi.unstubAllGlobals();
  });
});
