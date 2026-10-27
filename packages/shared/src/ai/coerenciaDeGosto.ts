/**
 * O QUE PODE SER OFERECIDO A QUEM GOSTA DO QUÊ.
 *
 * `familiasDeGenero.podemConviver` responde "esta faixa pode tocar DEPOIS
 * daquela?" — uma pergunta sobre a fila. Esta é outra: "esta faixa pode ser
 * OFERECIDA a esta pessoa?" — uma pergunta sobre o gosto. A regra do Vinicius
 * (27/10/2026): "não pode oferecer trap para quem gosta de gospel; não pode
 * errar". Então a coerência é um FILTRO DURO, aplicado antes de qualquer
 * ranking, e a tabela que o define está aqui, explícita e testável — não
 * espalhada em pesos.
 *
 * ── A TABELA ──
 *
 * Para cada família, quais são VIZINHAS (ninguém estranha a mistura) e quais
 * são OPOSTAS (a mistura é erro). O que não está em nenhuma lista é NEUTRO.
 * A tabela é DIRECIONAL de propósito: "quem gosta de A aceita B" não implica
 * "quem gosta de B aceita A" — quem ouve funk aceita pop; quem ouve só clássica
 * não aceita funk.
 *
 * ── A REGRA ──
 *
 * O gosto chega como famílias com a FATIA de cada uma (ver `perfilDeGosto`).
 * As que têm fatia ≥ `FATIA_FORTE` são as famílias da pessoa; a maior é a
 * família-topo. Uma candidata passa quando:
 *
 *   1. é de uma família forte da pessoa ("mesma"); ou
 *   2. é vizinha de uma família forte e NÃO é oposta da família-topo; ou
 *   3. é neutra, e o gosto é ESPALHADO (a família-topo tem menos de
 *      `FATIA_FECHADA`). Quem ouve 90% de uma coisa só não recebe "neutros":
 *      não dá para errar oferecendo MPB a quem só ouve trap, mas também não há
 *      por que arriscar.
 *
 * E as duas exceções que valem mais que a tabela:
 *
 *   • FAMÍLIA-TOPO SENSÍVEL (devocional): só "mesma" e "vizinha" passam, e a
 *     candidata precisa ter conteúdo COMPROVADAMENTE limpo. É a mesma
 *     assimetria de `podemConviver`: ali, receber funk explícito num rádio de
 *     louvor é a perda da pessoa; aqui também.
 *   • GÊNERO DESCONHECIDO na candidata: passa só quando a família-topo não é
 *     sensível. "Não sei o que é" não é "combina".
 *
 * Sem gosto medido (lista vazia), não há fronteira a defender: tudo passa. O
 * filtro protege quem já mostrou do que gosta; quem acabou de chegar vê o
 * acervo e escolhe.
 */
import type { VeredictoDeConteudo } from './conteudoExplicito.js';
import { ehFamiliaSensivel, familiaDoGenero, type FamiliaDeGenero } from './familiasDeGenero.js';

export type RelacaoDeFamilias = 'mesma' | 'vizinha' | 'oposta' | 'neutra';

interface Vizinhanca {
  vizinhas: readonly FamiliaDeGenero[];
  opostas: readonly FamiliaDeGenero[];
}

/**
 * Quem gosta da família da LINHA aceita as `vizinhas` e recusa as `opostas`.
 * Toda família está aqui de propósito: faltar uma seria tratá-la como neutra
 * para todo mundo sem ninguém ter decidido isso.
 */
