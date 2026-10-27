/**
 * AS FONTES DOS CRÉDITOS PROFUNDOS — quem produziu, compôs, mixou, lançou.
 *
 * Três fontes, nesta ordem de confiança:
 *   • MusicBrainz — gravação (produtor, mixagem, engenharia, intérpretes),
 *     obra (compositor, letrista, editora) e lançamento (gravadora, selo,
 *     produtora). Fila serial de `mundo.fontes` (1 req/2 s, 503 = espere).
 *   • Discogs — créditos por faixa e por disco (`extraartists`), selos e
 *     empresas (editora, empresário). Exige token em `.env`; sem ele, muda.
 *     60 req/min autenticado: fila própria, 1,1 s entre chamadas.
 *   • O ACERVO — o que o importador já trouxe (tag TCOM/compositor e a
 *     gravadora do Deezer/MusicBrainz via `/credits`). Sem rede.
 *
 * NUNCA inventa: só o que a fonte afirma. A identificação da gravação exige
 * título E artista casando (ver `escolherGravacaoMB`); "o mais parecido" é
 * como um crédito de outra música iria parar na ficha errada.
 *
 * Os nomes passam pela regra única `separarCreditos` (shared) — "A & B" na
 * tag vira duas pessoas — e viram chave de identidade com
 * `chaveDeIdentidadeDoArtista`, a MESMA do acervo: é o que permite navegar
 * do crédito para a ficha do artista quando ele está no acervo, sem duplicar.
 */
import { chaveDeIdentidadeDoArtista, separarCreditos } from '@radinho/shared';
import { env } from '../config/index.js';
import { FonteIndisponivel, lerJson, mb, type Orcamento } from './mundo.fontes.js';

export type Papel =
  | 'PRODUTOR'
  | 'COMPOSITOR'
  | 'LETRISTA'
  | 'ARRANJADOR'
  | 'MIXAGEM'
  | 'MASTERIZACAO'
  | 'ENGENHEIRO'
  | 'INTERPRETE'
  | 'GRAVADORA'
  | 'SELO'
  | 'PRODUTORA'
  | 'EDITORA'
  | 'EMPRESARIO';

export interface CreditoLido {
  papel: Papel;
  nome: string;
  /** `chaveDeIdentidadeDoArtista(nome)`. */
  chave: string;
  fonte: 'musicbrainz' | 'discogs' | 'acervo';
  dados?: Record<string, unknown>;
}

function limpo(nome: string | undefined | null): string {
  return (nome ?? '').replace(/\s+/g, ' ').trim();
}

/** Um nome (ou lista "A & B") → créditos, um por pessoa. Puro. */
export function creditosDoNome(
  papel: Papel,
  bruto: string | undefined | null,
  fonte: CreditoLido['fonte'],
  dados?: Record<string, unknown>,
): CreditoLido[] {
  const saida: CreditoLido[] = [];
  // Gravadora, selo, editora e empresa não são lista de pessoas: "Som Livre"
  // não se parte; "Universal Music Brasil & Som Livre" raríssimo e ambíguo.
  const nomes =
    papel === 'GRAVADORA' || papel === 'SELO' || papel === 'PRODUTORA' || papel === 'EDITORA'
      ? [limpo(bruto)]
      : separarCreditos(limpo(bruto));
  for (const nome of nomes) {
    const chave = chaveDeIdentidadeDoArtista(nome);
    if (!nome || chave.length < 2) continue;
    saida.push({ papel, nome, chave, fonte, ...(dados ? { dados } : {}) });
  }
  return saida;
}

/**
 * O MESMO CRÉDITO EM DUAS FONTES vira um: mesmo papel e mesma identidade.
 * Fica o nome da fonte mais confiável (MusicBrainz > Discogs > acervo) e as
 * fontes se somam em `dados.fontes`. Puro.
 */
