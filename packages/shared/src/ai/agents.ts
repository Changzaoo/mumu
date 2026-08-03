/**
 * Os agentes novos do time: segurança, DNA da faixa, tradução e vitrine.
 *
 * Os quatro antigos (auditor, identificador, generista, limpador de título)
 * seguem em `curation.ts` — este arquivo é a leva que faltava para o app se
 * cuidar sozinho, e mantém o mesmo contrato: função pura que monta mensagem,
 * função pura que lê resposta. Nada de rede aqui.
 */
import { GENRE_TAXONOMY, extractJson, type AiMessage } from './curation.js';

// ── Agente: guardião de conteúdo ────────────────────────────────────────────

/**
 * Rótulo de conteúdo de uma faixa. `explicit` é o "E" que o Spotify mostra
 * ao lado do nome — a diferença é que aqui ele sai da letra, não de um campo
 * que a gravadora preencheu.
 */
export interface ContentRating {
  explicit: boolean;
  /** Categorias devolvidas pelo NemoGuard (violência, palavrão, drogas…). */
  categories: string[];
}

/**
 * O NemoGuard classifica a ÚLTIMA mensagem do usuário. Mandamos a letra como
 * se fosse fala do usuário porque é exatamente isso que ele sabe julgar; um
 * system prompt nosso por cima só atrapalharia o formato de saída dele.
 */
export function safetyMessages(title: string, lyrics: string): AiMessage[] {
  // Letra inteira estoura o contexto e não muda o veredito: um refrão pesado
  // já aparece nos primeiros milhares de caracteres.
  const trecho = lyrics.slice(0, 4000);
  return [{ role: 'user', content: `Letra da música "${title}":\n\n${trecho}` }];
}

/**
 * Lê `{"User Safety":"safe|unsafe","Safety Categories":"a, b"}`.
 *
 * Devolve `null` quando não deu para entender a resposta — e isso importa:
 * marcar uma faixa como explícita por engano esconde ela do usuário. Sem
 * certeza, ninguém rotula nada.
 */
export function parseSafety(content: string): ContentRating | null {
  const json = extractJson(content) as Record<string, unknown> | null;

  const veredito = json?.['User Safety'] ?? json?.['User safety'] ?? json?.['user_safety'];
  if (typeof veredito === 'string') {
    const unsafe = veredito.trim().toLowerCase() === 'unsafe';
    const raw = json?.['Safety Categories'] ?? json?.['Safety categories'] ?? '';
    const categories =
      typeof raw === 'string'
        ? raw
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : [];
    return { explicit: unsafe, categories };
  }

  // O `nemotron-3.5-content-safety` responde em texto puro ("User Safety:
  // unsafe"), sem JSON. Vale aceitar para poder trocar de modelo sem reescrever
  // o parser.
  const texto = content.toLowerCase();
  if (texto.includes('unsafe')) return { explicit: true, categories: [] };
  if (texto.includes('safe')) return { explicit: false, categories: [] };
  return null;
}

// ── Agente: DNA da faixa (embeddings) ───────────────────────────────────────

/**
 * O texto que vira vetor. A ordem é deliberada — título e artista primeiro,
 * porque os modelos de embedding pesam mais o começo da frase, e é por eles
 * que uma busca por "aquela do Matuê" tem que casar.
 */
export function trackEmbeddingText(input: {
  title: string;
  artists: string[];
  album?: string | null;
  genre?: string | null;
}): string {
  const partes = [input.title, input.artists.join(', ')];
  if (input.album) partes.push(input.album);
  if (input.genre) partes.push(input.genre);
  return partes.filter(Boolean).join(' — ');
}

/** Cosseno entre dois vetores. 1 = idênticos, 0 = sem relação. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Agente: tradutor de letras ──────────────────────────────────────────────

export const TRANSLATE_TARGETS = {
  pt: 'Portuguese',
  en: 'English',
  es: 'Spanish',
} as const;

export type TranslateTarget = keyof typeof TRANSLATE_TARGETS;

/**
 * ATENÇÃO: a instrução vai na mensagem do USUÁRIO, não em `system`.
 *
 * Medido em 2026-08-03: com "Translate to Portuguese" num system prompt, o
 * `riva-translate-4b-instruct-v2` devolve o texto ORIGINAL em inglês, com
 * status 200 e sem aviso nenhum. A falha é muda — a tradução simplesmente não
 * acontece. Com a instrução inline no user, traduz certo. Não "simplifique"
 * isto movendo a instrução para system.
 */
