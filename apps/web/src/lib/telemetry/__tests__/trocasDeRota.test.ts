/**
 * A SONDA DE TROCA DE ROTA — o instrumento da próxima rodada.
 *
 * A bancada dizia "aba → Início em 50–140 ms" e o dono sentia a Home lenta no
 * Moto G34 de verdade. Antes de anunciar qualquer conserto a mais, o aparelho
 * precisa contar quanto cada troca demora. Estes testes travam:
 *  - o que é guardado (de → para, ms, maior tarefa longa) e o LIMITE do histórico;
 *  - o resumo (mediana/p95) por rota de destino, sem inflar o payload;
 *  - a detecção no DOM: a troca só termina quando o conteúdo da rota nova está
 *    de pé (sem esqueleto), e o boot registra o primeiro conteúdo pintado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/telemetry/diario', () => ({ anotar: vi.fn() }));

type Modulo = typeof import('@/lib/telemetry/trocasDeRota');

async function carregar(): Promise<Modulo> {
  vi.resetModules();
  return import('@/lib/telemetry/trocasDeRota');
}

describe('registro das trocas', () => {
  let m: Modulo;
  beforeEach(async () => {
    m = await carregar();
  });

  it('normaliza a rota: o resumo é por TELA, não por artista', () => {
    expect(m.normalizarRota('/')).toBe('/');
    expect(m.normalizarRota('/search?q=ice')).toBe('/search');
    expect(m.normalizarRota('/artista/Ice%20Cube')).toBe('/artista/*');
    expect(m.normalizarRota('/disco/a%7Cb#x')).toBe('/disco/*');
  });

  it('guarda só as últimas 20 trocas', () => {
    for (let i = 0; i < 35; i++) {
      m.registrarTroca({ de: '/', para: '/search', ms: 100 + i, longaMs: 0 });
    }
    const { ultimas } = m.dadosDeTrocas();
    expect(ultimas).toHaveLength(m.MAX_TROCAS);
    expect(m.MAX_TROCAS).toBe(20);
    // As mais NOVAS ficam (da mais velha para a mais nova).
    expect(ultimas[0]?.ms).toBe(100 + 15);
    expect(ultimas.at(-1)?.ms).toBe(100 + 34);
  });

  it('resume por rota de destino: n, mediana e p95', () => {
    for (const ms of [100, 200, 300, 400, 1000]) {
      m.registrarTroca({ de: '/search', para: '/', ms, longaMs: 0 });
    }
    m.registrarTroca({ de: '/', para: '/library', ms: 50, longaMs: 0 });
    const { resumo } = m.dadosDeTrocas();
    expect(resumo['/']).toEqual({ n: 5, medianaMs: 300, p95Ms: 1000 });
    expect(resumo['/library']).toEqual({ n: 1, medianaMs: 50, p95Ms: 50 });
  });

  it('limita as amostras por rota e o número de rotas no resumo', () => {
    for (let i = 0; i < 100; i++) m.registrarTroca({ de: '/a', para: '/', ms: i, longaMs: 0 });
    expect(m.dadosDeTrocas().resumo['/']?.n).toBe(m.MAX_AMOSTRAS_POR_ROTA);

    for (let i = 0; i < 40; i++) {
      m.registrarTroca({ de: '/', para: `/rota${i}`, ms: 10, longaMs: 0 });
    }
    expect(Object.keys(m.dadosDeTrocas().resumo).length).toBeLessThanOrEqual(m.MAX_ROTAS_NO_RESUMO);
  });

  it('o payload fica pequeno mesmo depois de uma sessão enorme', () => {
    for (let i = 0; i < 5_000; i++) {
      m.registrarTroca({ de: '/', para: `/r${i % 50}`, ms: i % 900, longaMs: i % 300 });
    }
    expect(JSON.stringify(m.dadosDeTrocas()).length).toBeLessThan(6_000);
  });
});

describe('detecção no DOM', () => {
  let m: Modulo;
  const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  beforeEach(async () => {
    // jsdom sem `requestAnimationFrame` confiável: um quadro = um timer curto.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 1),
    );
    document.body.innerHTML = '<main><div class="skeleton"></div></main>';
    window.history.replaceState({}, '', '/');
    m = await carregar();
    m.instalarSondaDeRotas();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('registra o boot quando o primeiro conteúdo aparece (e não antes, com esqueleto)', async () => {
    await esperar(30);
    expect(m.dadosDeTrocas().boot).toBeNull();

    document.querySelector('main')!.innerHTML = '<h1>Boa noite</h1><a href="/liked">Curtidas</a>';
    await esperar(60);

    const { boot } = m.dadosDeTrocas();
    expect(boot?.rota).toBe('/');
    expect(boot?.ms).toBeGreaterThan(0);
  });

  it('a troca termina no conteúdo da rota NOVA, não no esqueleto dela', async () => {
    document.querySelector('main')!.innerHTML = '<h1>Início</h1>';
    await esperar(40);

    window.history.pushState({}, '', '/search');
    document.querySelector('main')!.innerHTML = '<div class="skeleton"></div>';
    await esperar(60);
    // Ainda esqueleto: nada registrado.
    expect(m.dadosDeTrocas().ultimas).toHaveLength(0);

    document.querySelector('main')!.innerHTML = '<h2>Buscar</h2><button>Tocar</button>';
    await esperar(60);

    const { ultimas, resumo } = m.dadosDeTrocas();
    expect(ultimas).toHaveLength(1);
    expect(ultimas[0]).toMatchObject({ de: '/', para: '/search' });
    expect(ultimas[0]!.ms).toBeGreaterThanOrEqual(50);
    expect(ultimas[0]!.longaMs).toBe(0);
    expect(resumo['/search']?.n).toBe(1);
  });

  it('mudar só a consulta da mesma tela não é troca de rota', async () => {
    window.history.pushState({}, '', '/search');
    document.querySelector('main')!.innerHTML = '<h2>Buscar</h2>';
    await esperar(60);
    const antes = m.dadosDeTrocas().ultimas.length;

    window.history.pushState({}, '', '/search?q=ice');
    document.querySelector('main')!.innerHTML = '<h2>Buscar</h2><button>x</button>';
    await esperar(60);

    expect(m.dadosDeTrocas().ultimas.length).toBe(antes);
  });
});
