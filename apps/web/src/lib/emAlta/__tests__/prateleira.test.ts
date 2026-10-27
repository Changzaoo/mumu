/**
 * A prateleira "em alta" obedece a duas regras que nunca relaxam: a idade
 * (menor não vê explícito, criança só vê o limpo) e o gosto (quem ouve gospel
 * não recebe a aba de trap). E a ordem das abas é a do que a pessoa ouve.
 */
import { describe, expect, it } from 'vitest';
import type { EmAltaDto, FaixaEmAlta, FamiliaDoGosto, TrackDto } from '@radinho/shared';
import { permitidoPara, type FaixaEtaria } from '@/lib/conteudo/faixaEtaria';
import {
  ehDeForaDoAcervo,
  faixaParaTocar,
  haQuanto,
  idEmAlta,
  montarPrateleira,
  vereditosParaRegistrar,
} from '@/lib/emAlta/prateleira';
import { makeTrack } from '@/test/factories';

const faixa = (p: Partial<FaixaEmAlta> & { titulo: string }): FaixaEmAlta => ({
  chave: `${p.artista ?? 'alguem'}|${p.titulo}`.toLowerCase(),
  artista: 'Alguém',
  genero: 'Pop',
  capa: null,
  duracaoMs: 200_000,
  posicao: 1,
  nota: 1,
  fontes: ['deezer'],
  conteudo: 'limpo',
  acervoId: null,
  origem: null,
  ...p,
});

const dto: EmAltaDto = {
  atualizadoEm: '2026-10-27T18:00:00.000Z',
  generos: [
    {
      genero: 'Todos',
      faixas: [
        faixa({ titulo: 'Trap explícito', artista: 'MC X', genero: 'Trap', conteudo: 'explicito' }),
        faixa({ titulo: 'Louvor', artista: 'Preto no Branco', genero: 'Gospel', conteudo: 'limpo' }),
        faixa({ titulo: 'Moda', artista: 'Hugo', genero: 'Sertanejo', conteudo: 'desconhecido' }),
        faixa({ titulo: 'Pop limpo', artista: 'Tate', genero: 'Pop', conteudo: 'limpo', acervoId: 'local:pop' }),
      ],
    },
    { genero: 'Gospel', faixas: [faixa({ titulo: 'Louvor', artista: 'Preto no Branco', genero: 'Gospel' })] },
    { genero: 'Trap', faixas: [faixa({ titulo: 'Trap explícito', artista: 'MC X', genero: 'Trap', conteudo: 'explicito' })] },
    { genero: 'Sertanejo', faixas: [faixa({ titulo: 'Moda', artista: 'Hugo', genero: 'Sertanejo', conteudo: 'desconhecido' })] },
    { genero: 'Pop', faixas: [faixa({ titulo: 'Pop limpo', artista: 'Tate', genero: 'Pop', acervoId: 'local:pop' })] },
  ],
};

const acervo = new Map<string, TrackDto>([['local:pop', makeTrack('local:pop', { title: 'Pop limpo (acervo)' })]]);

/** A regra da idade como a prateleira a recebe: pelo veredito do próprio retrato. */
function podeOuvirComo(idade: FaixaEtaria) {
  const veredito = new Map<string, FaixaEmAlta['conteudo']>();
  for (const g of dto.generos) for (const f of g.faixas) veredito.set(idEmAlta(f.chave), f.conteudo);
  return (t: Pick<TrackDto, 'id' | 'title'>) =>
    idade === 'adulto' || permitidoPara(idade, veredito.get(t.id) ?? 'limpo');
}

const montar = (idade: FaixaEtaria, gosto: FamiliaDoGosto[] = [], afinidade = (_g: string) => 0) =>
  montarPrateleira(dto, {
    gosto,
    afinidade,
    podeOuvir: podeOuvirComo(idade),
    doAcervo: (id) => acervo.get(id) ?? null,
  });

const titulos = (p: ReturnType<typeof montar>, genero: string) =>
  p.find((g) => g.genero === genero)?.faixas.map((t) => t.title) ?? [];

describe('idade', () => {
  it('adulto vê tudo', () => {
    const p = montar('adulto');
    expect(titulos(p, 'Todos')).toHaveLength(4);
    expect(p.map((g) => g.genero)).toContain('Trap');
  });

  it('adolescente não vê o explícito; a aba de trap some com ele', () => {
    const p = montar('adolescente');
    expect(titulos(p, 'Todos')).toEqual(['Louvor', 'Moda', 'Pop limpo (acervo)']);
    expect(p.map((g) => g.genero)).not.toContain('Trap');
  });

  it('criança só vê o comprovadamente limpo: "não sei" fica de fora', () => {
    const p = montar('crianca');
    expect(titulos(p, 'Todos')).toEqual(['Louvor', 'Pop limpo (acervo)']);
    expect(p.map((g) => g.genero)).not.toContain('Sertanejo');
  });
});

describe('gosto', () => {
  it('quem ouve gospel não recebe a aba de trap nem o trap no "Todos"', () => {
    const p = montar('adulto', [{ familia: 'devocional', fatia: 1 }], (g) => (g === 'Gospel' ? 1 : 0));
    expect(p.map((g) => g.genero)).toEqual(['Gospel', 'Todos']);
    expect(titulos(p, 'Todos')).toEqual(['Louvor']);
  });

  it('a aba do gênero mais ouvido vem primeiro, depois a parada geral', () => {
    const p = montar('adulto', [{ familia: 'sertanejo', fatia: 0.5 }, { familia: 'pop', fatia: 0.5 }], (g) =>
      g === 'Sertanejo' ? 2 : g === 'Pop' ? 1 : 0,
    );
    expect(p.map((g) => g.genero)).toEqual(['Sertanejo', 'Pop', 'Todos', 'Gospel']);
  });

  it('sem gosto, a parada geral abre a prateleira', () => {
    expect(montar('adulto')[0]?.genero).toBe('Todos');
  });
});

describe('faixas', () => {
  it('a do acervo é a do acervo; a de fora ganha id estável e origem', () => {
    const doAcervo = faixaParaTocar(faixa({ titulo: 'x', acervoId: 'local:pop' }), (id) => acervo.get(id) ?? null);
    expect(doAcervo.id).toBe('local:pop');
    const deFora = faixaParaTocar(
      faixa({ titulo: 'Y', artista: 'Z', genero: 'Funk', conteudo: 'explicito', origem: 'https://www.youtube.com/watch?v=abcdefghijk' }),
      () => null,
    );
    expect(ehDeForaDoAcervo(deFora)).toBe(true);
    expect(deFora).toMatchObject({ id: 'em-alta:z|y', title: 'Y', explicit: true, genre: 'Funk', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', streamUrl: null });
    expect(deFora.artists[0]?.name).toBe('Z');
  });

  it('registra o veredito só das faixas de fora do acervo, uma vez cada', () => {
    const v = vereditosParaRegistrar(dto);
    expect(v.map(([id]) => id).sort()).toEqual(['em-alta:hugo|moda', 'em-alta:mc x|trap explícito', 'em-alta:preto no branco|louvor']);
    expect(v.find(([id]) => id === 'em-alta:mc x|trap explícito')?.[1]).toBe('explicito');
  });

  it('"atualizado há"', () => {
    const agora = Date.parse('2026-10-27T19:00:00.000Z');
    expect(haQuanto('2026-10-27T18:48:00.000Z', agora)).toBe('há 12 min');
    expect(haQuanto('2026-10-27T15:00:00.000Z', agora)).toBe('há 4 h');
    expect(haQuanto('2026-10-27T19:00:10.000Z', agora)).toBe('agora');
  });
});
