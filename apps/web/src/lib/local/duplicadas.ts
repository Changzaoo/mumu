/**
 * A MESMA MÚSICA NÃO ENTRA DUAS VEZES — nem com outro nome.
 *
 * Importar uma playlist grande trazia a mesma música várias vezes: o clipe e o
 * áudio ("(Official Video)" × "(Audio)"), "ft." × "feat.", o "Remastered", o
 * mesmo vídeo com `&list=` no link, o reupload de outro canal. A deduplicação
 * que existia não pegava nada disso:
 *
 *   - por LINK (`findBySource`) comparava a string inteira — `youtu.be/X` e
 *     `youtube.com/watch?v=X&list=…` eram "links diferentes";
 *   - por BYTES (`contentHash`) só pega o mesmo arquivo; clipe e áudio nunca são;
 *   - por TÍTULO (`dedupeKey`) normalizava caixa e acento, mas deixava
 *     "(Official Video)" e "ft. Fulano" dentro do título — outra chave.
 *   - e tudo isso só depois de BAIXAR: a fila da playlist enfileirava os links
 *     sem olhar a biblioteca, e o download acontecia de qualquer jeito.
 *
 * Este módulo é PURO (sem biblioteca, sem rede): quem chama passa as entradas.
 * Três camadas, da mais barata para a mais cara:
 *
 *   1. ORIGEM (`chaveDaOrigem`): o id do vídeo/faixa no serviço, não a URL.
 *   2. CHAVE DA MÚSICA (`chaveDaMusica`): artista principal + título canônico +
 *      marcas de versão, e duração parecida (±3 s) quando os dois lados sabem.
 *   3. LETRA (`paresPelaLetra`): depois de baixar, quando o título não bate —
 *      mesma letra, mesmo artista, mesma versão e duração próxima.
 *
 * O QUE É VERSÃO DE VERDADE (e por isso NUNCA junta com a original): ao vivo,
 * acústico, remix, sped up/nightcore, slowed/reverb, instrumental/karaokê,
 * cover, 8D, estendida, demo e "(Versão X)". Essas marcas saem do título mas
 * entram na chave — "Música (Ao Vivo)" e "Música" têm chaves diferentes.
 *
 * O QUE É RUÍDO (sai do título e da chave): official/oficial, video/clipe,
 * audio, lyric/letra, visualizer, HD/4K, remaster(ed), explicit, legendado,
 * tradução, feat./ft./part./with, prod., "| Canal", "- Topic", #hashtags.
 * Remaster fica aqui de propósito: é a MESMA gravação com outra masterização,
 * e a duração continua sendo conferida.
 */

// ── normalização ────────────────────────────────────────────────────────────

/**
 * Minúsculas, sem acento, só letras e números — EM QUALQUER ALFABETO. O
 * `[^a-z0-9]` antigo apagava hangul/kana/cirílico e a chave virava vazia (ver o
 * comentário de `normName` em localLibrary.ts, que é o mesmo engano).
 */
