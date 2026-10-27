/**
 * Idade × conteúdo: o que cada faixa etária pode ouvir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const biblioteca = vi.hoisted(() => new Map<string, { conteudoVeredicto?: string }>());
vi.mock('@/lib/local/localLibrary', () => ({
  entryFor: (id: string) => biblioteca.get(id) ?? null,
}));

import {
  ehExplicita,
  faixaEtariaDe,
  permitidoPara,
  podeOuvir,
  podeTrocarPara,
  registrarLetra,
  registrarVereditos,
} from '@/lib/conteudo/faixaEtaria';
import { useSettingsStore } from '@/stores/settingsStore';

const hoje = new Date(2026, 8, 28); // 28/09/2026
const faixa = (id: string, title = 'Música') => ({ id, title });

beforeEach(() => {
  biblioteca.clear();
  useSettingsStore.setState({ dataNascimento: null });
});

describe('faixa etária', () => {
  it('pelo mês e ano de nascimento', () => {
    expect(faixaEtariaDe('2016-01', hoje)).toBe('crianca');
    expect(faixaEtariaDe('2013-10', hoje)).toBe('crianca'); // faz 13 só em outubro
    expect(faixaEtariaDe('2013-09', hoje)).toBe('adolescente');
    expect(faixaEtariaDe('2008-09', hoje)).toBe('adulto');
    expect(faixaEtariaDe(null, hoje)).toBe('desconhecida');
    expect(faixaEtariaDe('lixo', hoje)).toBe('desconhecida');
  });

  it('a regra: criança só o limpo; adolescente e desconhecida nada explícito', () => {
    expect(permitidoPara('crianca', 'limpo')).toBe(true);
    expect(permitidoPara('crianca', 'desconhecido')).toBe(false);
    expect(permitidoPara('adolescente', 'desconhecido')).toBe(true);
    expect(permitidoPara('adolescente', 'explicito')).toBe(false);
    expect(permitidoPara('desconhecida', 'explicito')).toBe(false);
    expect(permitidoPara('adulto', 'explicito')).toBe(true);
  });

  it('menor não "envelhece" sozinho; ficar mais novo sempre pode', () => {
    expect(podeTrocarPara('2016-01', '1990-01')).toBe(false);
    expect(podeTrocarPara('2016-01', '2018-01')).toBe(true);
    expect(podeTrocarPara('1990-01', '2016-01')).toBe(true);
    expect(podeTrocarPara(null, '1990-01')).toBe(true);
  });
});

describe('podeOuvir', () => {
  it('criança: o veredito do servidor manda; desconhecido fica de fora', () => {
    useSettingsStore.setState({ dataNascimento: '2016-01' });
    biblioteca.set('a', { conteudoVeredicto: 'limpo' });
    biblioteca.set('b', { conteudoVeredicto: 'explicito' });
    expect(podeOuvir(faixa('a'))).toBe(true);
    expect(podeOuvir(faixa('b'))).toBe(false);
    expect(podeOuvir(faixa('c'))).toBe(false);
  });

  it('título com palavrão já condena, mesmo sem veredito', () => {
    useSettingsStore.setState({ dataNascimento: '2010-01' });
    expect(podeOuvir(faixa('x', 'Foda-se o mundo'))).toBe(false);
    expect(podeOuvir(faixa('y', 'Dynamite'))).toBe(true);
  });

  it('a letra explícita descoberta no aparelho vale na hora (inclusive K-pop)', () => {
    useSettingsStore.setState({ dataNascimento: '2010-01' });
    expect(podeOuvir(faixa('k'))).toBe(true);
    registrarLetra('k', '', '이 씨발 세상');
    expect(podeOuvir(faixa('k'))).toBe(false);
  });

  it('adulto ouve tudo', () => {
    useSettingsStore.setState({ dataNascimento: '1990-05' });
    biblioteca.set('b', { conteudoVeredicto: 'explicito' });
    expect(podeOuvir(faixa('b'))).toBe(true);
  });
});

describe('ehExplicita — o selo "E"', () => {
  it('vem do veredito do servidor na entrada da biblioteca, não de track.explicit', () => {
    // A listagem do acervo remove `track.explicit`; o que chega é `conteudoVeredicto`.
    biblioteca.set('b', { conteudoVeredicto: 'explicito' });
    biblioteca.set('a', { conteudoVeredicto: 'limpo' });
    expect(ehExplicita({ ...faixa('b'), explicit: false })).toBe(true);
    expect(ehExplicita({ ...faixa('a'), explicit: false })).toBe(false);
    expect(ehExplicita(faixa('sem-veredito'))).toBe(false);
  });

  it('track.explicit true continua valendo (fonte que afirma)', () => {
    expect(ehExplicita({ ...faixa('apple'), explicit: true })).toBe(true);
  });

  it('a letra julgada no aparelho acende o selo na hora', () => {
    registrarLetra('l', 'Música', 'olha essa porra toda');
    expect(ehExplicita(faixa('l'))).toBe(true);
  });
});

describe('registrarVereditos (faixas de fora do acervo, como as do "em alta")', () => {
  it('o veredito do servidor vale para quem tem restrição; desconhecido apaga', () => {
    useSettingsStore.setState({ dataNascimento: '2016-01' }); // criança
    registrarVereditos([
      ['em-alta:a', 'limpo'],
      ['em-alta:b', 'explicito'],
      ['em-alta:c', 'desconhecido'],
    ]);
    expect(podeOuvir(faixa('em-alta:a'))).toBe(true);
    expect(podeOuvir(faixa('em-alta:b'))).toBe(false);
    expect(podeOuvir(faixa('em-alta:c'))).toBe(false);
    useSettingsStore.setState({ dataNascimento: '2010-01' }); // adolescente
    expect(podeOuvir(faixa('em-alta:b'))).toBe(false);
    expect(podeOuvir(faixa('em-alta:c'))).toBe(true);
    registrarVereditos([['em-alta:b', 'desconhecido']]);
    expect(podeOuvir(faixa('em-alta:b'))).toBe(true);
  });

  it('a letra julgada aqui e a entrada da biblioteca valem mais que o registro', () => {
    useSettingsStore.setState({ dataNascimento: '2016-01' });
    registrarVereditos([['x', 'limpo']]);
    biblioteca.set('x', { conteudoVeredicto: 'explicito' });
    expect(podeOuvir(faixa('x'))).toBe(false);
    registrarVereditos([['y', 'explicito']]);
    registrarLetra('y', 'Música', 'Deus é bom o tempo todo, o tempo todo Deus é bom');
    expect(podeOuvir(faixa('y'))).toBe(true);
  });
});