export function fundirCreditos(lista: CreditoLido[]): CreditoLido[] {
  const ordem = { musicbrainz: 0, discogs: 1, acervo: 2 } as const;
  const porChave = new Map<string, CreditoLido>();
  for (const c of lista) {
    const k = `${c.papel}|${c.chave}`;
    const atual = porChave.get(k);
    if (!atual) {
      porChave.set(k, { ...c, dados: { ...(c.dados ?? {}), fontes: [c.fonte] } });
      continue;
    }
    const fontes = [...new Set([...((atual.dados?.fontes as string[]) ?? []), c.fonte])];
    const melhor = ordem[c.fonte] < ordem[atual.fonte] ? c : atual;
    porChave.set(k, { ...melhor, dados: { ...(atual.dados ?? {}), ...(c.dados ?? {}), fontes } });
  }
  return [...porChave.values()];
}

/** O que o importador já trouxe na própria entrada do acervo. Puro, sem rede. */
export function creditosDoAcervo(track: {
  composer?: string | null;
  label?: string | null;
}): CreditoLido[] {
  return [
    ...creditosDoNome('COMPOSITOR', track.composer, 'acervo'),
    ...creditosDoNome('GRAVADORA', track.label, 'acervo'),
  ];
}

// ── MusicBrainz ──────────────────────────────────────────────────────────────

/** Tipo de relação artista↔gravação/obra do MusicBrainz → papel. Puro. */
export function papelDaRelacaoMB(tipo: string | undefined): Papel | null {
  const t = (tipo ?? '').toLowerCase();
  if (!t) return null;
  if (t === 'producer') return 'PRODUTOR';
  if (t === 'composer' || t === 'writer') return 'COMPOSITOR';
  if (t === 'lyricist' || t === 'librettist') return 'LETRISTA';
  if (
    t === 'arranger' ||
    t === 'orchestrator' ||
    t === 'instrument arranger' ||
    t === 'vocal arranger'
  )
    return 'ARRANJADOR';
  if (t === 'mix' || t === 'remixer') return 'MIXAGEM';
  if (t === 'mastering') return 'MASTERIZACAO';
  if (
    t === 'engineer' ||
    t === 'recording' ||
    t === 'audio' ||
    t === 'sound' ||
    t === 'programming'
  )
    return 'ENGENHEIRO';
  if (t === 'vocal' || t === 'instrument' || t === 'performer' || t === 'performing orchestra')
    return 'INTERPRETE';
  return null;
}

/**
 * Tipo do selo no MusicBrainz → papel. "Imprint" é o SELO (a marca estampada
 * no disco), "Publisher" é EDITORA; "Production", "Original Production",
 * "Holding" e os demais são a GRAVADORA (quem produz e lança gravações — na
 * taxonomia deles "production" é isso, não uma produtora de vídeo). Puro.
 */
export function papelDoSeloMB(tipo: string | undefined): Papel {
  const t = (tipo ?? '').toLowerCase();
  if (t === 'imprint') return 'SELO';
  if (t === 'publisher') return 'EDITORA';
  return 'GRAVADORA';
}

const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface MbGravacao {
  id: string;
  title?: string;
  score?: number;
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
}

/**
 * QUAL GRAVAÇÃO É A NOSSA. Título igual (ou um prefixo do outro, para sufixo
 * de versão) E artista igual por identidade. Sem os dois, `null`. Puro.
 */
export function escolherGravacaoMB(
  titulo: string,
  artista: string,
  candidatas: MbGravacao[],
): MbGravacao | null {
  const t = normalizar(titulo);
  const a = chaveDeIdentidadeDoArtista(artista);
  if (!t || !a) return null;
  let melhor: { g: MbGravacao; nota: number } | null = null;
  for (const g of candidatas) {
    const gt = normalizar(g.title ?? '');
    const notaTitulo = gt === t ? 3 : gt.startsWith(t) || t.startsWith(gt) ? 1 : 0;
    if (!gt || notaTitulo === 0) continue;
    const creditos = g['artist-credit'] ?? [];
    const bate = creditos.some(
      (c) => chaveDeIdentidadeDoArtista(c.artist?.name ?? c.name ?? '') === a,
    );
    if (!bate) continue;
    const nota = notaTitulo * 100 + (g.score ?? 0);
    if (!melhor || nota > melhor.nota) melhor = { g, nota };
  }
  return melhor?.g ?? null;
}

