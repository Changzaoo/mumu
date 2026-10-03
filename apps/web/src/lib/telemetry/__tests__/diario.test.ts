/**
 * O DIÁRIO DE BORDO — o caderno e os detectores.
 *
 * O que importa aqui: linhas iguais seguidas não empurram as que importam
 * para fora; o diário sobrevive ao recarregar (a aba morta em segundo plano
 * leva a memória junto); e os detectores só acusam o que medem — silêncio
 * com o tempo andando, posição parada com a store dizendo "tocando" — sem
 * falso alarme em pausa, carga ou troca de faixa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: (chave: string, texto: string) => {
    window.localStorage.setItem(chave, texto);
    return true;
  },
  registrarDescartavel: vi.fn(),
}));

import {
  anotar,
  coletarDiario,
  lerDiario,
  ouvirDiario,
  resumir,
  resumoDoDiario,
  zerarDiario,
} from '../diario';
import {
  DetectorDeSilencio,
  DetectorDeTravamento,
  LIMIAR_DE_SILENCIO,
  PRAZO_DE_SILENCIO_MS,
  PRAZO_DE_TRAVAMENTO_MS,
  descreverFaixa,
  nivelDoSinal,
  rotuloDaUrl,
} from '../diarioSondas';

describe('diário: o caderno', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    zerarDiario();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('anota com canal, evento, detalhe curto e hora', () => {
    anotar('player', 'faixa', { para: 'Garota de Ipanema · Tom Jobim', ctx: 'album' });
    const [linha] = lerDiario();
    expect(linha).toMatchObject({ c: 'player', e: 'faixa' });
    expect(linha?.d).toBe('para=Garota de Ipanema · Tom Jobim ctx=album');
    expect(linha?.em).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(linha?.n).toBeUndefined();
  });

  it('linhas iguais seguidas viram UMA com contador — e não apagam as outras', () => {
    anotar('motor', 'carregou', 'Faixa A');
    for (let i = 0; i < 500; i++) anotar('motor', 'buffer', 'esperando dados');
    const linhas = lerDiario();
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ e: 'carregou', d: 'Faixa A' });
    expect(linhas[1]).toMatchObject({ e: 'buffer', n: 500 });
  });

  it('encurta detalhes longos e aceita erro como detalhe', () => {
    expect(resumir(new Error('deu ruim'))).toBe('deu ruim');
    expect(resumir('x'.repeat(200))!.length).toBeLessThanOrEqual(90);
    expect(resumir(undefined)).toBeUndefined();
    expect(resumir({ a: undefined, b: '' })).toBeUndefined();
  });

  it('resume os sintomas e aponta o último', () => {
    anotar('player', 'play');
    anotar('motor', 'recusado', 'play: bloqueado (Faixa A)');
    anotar('audio', 'silencio', 'Faixa A em 12s');
    anotar('audio', 'silencio', 'Faixa A em 12s');
    anotar('player', 'pausa');
    const resumo = resumoDoDiario();
    expect(resumo.sintomas).toBe(3);
    expect(resumo.porSintoma).toEqual({ recusado: 1, silencio: 2 });
    expect(resumo.ultimoSintoma).toMatchObject({ e: 'silencio', d: 'Faixa A em 12s' });
  });

  it('a telemetria leva só as últimas linhas, mas o resumo conta tudo', () => {
    for (let i = 0; i < 100; i++) anotar('app', 'rota', `/p${i}`);
    anotar('erro', 'erro', 'quebrou');
    for (let i = 0; i < 100; i++) anotar('app', 'rota', `/q${i}`);
    const { linhas, resumo } = coletarDiario();
    expect(linhas.length).toBeLessThanOrEqual(70);
    expect(resumo.sintomas).toBe(1);
  });

  it('grava no aparelho (agrupando escritas) e marca a sessão anterior ao recarregar', async () => {
    anotar('player', 'faixa', 'A');
    anotar('player', 'play');
    expect(window.localStorage.getItem('aurial:diario')).toBeNull(); // ainda agrupando
    vi.advanceTimersByTime(600);
    const gravado = JSON.parse(window.localStorage.getItem('aurial:diario') ?? '[]');
    expect(gravado).toHaveLength(2);

    vi.resetModules();
    const recarregado = await import('../diario');
    const linhas = recarregado.lerDiario();
    expect(linhas.map((l) => l.e)).toEqual(['faixa', 'play', 'boot']);
    expect(linhas[2]?.d).toMatch(/nova sessão/);
  });

  it('avisa os ouvintes a cada linha nova (não nas repetidas)', () => {
    const visto: string[] = [];
    const parar = ouvirDiario((l) => visto.push(l.e));
    anotar('app', 'online');
    anotar('app', 'online');
    anotar('app', 'offline');
    parar();
    anotar('app', 'online');
    expect(visto).toEqual(['online', 'offline']);
  });
});

describe('diário: detector de silêncio (tempo anda, não sai som)', () => {
  const amostra = (desvio: number): Uint8Array => new Uint8Array(8).fill(128 + desvio);

  it('mede o sinal pelo desvio do silêncio', () => {
    expect(nivelDoSinal(amostra(0))).toBe(0);
    expect(nivelDoSinal(amostra(40))).toBe(40);
    expect(nivelDoSinal(new Uint8Array([128, 128, 90, 128]))).toBe(38);
  });

  it('acusa silêncio só com a posição andando e o sinal zerado pelo prazo; avisa quando volta', () => {
    const d = new DetectorDeSilencio();
    let t = 0;
    const leitura = (pos: number, nivel: number) =>
      d.avaliar({ tocando: true, posicao: pos, nivel, agora: t });
    expect(leitura(0, 0)).toBeNull(); // primeira leitura: sem referência de posição
    for (let s = 1; s <= 5; s++) {
      t = s * 1000;
      expect(leitura(s, 0)).toBeNull();
    }
    t = PRAZO_DE_SILENCIO_MS + 1000;
    expect(leitura(7, 0)).toBe('silencio');
    t += 1000;
    expect(leitura(8, 0)).toBeNull(); // uma vez por episódio
    t += 1000;
    expect(leitura(9, LIMIAR_DE_SILENCIO + 10)).toBe('somVoltou');
  });

  it('não acusa em pausa, com a posição parada, nem com som', () => {
    const d = new DetectorDeSilencio();
    let t = 0;
    for (let s = 0; s < 20; s++) {
      t = s * 1000;
      expect(d.avaliar({ tocando: false, posicao: s, nivel: 0, agora: t })).toBeNull();
    }
    for (let s = 20; s < 40; s++) {
      t = s * 1000;
      expect(d.avaliar({ tocando: true, posicao: 20, nivel: 0, agora: t })).toBeNull();
    }
    for (let s = 40; s < 60; s++) {
      t = s * 1000;
      expect(d.avaliar({ tocando: true, posicao: s, nivel: 30, agora: t })).toBeNull();
    }
  });

  it('trocar de faixa recomeça o episódio', () => {
    const d = new DetectorDeSilencio();
    d.avaliar({ tocando: true, posicao: 0, nivel: 0, agora: 0 });
    d.avaliar({ tocando: true, posicao: 1, nivel: 0, agora: 1000 });
    d.reiniciar();
    expect(
      d.avaliar({ tocando: true, posicao: 2, nivel: 0, agora: PRAZO_DE_SILENCIO_MS + 2000 }),
    ).toBeNull();
  });
});

describe('diário: detector de travamento (store diz tocando, posição parada)', () => {
  it('acusa depois do prazo e avisa quando destrava', () => {
    const d = new DetectorDeTravamento();
    const leitura = (pos: number, agora: number, esperando = false) =>
      d.avaliar({ tocando: true, esperando, posicao: pos, agora });
    expect(leitura(10, 0)).toBeNull(); // primeira leitura: referência
    expect(leitura(10, 3000)).toBeNull(); // parou de andar aqui
    expect(leitura(10, 3000 + PRAZO_DE_TRAVAMENTO_MS - 1)).toBeNull();
    expect(leitura(10, 3000 + PRAZO_DE_TRAVAMENTO_MS)).toBe('travou');
    expect(leitura(10, 4000 + PRAZO_DE_TRAVAMENTO_MS)).toBeNull(); // uma vez por episódio
    expect(leitura(11, 5000 + PRAZO_DE_TRAVAMENTO_MS)).toBe('destravou');
  });

  it('espera declarada (buffering ou carga) não é travamento', () => {
    const d = new DetectorDeTravamento();
    for (let s = 0; s < 30; s++) {
      expect(d.avaliar({ tocando: true, esperando: true, posicao: 5, agora: s * 1000 })).toBeNull();
    }
    for (let s = 30; s < 60; s++) {
      expect(
        d.avaliar({ tocando: false, esperando: false, posicao: 5, agora: s * 1000 }),
      ).toBeNull();
    }
  });
});

describe('diário: rótulos', () => {
  it('descreve a faixa com artista e fonte', () => {
    expect(
      descreverFaixa({
        title: 'Chega de Saudade',
        artists: [{ name: 'João Gilberto' }],
        streamUrl: 'https://api.radinho.online/stream/abc',
      } as never),
    ).toBe('Chega de Saudade · João Gilberto · [stream]');
    expect(
      descreverFaixa({
        title: 'X',
        artists: [],
        streamUrl: 'blob:https://radinho.online/1',
      } as never),
    ).toBe('X · [aparelho]');
    expect(descreverFaixa(null)).toBe('(nenhuma)');
  });

  it('rotula a URL sem query nem token', () => {
    expect(rotuloDaUrl('https://api.radinho.online/stream/abc?token=segredo')).toBe(
      'api.radinho.online/stream/abc',
    );
    expect(rotuloDaUrl(new URL('https://x.y/caminho'))).toBe('x.y/caminho');
  });
});