export function normalizar(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Marcas de versão que valem em QUALQUER lugar do título (não são palavras
 *  que aparecem em nome de música por acaso). Ordem = prioridade do rótulo. */
const VERSAO_EM_QUALQUER_LUGAR: ReadonlyArray<[string, RegExp]> = [
  ['ao vivo', /\b(?:ao vivo|en vivo|live at|live from|live session)\b/],
  ['acustico', /\b(?:acustic[oa]|acoustic|unplugged|voz e violao)\b/],
  ['remix', /\b(?:remix|rmx|remixed|mashup|bootleg)\b/],
  ['sped up', /\b(?:sped ?up|speed ?up|nightcore)\b/],
  ['slowed', /\b(?:slowed|reverb)\b/],
  ['instrumental', /\b(?:instrumental|karaoke)\b/],
  ['8d', /\b8d\b/],
];

/** Marcas que só valem DENTRO de parênteses ou depois do último " - ":
 *  "Live Forever" é nome de música, "(Live)" é versão. */
const VERSAO_SO_ENTRE_PARENTESES: ReadonlyArray<[string, RegExp]> = [
  ['ao vivo', /\blive\b/],
  ['cover', /\bcover\b/],
  ['instrumental', /\b(?:playback|beat)\b/],
  ['estendida', /\b(?:extended|estendida)\b/],
  ['demo', /\bdemo\b/],
];

/** Pedaço (entre parênteses ou após " - ") que é só ruído de YouTube/serviço. */
const RUIDO =
  /^(?:(?:official|oficial|music|musical|video|videoclipe|videoclip|clipe|clip|audio|lyrics?|letra|visuali[sz]er|hd|hq|4k|8k|full|mv|m v|explicit|explicito|clean|legendado|traducao|com letra|remaster(?:ed)?|remasterizad[oa]|\d{4}|version|versao original|original|single|topic|premiere|estreia)\s*)+$/;

/** Participação e produção: saem da chave ("feat." × "ft." × sem nada). */
const PARTICIPACAO = /^(?:feat|ft|featuring|part|participacao|particip|with|prod|produced)\b/;

/** Pedaço entre parênteses/colchetes: "(…)", "[…]", "{…}", "【…】". */
const PARENTESES = /[([{【]([^)\]}】]*)[)\]}】]/g;