interface MbRel {
  type?: string;
  'target-type'?: string;
  attributes?: string[];
  artist?: { name?: string; id?: string };
  label?: { name?: string; id?: string; type?: string };
  work?: { id?: string };
  begin?: string;
  end?: string;
}

export interface LeituraMB {
  recordingId: string;
  workId: string | null;
  releaseId: string | null;
  creditos: CreditoLido[];
}

/** Gravação + obra + lançamento, até 4 chamadas. `null` = não identificada. */
export async function lerGravacaoMB(
  titulo: string,
  artista: string,
  orc: Orcamento,
): Promise<LeituraMB | null> {
  const q = encodeURIComponent(
    `recording:"${titulo.replace(/"/g, '')}" AND artist:"${artista.replace(/"/g, '')}"`,
  );
  const busca = await mb<{ recordings?: MbGravacao[] }>(`recording?query=${q}&limit=6`, orc);
  const escolhida = escolherGravacaoMB(titulo, artista, busca?.recordings ?? []);
  if (!escolhida) return null;

  const creditos: CreditoLido[] = [];
  const rec = await mb<{
    relations?: MbRel[];
    releases?: Array<{ id: string; status?: string; date?: string }>;
  }>(`recording/${escolhida.id}?inc=artist-rels+work-rels+releases`, orc);
  for (const rel of rec?.relations ?? []) {
    if (rel['target-type'] !== 'artist') continue;
    const papel = papelDaRelacaoMB(rel.type);
    if (!papel || papel === 'INTERPRETE') continue; // intérprete já está no crédito da faixa
    creditos.push(
      ...creditosDoNome(papel, rel.artist?.name, 'musicbrainz', {
        mbid: rel.artist?.id,
        ...(rel.attributes?.length ? { atributos: rel.attributes } : {}),
      }),
    );
  }
  const workId =
    (rec?.relations ?? []).find((r) => r['target-type'] === 'work' && r.work?.id)?.work?.id ?? null;
  // O lançamento oficial mais antigo é o original; bootlegs e promos ficam fora.
  const oficiais = (rec?.releases ?? []).filter((r) => !r.status || r.status === 'Official');
  oficiais.sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999'));
  const releaseId = oficiais[0]?.id ?? rec?.releases?.[0]?.id ?? null;

  if (workId) {
    const work = await mb<{ relations?: MbRel[] }>(
      `work/${workId}?inc=artist-rels+label-rels`,
      orc,
    );
    for (const rel of work?.relations ?? []) {
      if (rel['target-type'] === 'artist') {
        const papel = papelDaRelacaoMB(rel.type);
        if (papel === 'COMPOSITOR' || papel === 'LETRISTA' || papel === 'ARRANJADOR') {
          creditos.push(
            ...creditosDoNome(papel, rel.artist?.name, 'musicbrainz', { mbid: rel.artist?.id }),
          );
        }
      } else if (rel['target-type'] === 'label' && rel.type === 'publishing') {
        creditos.push(
          ...creditosDoNome('EDITORA', rel.label?.name, 'musicbrainz', { mbid: rel.label?.id }),
        );
      }
    }
  }
  if (releaseId) {
    const release = await mb<{
      'label-info'?: Array<{
        'catalog-number'?: string;
        label?: { name?: string; id?: string; type?: string };
      }>;
    }>(`release/${releaseId}?inc=labels`, orc);
    for (const info of release?.['label-info'] ?? []) {
      if (!info.label?.name) continue;
      creditos.push(
        ...creditosDoNome(papelDoSeloMB(info.label.type), info.label.name, 'musicbrainz', {
          mbid: info.label.id,
          ...(info['catalog-number'] ? { catalogo: info['catalog-number'] } : {}),
        }),
      );
    }
  }
  return { recordingId: escolhida.id, workId, releaseId, creditos };
}

/**
 * Créditos do ARTISTA (não de uma faixa): contrato com gravadora, editora,
 * empresário, de `artist/{mbid}?inc=label-rels+artist-rels`.
 */