export function translateMessages(text: string, target: TranslateTarget): AiMessage[] {
  return [{ role: 'user', content: `Translate to ${TRANSLATE_TARGETS[target]}: ${text}` }];
}

/** O modelo devolve só a tradução. Sobra limpar cerca de markdown. */
export function parseTranslation(content: string): string | null {
  const limpo = content
    .replace(/```[a-z]*/gi, '')
    .replace(/```/g, '')
    .trim();
  return limpo.length > 0 ? limpo : null;
}

// ── Agente: redator de vitrine ──────────────────────────────────────────────

/**
 * A frase que aparece embaixo do nome de um mix ("Seu sertanejo de todo dia,
 * com Marília e Henrique & Juliano"). Hoje esses cartões têm título e mais
 * nada.
 */
export function describeMixMessages(input: {
  nome: string;
  genero?: string | null;
  artistas: string[];
}): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você escreve a descrição curta de uma playlist de música, no estilo do Spotify. ' +
        'UMA frase, no máximo 90 caracteres, em português do Brasil. ' +
        'Pode citar artistas da lista. Não use aspas, não use emoji, não repita o nome da playlist. ' +
        'Responda apenas com a frase.',
    },
    {
      role: 'user',
      content:
        `Playlist: "${input.nome}"` +
        (input.genero ? `\nGênero: ${input.genero}` : '') +
        (input.artistas.length > 0 ? `\nArtistas: ${input.artistas.slice(0, 8).join(', ')}` : ''),
    },
  ];
}

/**
 * Pega a última linha não vazia: modelo de raciocínio escreve antes de
 * concluir, e a frase de vitrine é a conclusão. Mesma armadilha que derrubou
 * os parsers de `curation.ts` — quem lê a PRIMEIRA linha lê o rascunho.
 */
export function parseDescription(content: string): string | null {
  const linhas = content
    .split('\n')
    .map((l) => l.replace(/^["'\s]+|["'\s]+$/g, ''))
    .filter((l) => l.length > 0);
  const ultima = linhas.at(-1);
  if (!ultima || ultima.length > 200) return null;
  return ultima;
}

// ── Agente: detetive de gênero em lote ──────────────────────────────────────

/**
 * Classificar 20 faixas numa chamada em vez de 20 chamadas. O gênero é a
 * tarefa mais repetitiva do time e a que menos precisa de contexto por item —
 * é onde o lote paga.
 */
export function batchGenreMessages(tracks: { title: string; artist: string }[]): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você classifica músicas em gêneros. Para CADA música da lista, escolha UM gênero desta ' +
        `lista EXATA: ${GENRE_TAXONOMY.join(', ')}. ` +
        'Responda SOMENTE com um array JSON de strings, um gênero por música, na MESMA ORDEM e ' +
        'com o MESMO tamanho da lista recebida. Use null quando não souber. Sem markdown.',
    },
    {
      role: 'user',
      content: tracks.map((t, i) => `${i + 1}. "${t.title}" — ${t.artist}`).join('\n'),
    },
  ];
}

/**
 * Devolve um array do mesmo tamanho da entrada. Se o modelo devolver quantidade
 * diferente, a correspondência por índice deixou de valer e tudo vira `null` —
 * gênero trocado entre faixas é pior que gênero faltando.
 */
export function parseBatchGenres(content: string, expected: number): (string | null)[] {
  const vazio = Array.from({ length: expected }, () => null) as (string | null)[];
  const json = extractJson(content);
  if (!Array.isArray(json) || json.length !== expected) return vazio;

  return json.map((item) => {
    if (typeof item !== 'string') return null;
    const alvo = item.trim().toLowerCase();
    return GENRE_TAXONOMY.find((g) => g.toLowerCase() === alvo) ?? null;
  });
}
