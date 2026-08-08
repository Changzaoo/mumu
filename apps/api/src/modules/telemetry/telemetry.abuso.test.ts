/**
 * O ENDEREÇO DE ESCRITA É ABERTO — então os testes têm que pensar como abusador.
 *
 * `PUT /telemetria/:deviceId` aceita qualquer um, sem conta, por decisão de
 * projeto (visitante é justamente quem precisa ser contado). O que NÃO pode
 * acontecer é o abuso sair barato. Cada teste aqui reproduz uma tentativa
 * concreta que funcionava antes:
 *
 *  - derrubar a requisição com 10 KB de aninhamento (RangeError, 500);
 *  - passar do teto de 64 KB usando caracteres de mais de um byte;
 *  - gastar um `SELECT` no Postgres por corpo recusado;
 *  - sequestrar o vínculo de conta do aparelho de outra pessoa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const upsert = vi.fn(async (_args: unknown) => undefined);

vi.mock('../../infra/db/prisma.js', () => ({
  prisma: {
    telemetryDevice: { findUnique: () => findUnique(), upsert: (a: unknown) => upsert(a) },
  },
}));

const { mesclar, fundirParaTeste, profundidadeAceitavel, tamanhoAceitavel, MAX_BYTES } =
  await import('./telemetry.repository.js');
const { telemetryController } = await import('./telemetry.controller.js');

/** Roda o handler do controlador como o Express roda: erro vai para `next`. */
async function registrar(
  deviceId: string,
  body: unknown,
  user?: { id: string },
): Promise<{ status: number; erro?: Error }> {
  let status = 0;
  const res = {
    status(s: number) {
      status = s;
      return { end: () => undefined };
    },
  };
  let erro: Error | undefined;
  await new Promise<void>((resolve) => {
    void telemetryController.registrar(
      { params: { deviceId }, body, user } as never,
      res as never,
      ((e?: Error) => {
        erro = e;
        resolve();
      }) as never,
    );
    // Handlers que respondem não chamam `next` — resolve na próxima volta.
    setTimeout(resolve, 30);
  });
  return { status, erro };
}

/** `{"a":[[[…]]]}` — o corpo mais barato que estourava a pilha. */
function arrayFundo(niveis: number): Record<string, unknown> {
  return JSON.parse(`{"a":${'['.repeat(niveis)}1${']'.repeat(niveis)}}`) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
});