export async function lerArtistaMB(mbid: string, orc: Orcamento): Promise<CreditoLido[]> {
  const r = await mb<{ relations?: MbRel[] }>(`artist/${mbid}?inc=label-rels+artist-rels`, orc);
  const creditos: CreditoLido[] = [];
  for (const rel of r?.relations ?? []) {
    const tipo = (rel.type ?? '').toLowerCase();
    const periodo = {
      ...(rel.begin ? { inicio: rel.begin } : {}),
      ...(rel.end ? { fim: rel.end } : {}),
    };
    if (rel['target-type'] === 'label' && rel.label?.name) {
      if (tipo === 'recording contract' || tipo === 'recording') {
        creditos.push(
          ...creditosDoNome('GRAVADORA', rel.label.name, 'musicbrainz', {
            mbid: rel.label.id,
            ...periodo,
          }),
        );
      } else if (tipo === 'publishing') {
        creditos.push(
          ...creditosDoNome('EDITORA', rel.label.name, 'musicbrainz', {
            mbid: rel.label.id,
            ...periodo,
          }),
        );
      } else if (tipo.includes('manag') || tipo === 'booking') {
        creditos.push(
          ...creditosDoNome('EMPRESARIO', rel.label.name, 'musicbrainz', {
            mbid: rel.label.id,
            relacao: rel.type,
            ...periodo,
          }),
        );
      }
    } else if (rel['target-type'] === 'artist' && rel.artist?.name && tipo.includes('manag')) {
      creditos.push(
        ...creditosDoNome('EMPRESARIO', rel.artist.name, 'musicbrainz', {
          mbid: rel.artist.id,
          relacao: rel.type,
          ...periodo,
        }),
      );
    }
  }
  return creditos;
}

// ── Discogs ──────────────────────────────────────────────────────────────────

const DISCOGS = 'https://api.discogs.com';
const DISCOGS_INTERVALO_MS = 1100;
let discogsFila: Promise<unknown> = Promise.resolve();
let discogsUltimaEm = 0;

async function discogs<T>(caminho: string, orc: Orcamento): Promise<T | null> {
  if (!env.DISCOGS_TOKEN) return null;
  const rodar = async (): Promise<T | null> => {
    const espera = discogsUltimaEm + DISCOGS_INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise((res) => setTimeout(res, espera));
    discogsUltimaEm = Date.now();
    const r = await lerJson<T>(`${DISCOGS}/${caminho}`, orc, {
      Authorization: `Discogs token=${env.DISCOGS_TOKEN}`,
    });
    if (r === null) return null;
    if (r.status === 429 || r.status === 503 || r.status === 0)
      throw new FonteIndisponivel('discogs', r.status);
    return r.body;
  };
  const resultado = discogsFila.then(rodar, rodar);
  discogsFila = resultado.then(
    () => undefined,
    () => undefined,
  );
  return resultado;
}

/** "Mano Brown (2)" → "Mano Brown": o número é desambiguação do Discogs. Puro. */
export function nomeDoDiscogs(nome: string | undefined | null): string {
  return limpo(nome).replace(/\s\(\d+\)$/, '');
}

/** Papel do Discogs ("Producer", "Written-By", "Mixed By"…) → papel. Puro. */
export function papelDoDiscogs(role: string | undefined): Papel | null {
  const r = (role ?? '').toLowerCase();
  if (!r) return null;
  if (/producer|produced by/.test(r)) return 'PRODUTOR';
  if (/written-by|composed by|songwriter|music by|composer/.test(r)) return 'COMPOSITOR';
  if (/lyrics by|words by|lyricist/.test(r)) return 'LETRISTA';
  if (/arranged by|arranger/.test(r)) return 'ARRANJADOR';
  if (/mixed by|remix/.test(r)) return 'MIXAGEM';
  if (/mastered by|mastering/.test(r)) return 'MASTERIZACAO';
  if (/engineer|recorded by|programmed by/.test(r)) return 'ENGENHEIRO';
  if (/management|manager|booking/.test(r)) return 'EMPRESARIO';
  return null;
}

