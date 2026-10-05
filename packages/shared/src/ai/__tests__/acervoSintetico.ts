/**
 * Acervo sintético determinístico para os testes de caracterização e de escala
 * de `revisarGeneros`. Não é teste (não termina em .test.ts): é só o gerador,
 * compartilhado para os dois arquivos olharem exatamente o mesmo tipo de dado.
 *
 * O objetivo é ser SUJO como o acervo real: o mesmo artista com grafias,
 * acentos e caixa diferentes, feats, faixas sem gênero, rótulos que não são
 * gênero, selos com variações e muitos empates de contagem.
 */
import type { FaixaMinima } from '../generoCoerencia.js';

/** PRNG pequeno (mulberry32): mesma semente, mesma sequência, em qualquer máquina. */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASES = [
  'Anderson Freire',
  'Sarah Farias',
  'Gabriela Rocha',
  'Preto no Branco',
  'Alee',
  'Brandão85',
  'João Gomes',
  'Zé Neto',
  'Ludmilla',
  'Matuê',
  'MC Kevin',
  'Midian Lima',
  'Mariana Aydar',
  'Émile',
];

const GENEROS = [
  'Pop',
  'Hip-Hop/Rap',
  'Trap',
  'Funk',
  'Sertanejo',
  'MPB',
  'Pagode',
  'Gospel',
  'Forró',
  'Rock',
  'Lo-Fi',
  'Eletrônica',
  'Indie',
];

/** Rótulos crus que o sistema antigo gravou: alguns traduzem, outros são balde. */
const CRUS = [
  'sertaneja',
  'eletronica',
  'Brasileira',
  'gospel',
  'Hip Hop',
  'Música',
  '  Pop  ',
  'xyz',
];

const SELOS = [
  'MK Music',
  'mk  music',
  'MK MUSIC!',
  'Universal',
  'Som Livre',
  'Kondzilla',
  'Graça Music',
  'Selo Raro',
];

/** Variações de grafia da MESMA chave de artista. */
function variante(nome: string, r: () => number): string {
  const v = Math.floor(r() * 6);
  if (v === 0) return nome.toUpperCase();
  if (v === 1) return nome.toLowerCase();
  if (v === 2) return nome.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (v === 3) return `  ${nome}  `;
  if (v === 4) return nome.replace(/ /g, '  ');
  return nome;
}

export function acervoSintetico(
  semente: number,
  faixas: number,
  artistas: number,
  /**
   * Selo correlacionado ao gênero de casa do artista (selo especializado). Sem
   * isto os selos são sorteio puro e nenhum forma maioria — a 4ª passada nunca
   * dispara. Opcional para não mudar o acervo que a saída congelada mediu.
   */
  seloEspecializado = false,
): FaixaMinima[] {
  const r = prng(semente);
  const nomes: string[] = [];
  for (let i = 0; i < artistas; i++) {
    nomes.push(i < BASES.length ? BASES[i]! : `Artista ${i} ${String.fromCharCode(97 + (i % 26))}`);
  }
  // Cada artista tem um gênero "de casa" e um ruído: gera maiorias, empates e
  // discografias espalhadas — as três situações em que as passadas decidem.
  const casa = nomes.map(() => GENEROS[Math.floor(r() * GENEROS.length)]!);
  const out: FaixaMinima[] = [];
  for (let i = 0; i < faixas; i++) {
    // Distribuição torta: poucos artistas com muita faixa.
    const a = Math.min(artistas - 1, Math.floor(Math.pow(r(), 1.6) * artistas));
    const principal = variante(nomes[a]!, r);
    const lista = [principal];
    if (r() < 0.25) lista.push(variante(nomes[Math.floor(r() * artistas)]!, r)); // feat
    if (r() < 0.05) lista.push(variante(nomes[a]!, r)); // mesmo artista duas vezes
    if (r() < 0.02) lista.push(''); // crédito vazio
    const sorteio = r();
    let genre: string | null;
    if (sorteio < 0.12) genre = null;
    else if (sorteio < 0.16) genre = '';
    else if (sorteio < 0.24) genre = CRUS[Math.floor(r() * CRUS.length)]!;
    else if (sorteio < 0.7) genre = casa[a]!;
    else genre = GENEROS[Math.floor(r() * GENEROS.length)]!;
    const faixa: FaixaMinima = {
      id: `t${i % 97 === 0 && i > 0 ? i - 1 : i}`,
      genre,
      artistas: lista,
    };
    const l = r();
    if (l < 0.5) {
      faixa.label = SELOS[Math.floor(r() * SELOS.length)]!;
      if (seloEspecializado && r() < 0.85) {
        faixa.label = SELOS[GENEROS.indexOf(casa[a]!) % SELOS.length]!;
      }
    } else if (l < 0.55) faixa.label = '  ';
    else if (l < 0.6) faixa.label = null;
    out.push(faixa);
  }
  return out;
}
