/**
 * O MÉDICO — reconhece a doença no diário, trata, confirma que passou e dá
 * alta: as linhas da doença ficam `ok` (verdes no painel) e saem da conta de
 * sintomas em aberto. Nunca dá alta por tempo: só com a prova (/health
 * respondeu, LRCLIB respondeu).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/cofreLocal', () => ({
  gravarCache: vi.fn(),
  registrarDescartavel: vi.fn(),
}));
vi.mock('@/lib/local/importerHelper', () => ({
  helperUrl: () => 'https://importer.radinho.online',
}));

import { anotar, lerDiario, resumoDoDiario, zerarDiario } from '../diario';
import {
  EVENTO_DE_ALTA,
  FALHAS_PARA_TRATAR,
  SONDAS_MS,
  casoAberto,
  desinstalarMedico,
  ehQueixaDoImportador,
  ehQueixaDoLrclib,
  instalarMedico,
} from '../medico';
import { circuitoAberto, zerarSaudeDoImportador } from '@/lib/local/saudeDoImportador';
import { pedirAoLrclib, zerarPortaoDoLrclib } from '@/lib/lyrics/portaoDoLrclib';

const resposta = (status: number, cabecalhos: Record<string, string> = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(cabecalhos) }) as Response;

/** O importador: `saude` diz se o /health responde; o resto sempre responde. */
function stubDoImportador(estado: { saude: boolean; bloqueado?: boolean }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/health')) {
      if (estado.saude) return resposta(200);
      // Sem CORS a borda responde opaco quando está só bloqueando; quando nem
      // a borda é alcançada, falha dos dois jeitos.
      if (estado.bloqueado && init?.mode === 'no-cors') return { ok: false, status: 0 } as Response;
      throw new TypeError('Failed to fetch');
    }
    return resposta(200);
  });
}

function falhasDoImportador(quantas: number): void {
  const rotas = ['/letra/outras-fontes', '/ai/chat', '/aquecer', '/speed'];
  for (let i = 0; i < quantas; i++) {
    anotar('rede', 'falhou', `GET importer.radinho.online${rotas[i % rotas.length]} Failed to fetch`);
  }
}