/** Empresa do Discogs ("Published By", "Management"…) → papel. Puro. */
export function papelDaEmpresaDiscogs(tipo: string | undefined): Papel | null {
  const t = (tipo ?? '').toLowerCase();
  if (/published by|publish/.test(t)) return 'EDITORA';
  if (/management|manager|booking/.test(t)) return 'EMPRESARIO';
  if (/produced for|production/.test(t)) return 'PRODUTORA';
  return null;
}

interface DiscogsRelease {
  id?: number;
  title?: string;
  artists?: Array<{ name?: string }>;
  extraartists?: Array<{ name?: string; role?: string }>;
  labels?: Array<{ name?: string; id?: number; entity_type_name?: string }>;
  companies?: Array<{ name?: string; id?: number; entity_type_name?: string }>;
  tracklist?: Array<{ title?: string; extraartists?: Array<{ name?: string; role?: string }> }>;
}

/** Os créditos do disco e da faixa, a partir do lançamento do Discogs. Puro. */
export function creditosDoDiscogs(release: DiscogsRelease, titulo: string): CreditoLido[] {
  const creditos: CreditoLido[] = [];
  const t = normalizar(titulo);
  const faixa = (release.tracklist ?? []).find((f) => {
    const ft = normalizar(f.title ?? '');
    return ft && (ft === t || ft.startsWith(t) || t.startsWith(ft));
  });
  const ler = (
    lista: Array<{ name?: string; role?: string }> | undefined,
    nivel: 'faixa' | 'disco',
  ) => {
    for (const ea of lista ?? []) {
      const papel = papelDoDiscogs(ea.role);
      if (!papel) continue;
      creditos.push(
        ...creditosDoNome(papel, nomeDoDiscogs(ea.name), 'discogs', {
          nivel,
          papelOriginal: ea.role,
        }),
      );
    }
  };
  ler(faixa?.extraartists, 'faixa');
  // Crédito do DISCO vale para a faixa quando ela não tem crédito próprio do
  // mesmo papel (produtor do álbum inteiro, por exemplo).
  const papeisDaFaixa = new Set(creditos.map((c) => c.papel));
  for (const ea of release.extraartists ?? []) {
    const papel = papelDoDiscogs(ea.role);
    if (!papel || papeisDaFaixa.has(papel)) continue;
    creditos.push(
      ...creditosDoNome(papel, nomeDoDiscogs(ea.name), 'discogs', {
        nivel: 'disco',
        papelOriginal: ea.role,
      }),
    );
  }
  for (const l of release.labels ?? []) {
    creditos.push(
      ...creditosDoNome('GRAVADORA', nomeDoDiscogs(l.name), 'discogs', { discogsId: l.id }),
    );
  }
  for (const c of release.companies ?? []) {
    const papel = papelDaEmpresaDiscogs(c.entity_type_name);
    if (!papel) continue;
    creditos.push(
      ...creditosDoNome(papel, nomeDoDiscogs(c.name), 'discogs', {
        discogsId: c.id,
        relacao: c.entity_type_name,
      }),
    );
  }
  return creditos;
}

export async function lerDiscogs(
  titulo: string,
  artista: string,
  orc: Orcamento,
): Promise<{ releaseId: number; creditos: CreditoLido[] } | null> {
  if (!env.DISCOGS_TOKEN) return null;
  const q = encodeURIComponent(`${artista} ${titulo}`);
  const busca = await discogs<{ results?: Array<{ id?: number; type?: string; title?: string }> }>(
    `database/search?q=${q}&type=release&per_page=5`,
    orc,
  );
  const a = chaveDeIdentidadeDoArtista(artista);
  // O título do resultado é "Artista - Disco": o artista precisa casar.
  const hit = (busca?.results ?? []).find((r) => {
    const [art] = (r.title ?? '').split(' - ');
    return r.id && art && chaveDeIdentidadeDoArtista(nomeDoDiscogs(art)) === a;
  });
  if (!hit?.id) return null;
  const release = await discogs<DiscogsRelease>(`releases/${hit.id}`, orc);
  if (!release) return null;
  return { releaseId: hit.id, creditos: creditosDoDiscogs(release, titulo) };
}