export const VIZINHANCA_DE_GOSTO: Readonly<Record<FamiliaDeGenero, Vizinhanca>> = {
  devocional: {
    vizinhas: [],
    opostas: ['urbano', 'eletronica', 'latino', 'rock', 'samba', 'soul', 'pop'],
  },
  urbano: {
    vizinhas: ['pop', 'soul', 'latino', 'eletronica'],
    opostas: ['devocional', 'classica', 'ambiente'],
  },
  sertanejo: {
    vizinhas: ['samba', 'mpb', 'pop', 'latino'],
    opostas: ['urbano', 'rock', 'eletronica', 'classica'],
  },
  samba: {
    vizinhas: ['mpb', 'sertanejo', 'pop', 'latino'],
    opostas: ['rock', 'eletronica', 'classica'],
  },
  mpb: {
    vizinhas: ['samba', 'soul', 'pop', 'sertanejo', 'latino', 'classica'],
    opostas: ['urbano', 'eletronica'],
  },
  rock: {
    vizinhas: ['pop', 'soul', 'eletronica'],
    opostas: ['sertanejo', 'samba', 'urbano'],
  },
  eletronica: {
    vizinhas: ['pop', 'urbano', 'latino', 'ambiente'],
    opostas: ['sertanejo', 'samba', 'devocional', 'classica'],
  },
  soul: {
    vizinhas: ['urbano', 'pop', 'mpb', 'rock'],
    opostas: ['sertanejo', 'devocional'],
  },
  latino: {
    vizinhas: ['pop', 'urbano', 'eletronica', 'samba'],
    opostas: ['classica', 'devocional', 'rock'],
  },
  pop: {
    vizinhas: ['eletronica', 'latino', 'soul', 'rock'],
    opostas: ['devocional', 'classica'],
  },
  classica: {
    vizinhas: ['ambiente', 'mpb'],
    opostas: ['urbano', 'eletronica', 'sertanejo', 'samba', 'latino'],
  },
  ambiente: {
    vizinhas: ['classica', 'eletronica', 'soul'],
    opostas: ['urbano', 'sertanejo', 'samba'],
  },
};

/** Fatia a partir da qual uma família é "da pessoa". */
export const FATIA_FORTE = 0.2;
/** Família-topo acima disto = gosto fechado: neutros ficam de fora. */
export const FATIA_FECHADA = 0.6;

/** Para quem gosta de `gosto`, o que é `candidata`? */
export function relacaoDeFamilias(
  gosto: FamiliaDeGenero,
  candidata: FamiliaDeGenero,
): RelacaoDeFamilias {
  if (gosto === candidata) return 'mesma';
  const v = VIZINHANCA_DE_GOSTO[gosto];
  if (v.opostas.includes(candidata)) return 'oposta';
  if (v.vizinhas.includes(candidata)) return 'vizinha';
  return 'neutra';
}

export interface FamiliaDoGosto {
  familia: FamiliaDeGenero;
  /** Fatia desta família na afinidade total, em [0,1]. */
  fatia: number;
}

export interface CandidataAoGosto {
  genero?: string | null;
  /** Veredito de conteúdo. Ausente = desconhecido. */
  conteudo?: VeredictoDeConteudo | null;
}

/** As famílias fortes, da maior para a menor. Vazio = sem gosto medido. */
export function familiasFortes(gosto: readonly FamiliaDoGosto[]): FamiliaDoGosto[] {
  const ordenado = [...gosto].filter((g) => g.fatia > 0).sort((a, b) => b.fatia - a.fatia);
  if (ordenado.length === 0) return [];
  // A maior sempre conta, mesmo abaixo do limiar: alguém com dez gêneros
  // iguais tem um gosto espalhado, não um gosto inexistente.
  const fortes = ordenado.filter((g) => g.fatia >= FATIA_FORTE);
  return fortes.length > 0 ? fortes : [ordenado[0]!];
}

/**
 * ESTA FAIXA PODE SER OFERECIDA A QUEM TEM ESTE GOSTO?
 *
 * Função pura e a única porta: toda prateleira de recomendação passa por aqui
 * antes de ranquear. Ver a regra no cabeçalho.
 */
export function podeRecomendar(
  gosto: readonly FamiliaDoGosto[],
  candidata: CandidataAoGosto,
): boolean {
  const fortes = familiasFortes(gosto);
  if (fortes.length === 0) return true;
  const topo = fortes[0]!;
  const sensivel = ehFamiliaSensivel(topo.familia);
  const familia = familiaDoGenero(candidata.genero);

  if (familia === null) return !sensivel;
  if (sensivel && candidata.conteudo !== 'limpo') return false;

  if (fortes.some((f) => f.familia === familia)) return true;
  if (relacaoDeFamilias(topo.familia, familia) === 'oposta') return false;
  if (fortes.some((f) => relacaoDeFamilias(f.familia, familia) === 'vizinha')) return true;
  if (sensivel) return false;
  return topo.fatia < FATIA_FECHADA;
}

/** Só as candidatas que passam em `podeRecomendar`. */
export function filtrarPeloGosto<T>(
  gosto: readonly FamiliaDoGosto[],
  candidatas: readonly T[],
  lerCandidata: (item: T) => CandidataAoGosto,
): T[] {
  if (familiasFortes(gosto).length === 0) return [...candidatas];
  return candidatas.filter((c) => podeRecomendar(gosto, lerCandidata(c)));
}