describe('escrita aberta — aninhamento profundo', () => {
  it('o corpo fundo QUEBRAVA o próprio teto de tamanho (a prova do risco)', () => {
    // Sem a barreira, quem MEDE o documento é `JSON.stringify` — e ele desce
    // recursivamente. 5.000 níveis de array, ~10 KB de corpo, e a medição morre
    // antes de poder recusar: 500 em vez de 4xx, de graça, sem conta.
    expect(() => JSON.stringify(arrayFundo(5000))).toThrow(RangeError);
  });

  it('a checagem de profundidade NÃO estoura no corpo que ela barra', () => {
    // Iterativa de propósito: uma versão recursiva cairia junto.
    expect(profundidadeAceitavel(arrayFundo(5000))).toBe(false);
    expect(profundidadeAceitavel(arrayFundo(200000))).toBe(false);
  });

  it('recusa o corpo fundo com 422 e SEM tocar no Postgres', async () => {
    const { erro } = await registrar('aparelho-1', { dados: arrayFundo(5000) });

    expect(erro).toBeDefined();
    expect((erro as { status?: number }).status).toBe(422);
    // O ponto do conserto: a recusa acontece ANTES do `SELECT`. Antes, cada
    // tentativa abusiva custava uma ida ao banco.
    expect(findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('objeto fundo (o outro caminho, que derrubava o `fundir`) também é barrado', async () => {
    const fundo = JSON.parse(`{${'"a":{'.repeat(4000)}${'}'.repeat(4000)}}`) as Record<
      string,
      unknown
    >;
    const { erro } = await registrar('aparelho-1', { dados: fundo });
    expect((erro as { status?: number }).status).toBe(422);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('telemetria de verdade (três níveis) passa sem reclamar', async () => {
    const { status } = await registrar('aparelho-1', {
      dados: { pageSeconds: { inicio: { __inc: 12 } }, clickCounts: { tocar: { __inc: 3 } } },
    });
    expect(status).toBe(204);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('escrita aberta — teto de tamanho', () => {
  it('o teto contava CARACTERES e o Postgres guarda BYTES', () => {
    // 60.008 unidades de UTF-16, 180.008 bytes em UTF-8: o `.length` deixava
    // passar quase o TRIPLO do teto prometido.
    const doc = JSON.stringify({ s: '音'.repeat(60000) });
    expect(doc.length).toBeLessThan(MAX_BYTES);
    expect(Buffer.byteLength(doc, 'utf8')).toBeGreaterThan(MAX_BYTES * 2);
    expect(tamanhoAceitavel(doc)).toBe(false);
  });

  it('recusa o corpo grande ANTES do Postgres', async () => {
    const { erro } = await registrar('aparelho-1', { dados: { s: 'x'.repeat(MAX_BYTES + 1) } });
    expect((erro as { status?: number }).status).toBe(422);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ainda recusa quando é a FUSÃO que passa do teto, não o pedaço', async () => {
    // O pedaço cabe; o documento acumulado é que não. Este teto continua no
    // repositório porque só ele conhece o que já estava gravado.
    findUnique.mockResolvedValue({ data: { antigo: 'y'.repeat(MAX_BYTES - 100) } });
    const resultado = await mesclar('aparelho-1', null, { novo: 'z'.repeat(500) });
    expect(resultado).toBe('grande-demais');
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('escrita aberta — vínculo de conta', () => {
  it('NÃO deixa uma conta sequestrar o aparelho já vinculado a outra', async () => {
    // O cenário: o aparelho de alguém já está vinculado à conta dela. Como o
    // `deviceId` é público e a escrita é aberta, bastava um atacante COM conta
    // mandar um pedaço qualquer para aquele id — e o aparelho passava a contar
    // como dele no painel.
    findUnique.mockResolvedValue({ data: {}, userId: 'vitima' });

    await mesclar('aparelho-da-vitima', 'atacante', { x: 1 });

    const update = upsert.mock.calls[0]![0] as { update: { userId?: string } };
    expect(update.update.userId).toBeUndefined();
  });

  it('mas o vínculo AVANÇA de anônimo para conta — que é o que ele existe para fazer', async () => {
    findUnique.mockResolvedValue({ data: {}, userId: null });

    await mesclar('aparelho-1', 'dono', { x: 1 });

    const update = upsert.mock.calls[0]![0] as { update: { userId?: string } };
    expect(update.update.userId).toBe('dono');
  });

  it('e não volta a ser anônimo quando a sessão expira no meio de uma medição', async () => {
    findUnique.mockResolvedValue({ data: {}, userId: 'dono' });

    await mesclar('aparelho-1', null, { x: 1 });

    const update = upsert.mock.calls[0]![0] as { update: { userId?: string } };
    expect(update.update.userId).toBeUndefined();
  });
});

describe('escrita aberta — chaves envenenadas', () => {
  it('`__proto__` não polui o protótipo global (o risco clássico NÃO existe aqui)', () => {
    const corpo = JSON.parse('{"__proto__":{"poluido":"sim"}}') as Record<string, unknown>;
    fundirParaTeste({}, corpo);
    expect(({} as Record<string, unknown>).poluido).toBeUndefined();
  });

  it('mas a chave é RECUSADA em vez de aceita-e-descartada em silêncio', () => {
    // O que acontecia: a atribuição caía no acessor de `__proto__`, o documento
    // gravado saía sem a chave, o objeto entregue ao Prisma saía com o protótipo
    // TROCADO, e a resposta era 204. Escrita "aceita" e dado que não existe.
    const saida = fundirParaTeste({}, JSON.parse('{"__proto__":{"a":1},"ok":1}'));
    expect(Object.getPrototypeOf(saida)).toBe(Object.prototype);
    expect(saida.ok).toBe(1);
    expect((saida as Record<string, unknown>).a).toBeUndefined();
  });

  it('`constructor` e `prototype` não entram no documento', () => {
    const saida = fundirParaTeste(
      {},
      JSON.parse('{"constructor":{"prototype":{"x":1}},"prototype":{"y":1},"real":2}'),
    );
    expect(Object.keys(saida)).toEqual(['real']);
  });

  it('o painel do admin AGUENTA um documento com `toString`/`toJSON` envenenados', () => {
    // Verificado, e o veredito é NÃO EXPLORÁVEL: `JSON.stringify` (que é o que o
    // `res.json` usa) não invoca `toString`, e ignora um `toJSON` que não seja
    // função. A chave é gravada como chave e o `GET` responde normalmente.
    const envenenado = JSON.parse('{"toString":{"x":1},"toJSON":{"y":2},"hasOwnProperty":1}');
    const saida = fundirParaTeste({}, envenenado);
    expect(() => JSON.stringify({ data: [{ data: saida }] })).not.toThrow();
  });
});

describe('escrita aberta — id do aparelho', () => {
  it('recusa id fora do formato antes de qualquer coisa', async () => {
    for (const ruim of ['', 'curto', 'com espaço', 'a'.repeat(129), '../../etc/passwd']) {
      const { erro } = await registrar(ruim, { dados: { x: 1 } });
      expect(erro, `deveria recusar: ${JSON.stringify(ruim)}`).toBeDefined();
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});