describe('o médico e o importador fora do ar', () => {
  let estado: { saude: boolean; bloqueado?: boolean };
  let altas: string[];
  const aoDarAlta = (e: Event): void => {
    altas.push((e as CustomEvent<{ doenca: string }>).detail.doenca);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    zerarDiario();
    zerarSaudeDoImportador();
    zerarPortaoDoLrclib();
    desinstalarMedico();
    estado = { saude: false };
    vi.stubGlobal('fetch', stubDoImportador(estado));
    altas = [];
    window.addEventListener(EVENTO_DE_ALTA, aoDarAlta);
    instalarMedico();
  });

  afterEach(() => {
    window.removeEventListener(EVENTO_DE_ALTA, aoDarAlta);
    desinstalarMedico();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reconhece a queixa pelo host, não pelo caminho', () => {
    const linha = (e: string, d: string) => ({ em: '', ms: 0, c: 'rede' as const, e, d });
    expect(ehQueixaDoImportador(linha('falhou', 'GET importer.radinho.online/stream Failed to fetch'))).toBe(true);
    expect(ehQueixaDoImportador(linha('http', '503 POST importer.radinho.online/ai/chat'))).toBe(true);
    expect(ehQueixaDoImportador(linha('http', '404 GET importer.radinho.online/cover'))).toBe(false);
    expect(ehQueixaDoImportador(linha('falhou', 'GET lrclib.net/api/get Failed to fetch'))).toBe(false);
    expect(ehQueixaDoLrclib(linha('http', '429 GET lrclib.net/api/search'))).toBe(true);
    expect(ehQueixaDoLrclib(linha('http', '400 GET lrclib.net/api/get'))).toBe(false);
  });

  it('uma falha só é soluço: não abre caso', () => {
    falhasDoImportador(1);
    expect(casoAberto()).toBeNull();
    expect(circuitoAberto()).toBe(false);
  });

  it('duas falhas em 30 s: abre o disjuntor, sonda /health e dá alta quando responde', async () => {
    falhasDoImportador(FALHAS_PARA_TRATAR);
    expect(circuitoAberto()).toBe(true);
    expect(casoAberto()?.falhas).toBe(2);
    expect(lerDiario().some((l) => l.c === 'medico' && l.e === 'tratando')).toBe(true);
    expect(resumoDoDiario().sintomas).toBe(2);

    // Primeira sonda: o importador segue fora — o caso continua, com diagnóstico.
    await vi.advanceTimersByTimeAsync(SONDAS_MS[0] ?? 0);
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/health'))).toBe(true);
    expect(circuitoAberto()).toBe(true);
    const sondando = lerDiario().find((l) => l.c === 'medico' && l.e === 'sondando');
    expect(sondando?.d).toContain('sem alcance');

    // Mais falhas durante o tratamento entram no mesmo caso, não abrem outro.
    falhasDoImportador(3);
    expect(casoAberto()?.falhas).toBe(5);

    // O importador volta: a próxima sonda confirma, fecha o disjuntor e dá alta.
    estado.saude = true;
    await vi.advanceTimersByTimeAsync(SONDAS_MS[1] ?? 0);
    expect(circuitoAberto()).toBe(false);
    expect(casoAberto()).toBeNull();

    const linhas = lerDiario();
    const falhas = linhas.filter((l) => l.c === 'rede' && l.e === 'falhou');
    expect(falhas.length).toBeGreaterThan(0);
    expect(falhas.every((l) => l.ok === true)).toBe(true);
    const alta = linhas.find((l) => l.c === 'medico' && l.e === 'curou');
    expect(alta?.d).toMatch(/importador voltou depois de \d+s: 5 falha\(s\) curada\(s\)/);
    expect(resumoDoDiario().sintomas).toBe(0);
    expect(resumoDoDiario().curados).toBe(5);
    expect(altas).toEqual(['importador']);
  });

  it('distingue "sem alcance" de "alcança a borda mas é bloqueado"', async () => {
    estado.bloqueado = true;
    falhasDoImportador(2);
    await vi.advanceTimersByTimeAsync(SONDAS_MS[0] ?? 0);
    const sondando = lerDiario().find((l) => l.c === 'medico' && l.e === 'sondando');
    expect(sondando?.d).toContain('bloqueada');
  });

  it('com a tela apagada não sonda; ao acender, sonda na hora', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    falhasDoImportador(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/health'))).toBe(false);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    estado.saude = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/health'))).toBe(true);
    expect(circuitoAberto()).toBe(false);
  });

  it('não dá alta por tempo: dez minutos fora viram "desistiu", mas segue sondando', async () => {
    falhasDoImportador(2);
    // Vinte minutos: mais que a válvula de 15 min do disjuntor — cada sonda
    // falha o re-arma, então ele segue aberto enquanto o médico sonda.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(circuitoAberto()).toBe(true);
    expect(casoAberto()?.desistiu).toBe(true); // o caso continua aberto, sem alta
    expect(lerDiario().some((l) => l.c === 'medico' && l.e === 'desistiu')).toBe(true);
    expect(resumoDoDiario().sintomas).toBeGreaterThan(0);

    estado.saude = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(casoAberto()).toBeNull();
    const desistiu = lerDiario().find((l) => l.c === 'medico' && l.e === 'desistiu');
    expect(desistiu?.ok).toBe(true); // a desistência também fica verde na alta
    expect(resumoDoDiario().sintomas).toBe(0);
  });
});

describe('o médico e o LRCLIB lotado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    zerarDiario();
    zerarSaudeDoImportador();
    zerarPortaoDoLrclib();
    desinstalarMedico();
    instalarMedico();
  });

  afterEach(() => {
    desinstalarMedico();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('registra o tratamento do portão e cura os 429 quando o LRCLIB responde de novo', async () => {
    let status = 429;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resposta(status, status === 429 ? { 'retry-after': '2' } : {})),
    );
    // O que a sonda da rede teria anotado para a rajada.
    for (let i = 0; i < 3; i++) anotar('rede', 'http', '429 GET lrclib.net/api/search');
    anotar('rede', 'http', '429 GET lrclib.net/api/get');

    await pedirAoLrclib('https://lrclib.net/api/search?track_name=x');
    const tratando = lerDiario().find((l) => l.c === 'medico' && l.e === 'tratando');
    expect(tratando?.d).toContain('LRCLIB lotado (429)');
    expect(tratando?.d).toContain('2s');
    // 'http' não é sintoma (linha neutra); a cura é o que a deixa verde.
    expect(resumoDoDiario().porSintoma).toEqual({});

    status = 200;
    await vi.advanceTimersByTimeAsync(2_000);
    await pedirAoLrclib('https://lrclib.net/api/search?track_name=y');

    const linhas = lerDiario();
    const lotadas = linhas.filter((l) => l.c === 'rede' && l.e === 'http');
    expect(lotadas).toHaveLength(2);
    expect(lotadas.every((l) => l.ok === true)).toBe(true);
    const alta = linhas.find((l) => l.c === 'medico' && l.e === 'curou');
    expect(alta?.d).toBe('LRCLIB respondeu de novo: 4 pedido(s) curado(s)');
  });
});
