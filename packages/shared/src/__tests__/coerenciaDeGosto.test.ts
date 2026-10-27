/**
 * "NÃO PODE OFERECER TRAP PARA QUEM GOSTA DE GOSPEL; NÃO PODE ERRAR."
 *
 * O teste de mesa pedido: três perfis (gospel, trap, sertanejo) diante do
 * mesmo acervo misto — nenhum recebe o gênero oposto. E as regras de borda que
 * fazem a tabela valer: sensível só aceita o comprovadamente limpo, gosto
 * fechado não recebe neutros, gosto vazio não barra nada.
 */
import { describe, expect, it } from 'vitest';
import {
  FATIA_FECHADA,
  familiasFortes,
  filtrarPeloGosto,
  podeRecomendar,
  relacaoDeFamilias,
  VIZINHANCA_DE_GOSTO,
  type FamiliaDoGosto,
} from '../ai/coerenciaDeGosto.js';
import { familiaDoGenero, type FamiliaDeGenero } from '../ai/familiasDeGenero.js';

interface Faixa {
  titulo: string;
  genero: string | null;
  conteudo?: 'limpo' | 'explicito' | 'desconhecido';
}

/** O acervo misto: um pouco de tudo, como o de verdade. */
const ACERVO: Faixa[] = [
  { titulo: 'Louvor 1', genero: 'Gospel', conteudo: 'limpo' },
  { titulo: 'Louvor 2', genero: 'Gospel', conteudo: 'desconhecido' },
  { titulo: 'Trap 1', genero: 'Trap', conteudo: 'explicito' },
  { titulo: 'Trap 2', genero: 'Trap', conteudo: 'limpo' },
  { titulo: 'Funk 1', genero: 'Funk', conteudo: 'explicito' },
  { titulo: 'Rap 1', genero: 'Hip-Hop/Rap', conteudo: 'limpo' },
  { titulo: 'Moda 1', genero: 'Sertanejo', conteudo: 'limpo' },
  { titulo: 'Forró 1', genero: 'Forró', conteudo: 'limpo' },
  { titulo: 'Pagode 1', genero: 'Pagode', conteudo: 'limpo' },
  { titulo: 'MPB 1', genero: 'MPB', conteudo: 'limpo' },
  { titulo: 'Pop 1', genero: 'Pop', conteudo: 'limpo' },
  { titulo: 'Rock 1', genero: 'Rock', conteudo: 'limpo' },
  { titulo: 'Eletrônica 1', genero: 'Eletrônica', conteudo: 'limpo' },
  { titulo: 'Sem gênero', genero: null, conteudo: 'limpo' },
];

const ler = (f: Faixa) => ({ genero: f.genero, conteudo: f.conteudo ?? null });
const generosDe = (faixas: Faixa[]) => new Set(faixas.map((f) => f.genero));

const perfil = (...partes: Array<[FamiliaDeGenero, number]>): FamiliaDoGosto[] =>
  partes.map(([familia, fatia]) => ({ familia, fatia }));

describe('teste de mesa: gospel, trap e sertanejo', () => {
  it('quem só ouve gospel não recebe trap, funk, rap nem nada que não seja limpo', () => {
    const oferecido = filtrarPeloGosto(perfil(['devocional', 1]), ACERVO, ler);
    const generos = generosDe(oferecido);
    expect(generos.has('Trap')).toBe(false);
    expect(generos.has('Funk')).toBe(false);
    expect(generos.has('Hip-Hop/Rap')).toBe(false);
    expect(generos.has(null)).toBe(false);
    // Só o louvor comprovadamente limpo: "não sei" não é "está limpo".
    expect(oferecido.map((f) => f.titulo)).toEqual(['Louvor 1']);
  });

  it('quem só ouve trap não recebe gospel nem clássica, mas recebe rap, funk e pop', () => {
    const oferecido = filtrarPeloGosto(perfil(['urbano', 0.95]), ACERVO, ler);
    const generos = generosDe(oferecido);
    expect(generos.has('Gospel')).toBe(false);
    expect(generos.has('Trap')).toBe(true);
    expect(generos.has('Funk')).toBe(true);
    expect(generos.has('Hip-Hop/Rap')).toBe(true);
    expect(generos.has('Pop')).toBe(true);
    // Gosto fechado em trap: sertanejo e MPB são neutros e ficam de fora.
    expect(generos.has('Sertanejo')).toBe(false);
    expect(generos.has('MPB')).toBe(false);
  });

  it('quem só ouve sertanejo não recebe trap, rock nem eletrônica — recebe forró, pagode e MPB', () => {
    const oferecido = filtrarPeloGosto(perfil(['sertanejo', 0.9]), ACERVO, ler);
    const generos = generosDe(oferecido);
    expect(generos.has('Trap')).toBe(false);
    expect(generos.has('Funk')).toBe(false);
    expect(generos.has('Rock')).toBe(false);
    expect(generos.has('Eletrônica')).toBe(false);
    expect(generos.has('Sertanejo')).toBe(true);
    expect(generos.has('Forró')).toBe(true);
    expect(generos.has('Pagode')).toBe(true);
    expect(generos.has('MPB')).toBe(true);
  });

  it('nenhum dos três perfis recebe o gênero oposto, em nenhuma faixa do acervo', () => {
    const opostos: Array<[FamiliaDoGosto[], string]> = [
      [perfil(['devocional', 1]), 'Trap'],
      [perfil(['urbano', 1]), 'Gospel'],
      [perfil(['sertanejo', 1]), 'Trap'],
    ];
    for (const [gosto, generoOposto] of opostos) {
      for (const faixa of ACERVO.filter((f) => f.genero === generoOposto)) {
        expect(podeRecomendar(gosto, ler(faixa))).toBe(false);
      }
    }
  });
});

