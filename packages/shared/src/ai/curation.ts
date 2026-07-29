/**
 * Prompts e parsers dos agentes de curadoria de metadata.
 *
 * Vivem aqui porque DOIS lugares rodam os mesmos agentes: o navegador
 * (`apps/web/src/lib/ai/ai.ts`, enquanto o app está aberto) e o worker do
 * servidor (`apps/api/src/workers/curation.worker.ts`, 24/7). Se cada lado
 * tivesse sua cópia do prompt, os dois divergiriam e a mesma faixa receberia
 * respostas diferentes conforme quem a processou — que é justamente o tipo de
 * inconsistência que faz nome de artista ficar errado.
 *
 * Tudo aqui é função pura: monta mensagem, lê resposta. Nada de rede.
 */

/** Taxonomia fechada de gêneros (rótulos pt-BR). */
export const GENRE_TAXONOMY = [
  'Pop',
  'Hip-Hop/Rap',
  'Trap',
  'Funk',
  'Sertanejo',
  'MPB',
  'Pagode',
  'Forró',
  'Gospel',
  'Rock',
  'R&B/Soul',
  'Eletrônica',
  'Dance',
  'Reggae',
  'Reggaeton',
  'Country',
  'Jazz',
  'Blues',
  'Clássica',
  'Metal',
  'Indie',
  'Lo-Fi',
  'Latina',
] as const;

export type Genre = (typeof GENRE_TAXONOMY)[number];

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TrackIdentity {
  title: string;
  /** Todos os artistas distintos, principal primeiro. Nunca fundidos num só. */
  artists: string[];
  album: string | null;
  genre: string | null;
}

/**
 * Modelos de raciocínio (Nemotron) gastam tokens pensando antes de responder,
 * e esse gasto sai do mesmo teto da resposta. Por isso os orçamentos são
 * generosos mesmo para saídas de uma palavra — o custo é o raciocínio.
 */
export const AI_BUDGET = {
  verify: 1024,
  genre: 1024,
  cleanTitle: 1536,
  splitArtists: 1536,
  identity: 2048,
} as const;

// ── Limpeza de resposta ─────────────────────────────────────────────────────

/**
 * Extrai o JSON de uma resposta que pode vir embrulhada em markdown ou
 * precedida de raciocínio. Procura o primeiro objeto/array balanceado em vez
 * de confiar que o modelo obedeceu ao "responda só JSON".
 */
export function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Segue para a varredura balanceada abaixo.
  }

  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

// ── Agente: identidade da faixa ─────────────────────────────────────────────

export function identityMessages(rawTitle: string, currentArtist?: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você é um especialista em identificar músicas com precisão. Dado um título (às vezes ' +
        'bagunçado, de vídeo do YouTube) e possivelmente um artista (que pode estar errado), ' +
        'identifique a MÚSICA REAL e responda SOMENTE com JSON: ' +
        '{"title":"...","artists":["principal","participação",...],"album":null,"genre":null}. ' +
        'REGRAS OBRIGATÓRIAS: (1) liste TODOS os artistas distintos como itens SEPARADOS do array, ' +
        'na ordem correta (principal primeiro, depois feats/participações); NUNCA junte dois ' +
        'artistas num nome só. (2) Mantenha grupos/duplas reais como UM item ("AC/DC", ' +
        '"Tyler, The Creator", "Simon & Garfunkel"). (3) "title" limpo, sem "(Official Video)" etc. ' +
        `(4) "genre" deve ser um destes ou null: ${GENRE_TAXONOMY.join(', ')}. ` +
        '(5) Se não tiver certeza do álbum ou gênero, use null. Sem markdown, sem texto extra.',
    },
    {
      role: 'user',
      content: `Título: "${rawTitle}"${currentArtist ? `\nArtista atual (pode estar errado): ${currentArtist}` : ''}`,
    },
  ];
}

export function parseIdentity(content: string): TrackIdentity | null {
  const json = extractJson(content) as {
    title?: unknown;
    artists?: unknown;
    album?: unknown;
    genre?: unknown;
  } | null;
  if (!json || typeof json.title !== 'string' || !json.title.trim()) return null;

  const artists = Array.isArray(json.artists)
    ? json.artists
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim())
    : [];
  if (artists.length === 0) return null;

  const genre =
    typeof json.genre === 'string'
      ? (GENRE_TAXONOMY.find((g) => g.toLowerCase() === json.genre!.toString().toLowerCase()) ??
        null)
      : null;

  return {
    title: json.title.trim(),
    artists,
    album: typeof json.album === 'string' && json.album.trim() ? json.album.trim() : null,
    genre,
  };
}

// ── Agente: auditoria de atribuição ─────────────────────────────────────────

export function verifyMessages(title: string, artist: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você confere se a atribuição de uma música está correta na vida real. ' +
        'Responda com UMA palavra apenas: SIM (a música é realmente desse(s) artista(s)), ' +
        'NAO (claramente NÃO é), ou INCERTO (sem certeza). Sem nada além da palavra.',
    },
    { role: 'user', content: `A música "${title}" é de "${artist}"?` },
  ];
}

/** true = confirmado, false = claramente errado, null = incerto (não mexer). */
export function parseVerify(content: string): boolean | null {
  // Um modelo de raciocínio pode escrever antes de concluir; a decisão é a
  // ÚLTIMA palavra reconhecível, não a primeira.
  const normalized = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const matches = normalized.match(/\b(sim|nao|incerto)\b/g);
  const last = matches?.at(-1);
  if (last === 'sim') return true;
  if (last === 'nao') return false;
  return null;
}

// ── Agente: classificação de gênero ─────────────────────────────────────────

export function genreMessages(title: string, artist?: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você classifica uma música em UM gênero musical desta lista EXATA: ' +
        `${GENRE_TAXONOMY.join(', ')}. ` +
        'Responda SOMENTE com o nome do gênero, exatamente como está na lista — sem texto extra.',
    },
    { role: 'user', content: `Música: "${title}"${artist ? ` — Artista: ${artist}` : ''}` },
  ];
}

export function parseGenre(content: string): Genre | null {
  const normalized = content.toLowerCase();
  // Casa o rótulo mais longo primeiro para "Hip-Hop/Rap" não perder para "Rap".
  const ordered = [...GENRE_TAXONOMY].sort((a, b) => b.length - a.length);
  return ordered.find((g) => normalized.includes(g.toLowerCase())) ?? null;
}