/** Rótulo "(Versão Brega)"/"(Piseiro Version)": versão nomeada, vira marca. */
function versaoNomeada(trecho: string): string | null {
  const m = /\b(?:versao|version|vers)\b/.exec(trecho);
  if (!m) return null;
  const nome = trecho
    .replace(/\b(?:versao|version|vers|da|do|de|em)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "(Versão Original)" é a própria música, não uma versão.
  if (!nome || nome === 'original' || nome === 'oficial' || nome === 'official') return null;
  return `versao ${nome}`;
}

interface Desmontado {
  titulo: string;
  versoes: string[];
}

/** O coração: separa o título em nome da música + marcas de versão. */
function desmontar(raw: string): Desmontado {
  const versoes = new Set<string>();
  const marcarTrecho = (trechoNorm: string): 'ruido' | 'versao' | 'titulo' => {
    if (!trechoNorm) return 'ruido';
    if (PARTICIPACAO.test(trechoNorm)) return 'ruido';
    let achou = false;
    for (const [rotulo, re] of VERSAO_EM_QUALQUER_LUGAR) {
      if (re.test(trechoNorm)) {
        versoes.add(rotulo);
        achou = true;
      }
    }
    for (const [rotulo, re] of VERSAO_SO_ENTRE_PARENTESES) {
      if (re.test(trechoNorm)) {
        versoes.add(rotulo);
        achou = true;
      }
    }
    // Versão nomeada só quando nenhuma marca conhecida explicou o trecho:
    // "(Acoustic Version)" e "(Acústico)" têm de dar a MESMA marca.
    const nomeada = achou ? null : versaoNomeada(trechoNorm);
    if (nomeada) {
      versoes.add(nomeada);
      achou = true;
    }
    if (achou) return 'versao';
    if (RUIDO.test(trechoNorm)) return 'ruido';
    return 'titulo';
  };

  let s = raw
    .replace(/\.(?:mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i, '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ') // #shorts, #trap
    .replace(/\s+[|·•]\s+.*$/, ' ') // " | Canal", " • Tal"
    .replace(/^\s*\d{1,2}\s*[-–—.]\s+/, ''); // "01 - " do rip

  // Parênteses: cada um é ruído, versão ou parte do nome ("(Parte 2)" fica).
  s = s.replace(PARENTESES, (_m, dentro: string) => {
    const n = normalizar(dentro);
    return marcarTrecho(n) === 'titulo' ? ` ${dentro} ` : ' ';
  });

  // Sufixos soltos depois de " - ": "Música - Ao Vivo", "Música - Official Video".
  for (;;) {
    const m = /^(.*\S)\s+[-–—]\s+([^-–—]+)$/.exec(s);
    if (!m?.[1] || !m[2]) break;
    const tipo = marcarTrecho(normalizar(m[2]));
    if (tipo === 'titulo') break;
    s = m[1];
  }

  // "feat. Fulano", "ft Fulano", "part. X", "prod. by X" sem parênteses: até o
  // fim. Feito no texto CRU, com o ponto/espaço exigidos: normalizado, "part"
  // de "Part of Me" seria indistinguível de "part." de participação.
  s = s.replace(
    /\s(?:feat\.?|ft\.?|featuring|part\.|participa[çc][ãa]o|prod\.|produced by)\s.*$/i,
    ' ',
  );

  let titulo = normalizar(s);
  // Marcas soltas no meio do título ("Música Ao Vivo", "musica sped up").
  for (const [rotulo, re] of VERSAO_EM_QUALQUER_LUGAR) {
    if (re.test(titulo)) {
      versoes.add(rotulo);
      titulo = titulo.replace(new RegExp(re.source, 'g'), ' ');
    }
  }
  titulo = titulo
    // Ruído solto sem parênteses nem hífen.
    .replace(
      /\b(?:official (?:music )?video|official audio|video oficial|clipe oficial|audio oficial|lyric video|visualizer)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  return { titulo, versoes: [...versoes].sort() };
}

const DESMONTADOS = new Map<string, Desmontado>();
function desmontado(raw: string): Desmontado {
  // Título que não é texto (entrada quebrada do acervo) não pode derrubar a
  // vista inteira da biblioteca: vale como vazio.
  if (typeof raw !== 'string') raw = '';
  let d = DESMONTADOS.get(raw);
  if (!d) {
    d = desmontar(raw);
    // Teto só para uma sessão longa não acumular títulos sem fim.
    if (DESMONTADOS.size > 50_000) DESMONTADOS.clear();
    DESMONTADOS.set(raw, d);
  }
  return d;
}

/** Nome da música sem ruído nem marca de versão: "333 (Clipe Oficial)" → "333". */
export function tituloCanonico(raw: string): string {
  return desmontado(raw).titulo;
}

/** Marcas de versão do título, ordenadas: "Música (Ao Vivo) [Acústico]" → ["acustico","ao vivo"]. */
export function versoesDoTitulo(raw: string): string[] {
  return desmontado(raw).versoes;
}

/** Como a marca aparece de volta no título quando o crédito a perdeu. */
const ROTULO_DE_VOLTA: Record<string, string> = {
  'ao vivo': 'Ao Vivo',
  acustico: 'Acústico',
  remix: 'Remix',
  'sped up': 'Sped Up',
  slowed: 'Slowed',
  instrumental: 'Instrumental',
  '8d': '8D',
  cover: 'Cover',
  estendida: 'Extended',
  demo: 'Demo',
};

/**
 * Devolve `titulo` com as marcas de versão que o título BRUTO tinha e que a
 * limpeza de crédito jogou fora.
 *
 * A limpeza de busca (`cleanQuery`) tira "(Ao Vivo)", "(Sped Up)" e "(Slowed)"
 * porque o catálogo cadastra só o nome — e esse título limpo era GRAVADO como o
 * título da faixa. A versão ao vivo virava indistinguível da de estúdio, e toda
 * deduplicação depois disso (inclusive a da tela) podia engolir uma na outra.
 */
export function comVersoesDe(titulo: string, bruto: string): string {
  const faltando = versoesDoTitulo(bruto).filter((v) => !versoesDoTitulo(titulo).includes(v));
  if (faltando.length === 0) return titulo;
  const rotulos = faltando.map((v) =>
    v.startsWith('versao ') ? `Versão ${v.slice(7)}` : (ROTULO_DE_VOLTA[v] ?? v),
  );
  return `${titulo} (${rotulos.join(', ')})`;
}

const ARTISTA_DESCONHECIDO = new Set([
  '',
  'desconhecido',
  'unknown',
  'unknown artist',
  'various artists',
  'varios artistas',
  'vários artistas',
]);

/** "Matuê, Teto & WIU" → "matue"; "Anitta - Topic" → "anitta"; "X VEVO" → "x". */
export function artistaPrincipal(nome: string): string {
  // Memo pelo texto: a tela colapsa a biblioteca inteira a cada mudança (5 mil
  // faixas), e são sempre os mesmos poucos nomes.
  const pronto = ARTISTAS.get(nome);
  if (pronto !== undefined) return pronto;
  const n = artistaPrincipalSemMemo(nome);
  if (ARTISTAS.size > 20_000) ARTISTAS.clear();
  ARTISTAS.set(nome, n);
  return n;
}

const ARTISTAS = new Map<string, string>();

function artistaPrincipalSemMemo(nome: string): string {
  // Primeiro pedaço NÃO VAZIO: "E-40" começa com um "e" que parece conectivo.
  const primeiro =
    nome
      .replace(/\s*-\s*topic\s*$/i, '')
      .replace(/vevo\s*$/i, '')
      .split(/\s+(?:x|e|and|feat\.?|ft\.?|featuring|with)\s+|\s*[,&+;/]\s*/i)
      .find((p) => normalizar(p)) ?? '';
  const n = normalizar(primeiro.replace(/\(?\s*(?:oficial|official)\s*\)?\s*$/i, ''));
  return ARTISTA_DESCONHECIDO.has(n) ? '' : n;
}

/**
 * A chave da música: `artista|título|versões`. `null` quando não há como ter
 * certeza (sem artista, ou título genérico) — nesse caso ninguém deduplica.
 */
export function chaveDaMusica(titulo: string, artista: string): string | null {
  const a = artistaPrincipal(artista);
  const { titulo: t, versoes } = desmontado(titulo);
  if (!a || !t || t === 'faixa' || t === 'track' || t === 'intro' || t === 'outro') return null;
  return `${a}|${t}|${versoes.join('+')}`;
}

/** Tolerância de duração da camada de chave: mesma gravação, encode diferente. */
export const TOLERANCIA_MS = 3_000;

/** Duração parecida — ou desconhecida de um dos lados (aí a chave decide). */
export function duracaoCompativel(
  a?: number | null,
  b?: number | null,
  tol = TOLERANCIA_MS,
): boolean {
  if (!a || !b || a <= 0 || b <= 0) return true;
  return Math.abs(a - b) <= tol;
}

// ── origem ──────────────────────────────────────────────────────────────────

const YT_ID = /^[\w-]{11}$/;

/**
 * O id da música NO SERVIÇO, não a URL: `yt:dQw4w9WgXcQ`, `spotify:…`,
 * `deezer:…`, `apple:…`, `sc:artista/faixa`. `youtu.be/X`,
 * `music.youtube.com/watch?v=X&list=…` e `youtube.com/shorts/X` são o mesmo
 * vídeo. Link que não se reconhece vira a própria URL sem rastreio.
 */
export function chaveDaOrigem(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const partes = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && partes[0] && YT_ID.test(partes[0])) return `yt:${partes[0]}`;
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const v = u.searchParams.get('v');
    if (v && YT_ID.test(v)) return `yt:${v}`;
    if (['shorts', 'embed', 'live', 'v'].includes(partes[0] ?? '') && YT_ID.test(partes[1] ?? '')) {
      return `yt:${partes[1]}`;
    }
  }
  if (/(^|\.)spotify\.com$/.test(host)) {
    const i = partes.indexOf('track');
    if (i >= 0 && partes[i + 1]) return `spotify:${partes[i + 1]}`;
  }
  if (/(^|\.)deezer\.com$/.test(host)) {
    const i = partes.indexOf('track');
    if (i >= 0 && partes[i + 1]) return `deezer:${partes[i + 1]}`;
  }
  if (host === 'music.apple.com') {
    const i = u.searchParams.get('i');
    if (i) return `apple:${i}`;
    if (partes.includes('song') && partes.at(-1)) return `apple:${partes.at(-1)}`;
  }
  if (/(^|\.)soundcloud\.com$/.test(host) && partes.length >= 2) {
    return `sc:${partes.slice(0, 2).join('/').toLowerCase()}`;
  }
  for (const k of [...u.searchParams.keys()]) {
    if (/^(?:utm_|si$|fbclid$|gclid$|feature$|pp$)/i.test(k)) u.searchParams.delete(k);
  }
  u.hash = '';
  return `url:${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

// ── índice da biblioteca ────────────────────────────────────────────────────

/** O mínimo que o índice precisa saber de uma entrada da biblioteca. */
export interface EntradaIndexavel {
  track: {
    id: string;
    title: string;
    durationMs?: number | null;
    artists: ReadonlyArray<{ name: string }>;
  };
  sourceUrl?: string;
}

export interface Indice<E extends EntradaIndexavel> {
  porOrigem: Map<string, E>;
  porChave: Map<string, E[]>;
}

/**
 * Índice por CHAVE, montado uma vez por versão da lista. É o que evita comparar
 * cada faixa com todas: a pergunta "já tenho?" vira uma consulta de Map. A
 * memória é pela identidade do array — a biblioteca troca o array a cada
 * escrita, então índice velho nunca responde por lista nova.
 */
const INDICES = new WeakMap<readonly EntradaIndexavel[], Indice<EntradaIndexavel>>();

export function indiceDe<E extends EntradaIndexavel>(entradas: readonly E[]): Indice<E> {
  const pronto = INDICES.get(entradas) as Indice<E> | undefined;
  if (pronto) return pronto;
  const porOrigem = new Map<string, E>();
  const porChave = new Map<string, E[]>();
  for (const e of entradas) {
    const o = chaveDaOrigem(e.sourceUrl);
    if (o && !porOrigem.has(o)) porOrigem.set(o, e);
    // Indexa sob cada artista creditado (até 3): "Teto, Matuê - X" tem que
    // achar a faixa creditada a "Matuê, Teto".
    const vistas = new Set<string>();
    for (const a of e.track.artists.slice(0, 3)) {
      const k = chaveDaMusica(e.track.title, a.name);
      if (!k || vistas.has(k)) continue;
      vistas.add(k);
      const lista = porChave.get(k);
      if (lista) lista.push(e);
      else porChave.set(k, [e]);
    }
  }
  const indice = { porOrigem, porChave };
  INDICES.set(entradas, indice as Indice<EntradaIndexavel>);
  return indice;
}

/** O que se sabe de uma música ANTES (ou logo depois) de baixar. */
export interface Procurada {
  url?: string | null;
  titulo: string;
  artistas?: readonly string[];
  durationMs?: number | null;
}

/**
 * "Artista - Título" → as duas leituras possíveis. Metade das postagens vem ao
 * contrário ("ÚLTIMA VEZ - Alee"), e sem o canal não dá para saber qual lado
 * é o artista — então as duas são consultadas. A biblioteca é quem desempata:
 * só casa a leitura que existe lá com o mesmo artista.
 */
export function leiturasDoTitulo(titulo: string): Array<{ artista: string; titulo: string }> {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(titulo.replace(/\s+[|·•]\s+.*$/, ''));
  if (!m?.[1] || !m[2]) return [];
  return [
    { artista: m[1].trim(), titulo: m[2].trim() },
    { artista: m[2].trim(), titulo: m[1].trim() },
  ];
}

/** Todas as chaves de música de uma procurada (crédito explícito + leituras do título). */
export function chavesDaProcurada(p: Procurada): string[] {
  const out = new Set<string>();
  for (const a of p.artistas ?? []) {
    const k = chaveDaMusica(p.titulo, a);
    if (k) out.add(k);
  }
  if (out.size === 0) {
    for (const l of leiturasDoTitulo(p.titulo)) {
      const k = chaveDaMusica(l.titulo, l.artista);
      if (k) out.add(k);
    }
  }
  return [...out];
}

/** A entrada da biblioteca que já é esta música, ou `null`. */
export function acharMesmaMusica<E extends EntradaIndexavel>(
  entradas: readonly E[],
  p: Procurada,
): E | null {
  const indice = indiceDe(entradas);
  const o = chaveDaOrigem(p.url);
  if (o) {
    const pelaOrigem = indice.porOrigem.get(o);
    if (pelaOrigem) return pelaOrigem;
  }
  for (const k of chavesDaProcurada(p)) {
    const achada = indice.porChave
      .get(k)
      ?.find((e) => duracaoCompativel(e.track.durationMs, p.durationMs));
    if (achada) return achada;
  }
  return null;
}

/**
 * Filtra as entradas de uma playlist ANTES de enfileirar: fora o que já está
 * na biblioteca, o que já está na fila e o que se repete na própria lista.
 * `naFila` são os itens pendentes/baixando (link + título, quando conhecido).
 */
export function separarRepetidas<T extends { url: string; title?: string; duracaoSeg?: number }>(
  entradas: readonly T[],
  biblioteca: readonly EntradaIndexavel[],
  naFila: ReadonlyArray<{ url: string; title?: string }> = [],
): { novas: T[]; repetidas: Array<T & { motivo: 'biblioteca' | 'fila' }> } {
  const origensVistas = new Set<string>();
  const chavesVistas = new Map<string, number>(); // chave → duração (ms, 0 = ?)
  const marcar = (url: string, titulo: string | undefined, durMs: number): void => {
    const o = chaveDaOrigem(url);
    if (o) origensVistas.add(o);
    if (!titulo) return;
    for (const k of chavesDaProcurada({ titulo })) chavesVistas.set(k, durMs);
  };
  const jaVista = (url: string, titulo: string | undefined, durMs: number): boolean => {
    const o = chaveDaOrigem(url);
    if (o && origensVistas.has(o)) return true;
    if (!titulo) return false;
    return chavesDaProcurada({ titulo }).some((k) => {
      const d = chavesVistas.get(k);
      return d !== undefined && duracaoCompativel(d, durMs);
    });
  };
  for (const f of naFila) marcar(f.url, f.title, 0);

  const novas: T[] = [];
  const repetidas: Array<T & { motivo: 'biblioteca' | 'fila' }> = [];
  for (const e of entradas) {
    const durMs = (Number(e.duracaoSeg) || 0) * 1000;
    if (acharMesmaMusica(biblioteca, { url: e.url, titulo: e.title ?? '', durationMs: durMs })) {
      repetidas.push({ ...e, motivo: 'biblioteca' });
      continue;
    }
    if (jaVista(e.url, e.title, durMs)) {
      repetidas.push({ ...e, motivo: 'fila' });
      continue;
    }
    marcar(e.url, e.title, durMs);
    novas.push(e);
  }
  return { novas, repetidas };
}

// ── letra ───────────────────────────────────────────────────────────────────

/** Abaixo disto a letra não prova nada ("oh oh oh", refrão de uma linha). */
export const PALAVRAS_MINIMAS = 25;
/** Jaccard sobre trigramas de palavras a partir do qual é a mesma letra. */
export const LETRA_MINIMA = 0.8;

/** Palavras normalizadas da letra, sem marcações de seção ("[Refrão]"). */
export function palavrasDaLetra(texto: string): string[] {
  return normalizar(texto.replace(/\[[^\]]*\]/g, ' '))
    .split(' ')
    .filter(Boolean);
}

/**
 * Trigramas de palavras. Palavra solta é fraca demais (toda letra em pt-BR tem
 * "eu", "você", "amor"); trigramas guardam a ORDEM, então duas letras só se
 * parecem se as frases forem as mesmas.
 */
export function trigramas(palavras: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < palavras.length; i += 1) {
    out.add(`${palavras[i]} ${palavras[i + 1]} ${palavras[i + 2]}`);
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a];
  let comuns = 0;
  for (const x of menor) if (maior.has(x)) comuns += 1;
  return comuns / (a.size + b.size - comuns);
}

/** Semelhança (0..1) entre duas letras; 0 quando alguma é curta demais. */
export function semelhancaDeLetra(a: string, b: string): number {
  const pa = palavrasDaLetra(a);
  const pb = palavrasDaLetra(b);
  if (pa.length < PALAVRAS_MINIMAS || pb.length < PALAVRAS_MINIMAS) return 0;
  return jaccard(trigramas(pa), trigramas(pb));
}

/**
 * Tolerância de duração da camada de letra: maior que a da chave (o clipe tem
 * vinheta, o reupload corta o silêncio), mas curta demais para um sped up
 * (≥ 10% mais curto) passar: max(4 s, 5%), com teto de 20 s.
 */
export function duracaoPertoPelaLetra(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false; // sem duração, a letra sozinha não apaga nada
  const tol = Math.min(20_000, Math.max(4_000, Math.max(a, b) * 0.05));
  return Math.abs(a - b) <= tol;
}

export interface CandidataPorLetra {
  id: string;
  titulo: string;
  artistas: readonly string[];
  durationMs: number;
  letra: string;
}

/**
 * Pares que são a mesma música PELA LETRA — para quando o título não bateu
 * ("333" × "Três Três Três", o reupload com o nome errado).
 *
 * Quatro portões, todos obrigatórios, porque isto alimenta uma limpeza que
 * APAGA: mesmo artista principal (cover não é duplicata), mesmas marcas de
 * versão (ao vivo/remix/sped up têm a mesma letra e NÃO são a mesma faixa),
 * duração próxima e letra ≥ 0.8 em trigramas.
 *
 * Custo: só compara dentro do mesmo artista, e dentro dele em ordem de duração
 * — uma janela deslizante, não todos contra todos.
 */
export function paresPelaLetra(candidatas: readonly CandidataPorLetra[]): Array<[string, string]> {
  const porArtista = new Map<string, CandidataPorLetra[]>();
  for (const c of candidatas) {
    const a = artistaPrincipal(c.artistas[0] ?? '');
    if (!a || c.durationMs <= 0) continue;
    const lista = porArtista.get(a);
    if (lista) lista.push(c);
    else porArtista.set(a, [c]);
  }
  const trigramasDe = new Map<string, Set<string> | null>();
  const tri = (c: CandidataPorLetra): Set<string> | null => {
    if (!trigramasDe.has(c.id)) {
      const p = palavrasDaLetra(c.letra);
      trigramasDe.set(c.id, p.length >= PALAVRAS_MINIMAS ? trigramas(p) : null);
    }
    return trigramasDe.get(c.id) ?? null;
  };

  const pares: Array<[string, string]> = [];
  for (const lista of porArtista.values()) {
    if (lista.length < 2) continue;
    lista.sort((x, y) => x.durationMs - y.durationMs);
    for (let i = 0; i < lista.length; i += 1) {
      const a = lista[i]!;
      for (let j = i + 1; j < lista.length; j += 1) {
        const b = lista[j]!;
        if (!duracaoPertoPelaLetra(a.durationMs, b.durationMs)) break; // ordenado: os próximos estão mais longe
        if (versoesDoTitulo(a.titulo).join('+') !== versoesDoTitulo(b.titulo).join('+')) continue;
        const ta = tri(a);
        const tb = tri(b);
        if (!ta || !tb) continue;
        if (jaccard(ta, tb) >= LETRA_MINIMA) pares.push([a.id, b.id]);
      }
    }
  }
  return pares;
}
