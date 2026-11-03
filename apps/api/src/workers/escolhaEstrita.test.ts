/**
 * ESCOLHA ESTRITA — tabela de cenários (packages/shared/src/ai/__tests__/
 * fixtures/escolhaDoVideo.json), a MESMA que testa o espelho do importador.
 * O esperado de cada cenário é o índice do vídeo certo inserido na construção
 * (ou null), nunca a saída do código. Se um cenário falha, a regra é que erra.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  escolherVideoEstrito,
  musicaDoArtista,
  normalizar,
  palavrasLimpas,
  type Candidato,
  type PedidoDeFaixa,
} from './escolhaEstrita.js';

interface Cenario {
  id: string;
  grupo: string;
  pedido: PedidoDeFaixa;
  resultados: Candidato[];
  esperado: number | null;
}

const cenarios = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/src/ai/__tests__/fixtures/escolhaDoVideo.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Cenario[];

describe('escolherVideoEstrito — corpus', () => {
  it('tem volume suficiente', () => {
    expect(cenarios.length).toBeGreaterThanOrEqual(150);
  });

  it.each(cenarios.map((c) => [`${c.id} ${c.grupo}`, c] as const))('%s', (_n, c) => {
    const d = escolherVideoEstrito(c.pedido, c.resultados);
    const indice = d.escolhido ? c.resultados.indexOf(d.escolhido) : null;
    if (indice !== c.esperado) {
      throw new Error(
        `esperado ${String(c.esperado)} e veio ${String(indice)} (${d.motivo}) — ` +
          c.resultados
            .map((r, i) => `#${i} "${r.titulo}" [${r.canal}] ${r.duracaoSeg}s`)
            .join(' | '),
      );
    }
  });
});

describe('escolherVideoEstrito — contrato', () => {
  it('empate/dúvida devolve null COM o motivo, nunca palpite', () => {
    const d = escolherVideoEstrito({ artistas: ['Anitta'], titulo: 'Envolver' }, [
      { url: 'a', titulo: 'Anitta - Envolver', canal: 'A', duracaoSeg: 190 },
      { url: 'b', titulo: 'Anitta - Envolver (Lyrics)', canal: 'B', duracaoSeg: 270 },
    ]);
    expect(d.escolhido).toBeNull();
    expect(d.motivo).toMatch(/empate/);
  });

  it('"Ana" não casa "Mariana" nem "Ana Castela"', () => {
    const rs = [
      { url: 'a', titulo: 'Mariana - Pipoco', canal: 'Mariana', duracaoSeg: 171 },
      { url: 'b', titulo: 'Ana Castela - Pipoco', canal: 'Ana Castela', duracaoSeg: 171 },
    ];
    expect(
      escolherVideoEstrito({ artistas: ['Ana'], titulo: 'Pipoco', duracaoSeg: 171 }, rs).escolhido,
    ).toBeNull();
  });

  it('normalização: sem acento, sem caixa', () => {
    expect(normalizar('  Chitãozinho & XORORÓ!! ')).toBe('chitaozinho xororo');
    expect(palavrasLimpas('Matuê - Anos Luz (Clipe Oficial) #shorts 4K')).toEqual([
      'matue',
      'anos',
      'luz',
    ]);
  });
});

describe('musicaDoArtista (modo pesquisador)', () => {
  const v = (titulo: string, canal: string, duracaoSeg = 200): Candidato => ({
    url: 'u',
    titulo,
    canal,
    duracaoSeg,
  });

  it('aceita "Artista - Música" e devolve o pedaço da música', () => {
    expect(
      musicaDoArtista('Matuê', v('Matuê - Anos Luz (Clipe Oficial)', '30PRAUM'))?.tituloBruto,
    ).toBe('Anos Luz');
  });
  it('aceita só o título no canal Topic do artista', () => {
    expect(musicaDoArtista('Matuê', v('Anos Luz', 'Matuê - Topic'))?.tituloBruto).toBe('Anos Luz');
  });
  it('rejeita outro artista que contém o nome', () => {
    expect(musicaDoArtista('Ana', v('Ana Castela - Pipoco', 'Ana Castela'))).toBeNull();
    expect(musicaDoArtista('Ana', v('Mariana - Pipoco', 'Mariana'))).toBeNull();
  });
  it('rejeita versões alteradas e duração de mix', () => {
    expect(musicaDoArtista('Matuê', v('Matuê - Anos Luz (slowed)', 'Matuê'))).toBeNull();
    expect(musicaDoArtista('Matuê', v('Matuê - Anos Luz (Ao Vivo)', 'Matuê'))).toBeNull();
    expect(musicaDoArtista('Matuê', v('Matuê - Anos Luz', 'Matuê', 3600))).toBeNull();
  });
  it('rejeita título em que o artista só é citado (cover, reação)', () => {
    expect(
      musicaDoArtista('Matuê', v('Reagindo a Matuê - Anos Luz', 'Canal do Reator')),
    ).toBeNull();
    expect(musicaDoArtista('Matuê', v('Pedro - Anos Luz (cover Matuê)', 'Pedro'))).toBeNull();
  });
  it('rejeita o canal que não é o artista quando o título não diz quem canta', () => {
    expect(musicaDoArtista('Matuê', v('Anos Luz', 'Letras e Músicas'))).toBeNull();
  });
});

describe('espelho do importador', () => {
  it('apps/importer/escolhaEstrita.mjs e a transpilacao EXATA deste arquivo (regenere se falhar)', () => {
    const fonte = readFileSync(new URL('./escolhaEstrita.ts', import.meta.url), 'utf8');
    const quebra = new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g');
    const espelho = readFileSync(
      new URL('../../../importer/escolhaEstrita.mjs', import.meta.url),
      'utf8',
    ).replace(quebra, String.fromCharCode(10));
    const gerado = ts
      .transpileModule(fonte, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          removeComments: false,
        },
      })
      .outputText.replace(quebra, String.fromCharCode(10));
    expect(espelho.endsWith(gerado)).toBe(true);
    expect(espelho.startsWith('// ESPELHO GERADO')).toBe(true);
  });
});
