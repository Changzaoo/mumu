/**
 * A POLÍTICA DE ALÇAS DE ÁUDIO — o conserto das "17 alças / 128 MB" do aparelho real.
 *
 * Moto G34 (4 GB), 18 min, 10 plays: a sonda marcou 17 alças de áudio vivas.
 * Nada vazava; o teto de 128 MB é que era o "normal" (17 × 7,5 MB). Aqui um
 * motor de mentira (dois slots + a faixa saindo no fade) diz quais URLs estão em
 * uso, e a política tem que manter vivas só elas + o teto de 3.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const alcas = { abertas: new Set<string>(), criadas: 0 };
const blobDe = (bytes: number): Blob => ({ size: bytes, type: 'audio/mpeg' }) as Blob;
const MB = 7_500_000;

type Lib = typeof import('@/lib/perf/alcasDeBlob');

/** Motor de mentira: o que os slots seguram. */
function criarMotor(lib: Lib) {
  const slots = {
    ativo: null as string | null,
    ocioso: null as string | null,
    saindo: null as string | null,
  };
  lib.definirEmUso('audio', () =>
    [slots.ativo, slots.ocioso, slots.saindo].filter((u): u is string => !!u),
  );
  /** Fonte da faixa: 'cofre' toca por rede (sem alça); as outras abrem alça. */
  const abrirFaixa = (id: string, fonte: 'local' | 'baixada' | 'cofre'): string | null => {
    if (fonte === 'cofre') return null;
    return lib.consultar('audio', id) ?? lib.abrir('audio', id, blobDe(MB));
  };
  return {
    slots,
    abrirFaixa,
    /** Toca `id`, com a pré-carga de `proxima` (a partir de 5 s) e crossfade. */
    tocar(
      id: string,
      fonte: 'local' | 'baixada' | 'cofre',
      proxima?: [string, 'local' | 'baixada' | 'cofre'],
    ) {
      const url = abrirFaixa(id, fonte);
      slots.saindo = slots.ativo;
      slots.ativo = url;
      slots.ocioso = null;
      if (proxima) slots.ocioso = abrirFaixa(proxima[0], proxima[1]);
    },
    fimDoFade() {
      slots.saindo = null;
    },
  };
}

beforeEach(async () => {
  alcas.abertas.clear();
  alcas.criadas = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:fake/${alcas.criadas++}`;
      alcas.abertas.add(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      alcas.abertas.delete(url);
    },
  });
  vi.resetModules();
});

const fontes = ['local', 'baixada', 'cofre'] as const;

describe('política de alças de áudio', () => {
  it('12 faixas em ordem (local/baixada/cofre): nunca passa do teto de 3', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    let maximo = 0;
    for (let i = 0; i < 12; i++) {
      motor.tocar(`f${i}`, fontes[i % 3] ?? 'local', [`f${i + 1}`, fontes[(i + 1) % 3] ?? 'local']);
      maximo = Math.max(maximo, alcas.abertas.size);
      motor.fimDoFade();
      lib.aparar('audio', Date.now() + 60_000);
    }
    expect(maximo).toBeLessThanOrEqual(3);
    const r = lib.relatorio().audio;
    expect(r.picoAlcas).toBeLessThanOrEqual(3);
    // A conta da sonda é a real: criadas − revogadas = vivas no mock da URL.
    expect(r.criadas - r.revogadas).toBe(alcas.abertas.size);
    expect(r.alcas).toBe(alcas.abertas.size);
  });

  it('pulos rápidos: a pré-carga descartada é solta e nada passa do teto', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    for (let i = 0; i < 30; i++) {
      // pula antes do fade acabar, cada faixa já com sua "próxima" preparada
      motor.tocar(`p${i}`, 'local', [`p${i + 1}`, 'baixada']);
    }
    expect(alcas.abertas.size).toBeLessThanOrEqual(3);
    // pré-carga que mudou (fila mexida): a antiga não fica presa
    motor.slots.ocioso = null;
    motor.fimDoFade();
    lib.aparar('audio', Date.now() + 60_000);
    expect(alcas.abertas.size).toBe(1); // só a atual
  });

  it('nada em uso é revogado: ativa, pré-carregada e a que sai em fade', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    motor.tocar('a', 'local', ['b', 'local']);
    motor.tocar('b', 'local', ['c', 'local']); // 'a' sai em fade
    // enxurrada de aberturas alheias tentando despejar
    for (let i = 0; i < 20; i++) lib.abrir('audio', `x${i}`, blobDe(MB));
    lib.aparar('audio', Date.now() + 60_000);
    for (const u of [motor.slots.ativo, motor.slots.ocioso, motor.slots.saindo]) {
      expect(alcas.abertas.has(u as string)).toBe(true);
    }
    expect(alcas.abertas.size).toBe(3);
  });

  it('troca de fila solta tudo que não é atual (respeitando a graça de uma alça recém-aberta)', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    motor.tocar('a', 'local', ['b', 'local']);
    motor.fimDoFade();
    lib.abrir('audio', 'velha', blobDe(MB));
    motor.slots.ocioso = null; // fila trocada: a pré-carga caiu
    lib.aparar('audio'); // agora: a graça poupa as recém-abertas
    expect(lib.consultar('audio', 'velha')).not.toBeNull();
    lib.aparar('audio', Date.now() + 60_000); // passada a graça
    expect(alcas.abertas.size).toBe(1);
    expect(alcas.abertas.has(motor.slots.ativo as string)).toBe(true);
  });

  it('reabrir faixa antiga recria a alça e toca', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    for (let i = 0; i < 6; i++) {
      motor.tocar(`f${i}`, 'local');
      motor.fimDoFade();
      lib.aparar('audio', Date.now() + 60_000);
    }
    expect(lib.consultar('audio', 'f0')).toBeNull(); // foi solta
    const antes = alcas.criadas;
    motor.tocar('f0', 'local'); // "voltar" a uma faixa velha
    expect(alcas.criadas).toBe(antes + 1);
    expect(alcas.abertas.has(motor.slots.ativo as string)).toBe(true);
  });

  it('o pico da sessão fica registrado para a sonda', async () => {
    const lib = await import('@/lib/perf/alcasDeBlob');
    const motor = criarMotor(lib);
    for (let i = 0; i < 12; i++) motor.tocar(`f${i}`, 'local', [`f${i + 1}`, 'local']);
    const r = lib.relatorio().audio;
    expect(r.picoAlcas).toBeGreaterThanOrEqual(2);
    expect(r.picoBytes).toBeGreaterThanOrEqual(2 * MB);
    expect(r.picoBytes).toBeLessThanOrEqual(3 * MB);
  });
});
