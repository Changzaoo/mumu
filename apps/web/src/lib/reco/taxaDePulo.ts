/**
 * A MEDIDA: quanto do que o app recomenda é pulado.
 *
 * O player grava no histórico toda faixa que tocou 30 s ou metade (ver
 * `playerStore`) com a FONTE de onde veio (`PlaySource`), e anota cada pulo com
 * a mesma fonte (`lib/reco/pulos`, campo `fonte`). Juntando os dois dá para
 * responder, por fonte: de tudo o que o app ofereceu, quanto a pessoa pulou?
 *
 * "Recomendação" aqui é o que o app ESCOLHEU sem a pessoa pedir: as
 * prateleiras da Home (`home`), a rádio automática (`radio`) e as listas
 * montadas pelo gosto (`library` com um sourceId de prateleira — gênero,
 * ramo, mix, agente, "em alta"). Álbum, playlist e artista abertos pela pessoa
 * não são recomendação: ela escolheu.
 *
 * A comparação ANTES × DEPOIS é contra `COERENCIA_DESDE`, o dia em que o
 * filtro duro de gênero entrou (27/10/2026). Puro e testável.
 */
import type { Pulo } from './pulos';

/** Quando a coerência de gênero passou a valer no app (hora de Brasília). */
export const COERENCIA_DESDE = Date.parse('2026-10-27T21:00:00.000Z');

/** Fontes em que a faixa foi escolhida pelo app, não pela pessoa. */
const FONTES_DO_APP = new Set(['home', 'radio', 'recommendation']);
/** Prefixos de `sourceId` da `library` que são prateleira montada pelo gosto. */
const PRATELEIRAS = /^(?:genre:|artist:|reco|ramo|semente|agente|mix|em-alta|sem:|momento)/;

export function fonteDoContexto(
  contexto: { source: string; sourceId?: string } | null | undefined,
): string | undefined {
  if (!contexto) return undefined;
  return `${contexto.source}:${contexto.sourceId ?? ''}`;
}

/** "home:em-alta:Pop" → é recomendação? Só pela fonte, sem o sourceId: "home" → sim. */
export function ehRecomendacao(fonte: string | null | undefined): boolean {
  if (!fonte) return false;
  const [source, ...resto] = fonte.split(':');
  if (!source) return false;
  if (FONTES_DO_APP.has(source)) return true;
  return source === 'library' && PRATELEIRAS.test(resto.join(':'));
}

export interface Medida {
  plays: number;
  pulos: number;
  /** pulos / (plays + pulos), ou `null` sem amostra. */
  taxa: number | null;
}

export interface TaxaDePulo {
  antes: Medida;
  depois: Medida;
  /** O mesmo, para o que NÃO é recomendação — a régua de comparação. */
  outrasAntes: Medida;
  outrasDepois: Medida;
}

const medida = (plays: number, pulos: number): Medida => ({
  plays,
  pulos,
  taxa: plays + pulos > 0 ? pulos / (plays + pulos) : null,
});

export function taxaDePulo(
  historico: ReadonlyArray<{ playedAt: string; source: string }>,
  pulos: readonly Pulo[],
  desde = COERENCIA_DESDE,
): TaxaDePulo {
  const n = { recoAntes: 0, recoDepois: 0, outAntes: 0, outDepois: 0 };
  const p = { recoAntes: 0, recoDepois: 0, outAntes: 0, outDepois: 0 };
  for (const h of historico) {
    const em = Date.parse(h.playedAt);
    if (!Number.isFinite(em)) continue;
    const reco = ehRecomendacao(`${h.source}:`);
    if (em >= desde) reco ? n.recoDepois++ : n.outDepois++;
    else reco ? n.recoAntes++ : n.outAntes++;
  }
  for (const pulo of pulos) {
    // Pulo antigo sem fonte: não dá para dizer de onde veio — fica fora.
    if (!pulo.fonte) continue;
    const reco = ehRecomendacao(pulo.fonte);
    if (pulo.em >= desde) reco ? p.recoDepois++ : p.outDepois++;
    else reco ? p.recoAntes++ : p.outAntes++;
  }
  return {
    antes: medida(n.recoAntes, p.recoAntes),
    depois: medida(n.recoDepois, p.recoDepois),
    outrasAntes: medida(n.outAntes, p.outAntes),
    outrasDepois: medida(n.outDepois, p.outDepois),
  };
}

const pct = (m: Medida): string =>
  m.taxa === null ? 'sem amostra' : `${Math.round(m.taxa * 100)}% (${m.pulos} pulos em ${m.plays + m.pulos})`;

/** Texto para o diagnóstico e para o relato. */
export function relatorioDeRecomendacao(
  historico: ReadonlyArray<{ playedAt: string; source: string }>,
  pulos: readonly Pulo[],
  desde = COERENCIA_DESDE,
): string {
  const t = taxaDePulo(historico, pulos, desde);
  const dia = new Date(desde).toLocaleDateString('pt-BR');
  return [
    'RECOMENDAÇÃO — taxa de pulo (pulos ÷ ofertas ouvidas ou puladas)',
    `  antes de ${dia}:  recomendações ${pct(t.antes)} · escolha própria ${pct(t.outrasAntes)}`,
    `  depois de ${dia}: recomendações ${pct(t.depois)} · escolha própria ${pct(t.outrasDepois)}`,
    '  Recomendação = Home, rádio e prateleiras montadas pelo gosto; os pulos só contam a fonte desde 27/10/2026.',
  ].join('\n');
}
