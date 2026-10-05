/**
 * CÓPIA CONGELADA da implementação O(N²) de `revisarGeneros` (e das duas
 * apurações que ela chamava por faixa), de antes do índice. Serve de gabarito:
 * a versão rápida tem que devolver EXATAMENTE a mesma lista, na mesma ordem.
 * Não "conserte" nada aqui — o valor deste arquivo é ser o comportamento antigo.
 */
import { GENRE_TAXONOMY, type Genre } from '../curation.js';
import { normalizarGenero } from '../generos.js';
import type {
  FaixaMinima,
  MotivoDaRevisao,
  RevisaoDeGenero,
  VotoDoArtista,
} from '../generoCoerencia.js';

const VAZIO: VotoDoArtista = { dominante: null, votos: 0, total: 0 };
const MIN_VOTOS_VETAR = 3;
const GENEROS_DO_ARTISTA = new Set<Genre>(['Gospel']);
const MIN_VOTOS_ARTISTA = 2;
const MIN_FATIA_VETAR = 0.75;
const MIN_VOTOS_SELO = 4;
const MIN_FATIA_SELO = 0.66;

function chaveArtista(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TAXONOMIA = new Set<string>(GENRE_TAXONOMY);

function generoValido(faixa: FaixaMinima): Genre | null {
  const g = faixa.genre?.trim();
  if (!g) return null;
  return TAXONOMIA.has(g) ? (g as Genre) : null;
}

export function generoDoArtistaLegado(
  faixas: readonly FaixaMinima[],
  artista: string,
  exceto?: string,
): VotoDoArtista {
  const alvo = chaveArtista(artista);
  if (!alvo) return VAZIO;
  const contagem = new Map<Genre, number>();
  let total = 0;
  for (const faixa of faixas) {
    if (faixa.id === exceto) continue;
    if (!faixa.artistas.some((a) => chaveArtista(a) === alvo)) continue;
    const g = generoValido(faixa);
    if (!g) continue;
    contagem.set(g, (contagem.get(g) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return VAZIO;
  let dominante: Genre | null = null;
  let votos = 0;
  for (const [g, n] of contagem) {
    if (n > votos) {
      dominante = g;
      votos = n;
    }
  }
  return { dominante, votos, total };
}

export function generoDoSeloLegado(
  faixas: readonly FaixaMinima[],
  label: string,
  exceto?: string,
): VotoDoArtista {
  const alvo = chaveArtista(label);
  if (!alvo) return VAZIO;
  const contagem = new Map<Genre, number>();
  let total = 0;
  for (const faixa of faixas) {
    if (faixa.id === exceto) continue;
    if (!faixa.label || chaveArtista(faixa.label) !== alvo) continue;
    const g = generoValido(faixa);
    if (!g) continue;
    contagem.set(g, (contagem.get(g) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return VAZIO;
  let dominante: Genre | null = null;
  let votos = 0;
  for (const [g, n] of contagem) {
    if (n > votos) {
      dominante = g;
      votos = n;
    }
  }
  return { dominante, votos, total };
}

export function revisarGenerosLegado(faixas: readonly FaixaMinima[]): RevisaoDeGenero[] {
  const mudancas = new Map<string, RevisaoDeGenero>();
  const registrar = (
    id: string,
    de: string | null,
    para: Genre | null,
    motivo: MotivoDaRevisao,
  ): void => {
    mudancas.set(id, { id, de: mudancas.get(id)?.de ?? de, para, motivo });
  };

  const depois: FaixaMinima[] = faixas.map((faixa) => {
    const atual = faixa.genre?.trim() || null;
    if (!atual) return faixa;
    const normalizado = normalizarGenero(atual);
    if (normalizado === atual) return faixa;
    registrar(faixa.id, atual, normalizado, normalizado ? 'normalizado' : 'balde');
    return { ...faixa, genre: normalizado };
  });

  for (const faixa of depois) {
    const atual = generoValido(faixa);
    if (!atual) continue;
    const principal = faixa.artistas[0];
    if (!principal) continue;
    const voto = generoDoArtistaLegado(depois, principal, faixa.id);
    if (!voto.dominante || voto.dominante === atual) continue;
    if (voto.votos < MIN_VOTOS_VETAR || voto.votos / voto.total < MIN_FATIA_VETAR) continue;
    if (GENEROS_DO_ARTISTA.has(atual) && !GENEROS_DO_ARTISTA.has(voto.dominante)) continue;
    registrar(faixa.id, atual, voto.dominante, 'discrepante');
  }

  for (const faixa of depois) {
    const atual = generoValido(faixa);
    if (faixa.artistas.length === 0) continue;
    if (atual && GENEROS_DO_ARTISTA.has(atual)) continue;
    let voto = VAZIO;
    for (const artista of faixa.artistas) {
      const v = generoDoArtistaLegado(depois, artista, faixa.id);
      if (v.dominante && GENEROS_DO_ARTISTA.has(v.dominante) && v.votos > voto.votos) voto = v;
    }
    if (!voto.dominante || !GENEROS_DO_ARTISTA.has(voto.dominante)) continue;
    if (voto.votos < MIN_VOTOS_ARTISTA) continue;
    if (voto.votos / (voto.total + 1) <= 0.5) continue;
    if (mudancas.get(faixa.id)?.motivo === 'discrepante') continue;
    registrar(faixa.id, atual, voto.dominante, 'genero-do-artista');
  }

  for (const faixa of depois) {
    const label = faixa.label?.trim();
    if (!label) continue;
    if (mudancas.has(faixa.id)) continue;
    const atual = generoValido(faixa);
    const voto = generoDoSeloLegado(depois, label, faixa.id);
    if (!voto.dominante || voto.dominante === atual) continue;
    if (voto.votos < MIN_VOTOS_SELO) continue;
    if (voto.votos / voto.total < MIN_FATIA_SELO) continue;
    registrar(faixa.id, atual, voto.dominante, 'genero-do-selo');
  }

  return [...mudancas.values()];
}