describe('as regras de borda', () => {
  it('sem gosto medido, nada é barrado', () => {
    expect(filtrarPeloGosto([], ACERVO, ler)).toHaveLength(ACERVO.length);
    expect(podeRecomendar([], { genero: 'Trap', conteudo: 'explicito' })).toBe(true);
  });

  it('gosto espalhado aceita neutros; gosto fechado não', () => {
    // Sertanejo é neutro para quem ouve funk.
    expect(relacaoDeFamilias('urbano', 'sertanejo')).toBe('neutra');
    expect(podeRecomendar(perfil(['urbano', FATIA_FECHADA - 0.1], ['pop', 0.3]), { genero: 'Sertanejo' })).toBe(true);
    expect(podeRecomendar(perfil(['urbano', FATIA_FECHADA + 0.1]), { genero: 'Sertanejo' })).toBe(false);
  });

  it('quem ouve gospel E trap recebe os dois: "mesma" vale para toda família forte', () => {
    const gosto = perfil(['devocional', 0.55], ['urbano', 0.45]);
    expect(podeRecomendar(gosto, { genero: 'Gospel', conteudo: 'limpo' })).toBe(true);
    expect(podeRecomendar(gosto, { genero: 'Trap', conteudo: 'limpo' })).toBe(true);
    // Mas o topo continua sensível: trap explícito não entra.
    expect(podeRecomendar(gosto, { genero: 'Trap', conteudo: 'explicito' })).toBe(false);
  });

  it('vizinha de uma família forte passa, a menos que seja oposta do topo', () => {
    // Pop é vizinho de urbano; para quem tem rock forte também, continua ok.
    expect(podeRecomendar(perfil(['rock', 0.5], ['urbano', 0.3]), { genero: 'Pop' })).toBe(true);
    // Samba é vizinho de sertanejo, mas oposto de rock (o topo): barrado.
    expect(relacaoDeFamilias('rock', 'samba')).toBe('oposta');
    expect(podeRecomendar(perfil(['rock', 0.5], ['sertanejo', 0.3]), { genero: 'Pagode' })).toBe(false);
  });

  it('gênero desconhecido passa para quem não é sensível, e não passa para gospel', () => {
    expect(podeRecomendar(perfil(['urbano', 1]), { genero: null })).toBe(true);
    expect(podeRecomendar(perfil(['devocional', 1]), { genero: null, conteudo: 'limpo' })).toBe(false);
  });

  it('a família mais ouvida sempre conta, mesmo com gosto pulverizado', () => {
    const fortes = familiasFortes(perfil(['pop', 0.15], ['rock', 0.14], ['mpb', 0.1]));
    expect(fortes.map((f) => f.familia)).toEqual(['pop']);
  });
});

describe('a tabela', () => {
  const familias = Object.keys(VIZINHANCA_DE_GOSTO) as FamiliaDeGenero[];

  it('cobre toda família que a taxonomia conhece', () => {
    for (const genero of ['Gospel', 'Trap', 'Sertanejo', 'Pagode', 'MPB', 'Rock', 'Dance', 'Jazz', 'Reggaeton', 'K-Pop', 'Clássica', 'Lo-Fi']) {
      const familia = familiaDoGenero(genero);
      expect(familia).not.toBeNull();
      expect(VIZINHANCA_DE_GOSTO[familia!]).toBeDefined();
    }
  });

  it('nenhuma família é vizinha e oposta ao mesmo tempo, nem de si mesma', () => {
    for (const familia of familias) {
      const { vizinhas, opostas } = VIZINHANCA_DE_GOSTO[familia];
      expect(vizinhas).not.toContain(familia);
      expect(opostas).not.toContain(familia);
      for (const v of vizinhas) expect(opostas).not.toContain(v);
    }
  });

  it('devocional recusa urbano, e urbano recusa devocional: a regra do Vinicius nos dois sentidos', () => {
    expect(relacaoDeFamilias('devocional', 'urbano')).toBe('oposta');
    expect(relacaoDeFamilias('urbano', 'devocional')).toBe('oposta');
  });
});
