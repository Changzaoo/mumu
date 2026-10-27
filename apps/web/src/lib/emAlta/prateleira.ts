/**
 * A PRATELEIRA "EM ALTA" — do retrato do servidor ao que ESTA pessoa pode ver.
 *
 * O servidor manda a parada inteira, igual para todo mundo. Aqui ela vira a
 * prateleira de UMA pessoa, por duas regras que nunca se relaxam:
 *
 *   1. IDADE × CONTEÚDO — a regra única (`lib/conteudo/faixaEtaria`): menor
 *      não vê explícito, criança só vê o comprovadamente limpo. O veredito das
 *      faixas de fora do acervo chega do servidor e é registrado em
 *      `registrarVereditos` ANTES de perguntar `podeOuvir`.
 *   2. COERÊNCIA DE GOSTO — a tabela do shared (`podeRecomendar`): quem gosta
 *      de gospel não recebe a aba de trap nem a faixa de trap no "Todos".
 *
 * A ordem das abas é a do gosto: o gênero que a pessoa mais ouve vem primeiro,
 * depois a parada geral, depois os outros. Puro e testável: recebe o retrato,
 * a idade (via `podeOuvir`) e o gosto; não lê store nenhuma.
 */
import {
  GENERO_TODOS,
  familiasFortes,
  podeRecomendar,
  type EmAltaDto,
  type FaixaEmAlta,
  type FamiliaDoGosto,
  type TrackDto,
} from '@radinho/shared';

const PREFIXO = 'em-alta:';

/** O id da faixa de fora do acervo, estável entre leituras. */
export function idEmAlta(chave: string): string {
  return `${PREFIXO}${chave}`;
}

export function ehDeForaDoAcervo(track: Pick<TrackDto, 'id'>): boolean {
  return track.id.startsWith(PREFIXO);
}

/** A faixa como o player e os cartões a entendem. A do acervo é a do acervo. */
export function faixaParaTocar(
  f: FaixaEmAlta,
  doAcervo: (id: string) => TrackDto | null,
): TrackDto {
  const noAcervo = f.acervoId ? doAcervo(f.acervoId) : null;
  if (noAcervo) return noAcervo;
  return {
    id: idEmAlta(f.chave),
    title: f.titulo,
    durationMs: f.duracaoMs ?? 0,
    trackNumber: null,
    discNumber: null,
    explicit: f.conteudo === 'explicito',
    playsCount: 0,
    coverUrl: f.capa,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [{ id: '', name: f.artista, slug: '', imageUrl: null }],
    streamUrl: null,
    downloadUrl: null,
    ...(f.origem ? { sourceUrl: f.origem } : {}),
    genre: f.genero,
    uploadedByUserId: null,
  };
}

export interface OpcoesDaPrateleira {
  gosto: readonly FamiliaDoGosto[];
  /** Afinidade por gênero (perfil.afinidadeDoGenero): ordena as abas. */
  afinidade: (genero: string) => number;
  /** A regra da idade. */
  podeOuvir: (track: Pick<TrackDto, 'id' | 'title'>) => boolean;
  /** A faixa do acervo deste aparelho, quando ela está aqui. */
  doAcervo: (id: string) => TrackDto | null;
}

export interface GeneroDaPrateleira {
  genero: string;
  faixas: TrackDto[];
  /** As faixas originais, na mesma ordem (origem, fontes, posição). */
  origem: FaixaEmAlta[];
}

/** O que o aparelho precisa registrar antes de perguntar `podeOuvir`. */
export function vereditosParaRegistrar(
  dto: EmAltaDto,
): Array<readonly [string, FaixaEmAlta['conteudo']]> {
  const vistos = new Set<string>();
  const saida: Array<readonly [string, FaixaEmAlta['conteudo']]> = [];
  for (const g of dto.generos) {
    for (const f of g.faixas) {
      if (f.acervoId || vistos.has(f.chave)) continue;
      vistos.add(f.chave);
      saida.push([idEmAlta(f.chave), f.conteudo]);
    }
  }
  return saida;
}

export function montarPrateleira(dto: EmAltaDto, opcoes: OpcoesDaPrateleira): GeneroDaPrateleira[] {
  const temGosto = familiasFortes(opcoes.gosto).length > 0;
  const generoPermitido = (genero: string): boolean =>
    genero === GENERO_TODOS ||
    !temGosto ||
    // Só a família do gênero importa aqui; o conteúdo é decidido faixa a faixa.
    podeRecomendar(opcoes.gosto, { genero, conteudo: 'limpo' });

  const saida: GeneroDaPrateleira[] = [];
  for (const g of dto.generos) {
    if (!generoPermitido(g.genero)) continue;
    const faixas: TrackDto[] = [];
    const origem: FaixaEmAlta[] = [];
    const vistos = new Set<string>();
    for (const f of g.faixas) {
      const track = faixaParaTocar(f, opcoes.doAcervo);
      if (vistos.has(track.id)) continue;
      if (!opcoes.podeOuvir(track)) continue;
      if (temGosto && !podeRecomendar(opcoes.gosto, { genero: f.genero, conteudo: f.conteudo })) {
        continue;
      }
      vistos.add(track.id);
      faixas.push(track);
      origem.push(f);
    }
    if (faixas.length > 0) saida.push({ genero: g.genero, faixas, origem });
  }

  // Abas na ordem do gosto; a parada geral vem logo depois do que a pessoa
  // ouve, e primeiro quando não há gosto medido.
  const nota = (g: GeneroDaPrateleira): number =>
    g.genero === GENERO_TODOS ? 0 : opcoes.afinidade(g.genero);
  const posicao = new Map(saida.map((g, i) => [g.genero, i]));
  saida.sort((a, b) => {
    const na = nota(a);
    const nb = nota(b);
    if (na !== nb) return nb - na;
    if (a.genero === GENERO_TODOS) return -1;
    if (b.genero === GENERO_TODOS) return 1;
    return (posicao.get(a.genero) ?? 0) - (posicao.get(b.genero) ?? 0);
  });
  return saida;
}

/** "atualizado há 12 min" — para a legenda. */
export function haQuanto(iso: string, agora = Date.now()): string {
  const ms = agora - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
