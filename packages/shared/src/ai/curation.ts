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
  // Samba e Axé faltavam numa biblioteca brasileira, e falta de rótulo não
  // deixa a faixa sem categoria: empurra para a categoria vizinha errada (samba
  // virando Pagode ou MPB). São gêneros que a própria Apple devolve.
  'Samba',
  'Axé',
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
 *
 * MEDIDO em produção (2026-08-03), e o número é contraintuitivo: o
 * `nemotron-3-nano-30b` gastou 875 tokens de raciocínio para responder "SIM",
 * enquanto o `super-120b` resolveu o mesmo caso em 412. Modelo menor pensa MAIS
 * alto, não menos — ele precisa de mais passos para chegar onde o grande chega
 * direto.
 *
 * Com `verify` em 1024 o teto estourava no meio do raciocínio: a resposta vinha
 * truncada, era descartada (certo — meia conclusão não vira metadata) e a faixa
 * ficava sem auditoria nenhuma. Foram 13 descartes numa hora de operação.
 * Teto alto não custa: só se paga o token que o modelo realmente gerou.
 */
export const AI_BUDGET = {
  verify: 2048,
  genre: 2048,
  cleanTitle: 2048,
  splitArtists: 2048,
  identity: 3072,
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

/**
 * true = confirmado, false = claramente errado, null = incerto (não mexer).
 *
 * "NÃO SEI" NÃO É "NÃO".
 *
 * Esta função lia qualquer "nao" solto como acusação, e em português a dúvida
 * começa com a mesma palavra: "não sei", "não conheço essa música", "não tenho
 * certeza". Todas devolviam `false` — e `false` é o ÚNICO veredito que autoriza
 * escrever por cima. Ou seja, exatamente quando o modelo admitia ignorância, o
 * sistema entendia "está errado, corrija" e reescrevia metadata correta com um
 * palpite.
 *
 * Isso valia para os dois auditores que dependem daqui: o de atribuição (que
 * troca o ARTISTA da faixa) e o de categoria. É o caminho mais curto que existe
 * neste código entre "o modelo não sabe" e "o usuário vê a coisa errada".
 *
 * Agora a hesitação é reconhecida ANTES e vira incerteza, que é o que ela é.
 */
export function parseVerify(content: string): boolean | null {
  const normalized = content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // A hesitação some da frase antes de procurar o veredito. Sem isto, o "nao"
  // de "nao sei" seria contado como a resposta.
  const semHesitacao = normalized.replace(
    /\bnao\s+(sei|conheco|tenho|consigo|posso|da|e|estou|ha)\b/g,
    ' incerto ',
  );
  // Um modelo de raciocínio pode escrever antes de concluir; a decisão é a
  // ÚLTIMA palavra reconhecível, não a primeira.
  const matches = semHesitacao.match(/\b(sim|nao|incerto)\b/g);
  const last = matches?.at(-1);
  if (last === 'sim') return true;
  if (last === 'nao') return false;
  return null;
}

// ── Agente: auditoria de gênero ─────────────────────────────────────────────

/**
 * "Esta faixa é MESMO desse gênero?" — a pergunta que faltava.
 *
 * A curadoria só sabia PREENCHER gênero vazio. Faixa já categorizada, ainda que
 * categorizada errado, nunca mais era olhada: o trap continuava na prateleira de
 * sertanejo para sempre, porque ninguém perguntava.
 *
 * O formato copia o auditor de atribuição de propósito — é o padrão prudente que
 * já funciona aqui: uma palavra, três respostas, e SÓ o "NAO" autoriza mexer.
 * Um "INCERTO" que reescrevesse categoria seria um palpite com cara de conserto,
 * e reclassificar em cima de uma categoria certa é o estrago que o usuário não
 * consegue desfazer — ele nem fica sabendo que mudou.
 */
export function verifyGenreMessages(title: string, artist: string, genre: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você confere se a CATEGORIA de uma música está correta. ' +
        `Definições que você DEVE seguir: ${GLOSSARIO_DE_GENEROS} ` +
        'Responda com UMA palavra apenas: SIM (a categoria está certa), ' +
        'NAO (está claramente errada), ou INCERTO (não conhece a música ou tem dúvida). ' +
        'Na dúvida responda INCERTO — é melhor que trocar uma categoria certa. ' +
        'Sem nada além da palavra.',
    },
    { role: 'user', content: `A música "${title}", de "${artist}", é do gênero "${genre}"?` },
  ];
}

// ── Agente: classificação de gênero ─────────────────────────────────────────

/**
 * O MODELO PRECISA PODER DIZER "NÃO SEI".
 *
 * A primeira versão deste prompt mandava escolher UM gênero da lista e
 * responder só com ele. Não havia saída: diante de uma faixa que o modelo nunca
 * viu — justamente o caso do acervo, cheio de artista independente — a única
 * resposta possível era um palpite pelo clima do título. E palpite entra no app
 * como fato: vira a prateleira de gênero, o mix e a recomendação.
 *
 * Agora DESCONHECIDO é uma resposta legítima e explicitamente preferida à
 * adivinhação. Faixa sem categoria é um buraco visível que a curadoria pode
 * preencher depois; faixa na categoria errada é uma mentira que ninguém revisa.
 */
/**
 * O GLOSSÁRIO EXISTE PORQUE OS ERROS RELATADOS ERAM SEMPRE OS MESMOS PARES.
 *
 * Trap indo para Lo-Fi, trap indo para Sertanejo, funk/gospel/sertanejo se
 * embaralhando. Não é aleatório: são rótulos que colidem quando o modelo lê só
 * o nome da categoria, sem saber o que ela significa AQUI.
 *
 *  - "Funk", para um modelo treinado em inglês, é James Brown. No Brasil é funk
 *    carioca — outra música inteira, com outro público.
 *  - "Lo-Fi" não é um estilo de canção, é uma estética de produção instrumental.
 *    Um trap com rapper na frente não vira Lo-Fi porque a base é crua — e era
 *    exatamente esse o erro.
 *  - "Sertanejo" e "Trap" não se parecem em nada, mas ambos são o rótulo
 *    "brasileiro genérico" na cabeça de quem não conhece a faixa. Sem definição,
 *    o modelo escolhe o mais famoso.
 *
 * Definir custa algumas dezenas de tokens e remove a colisão na origem.
 */
export const GLOSSARIO_DE_GENEROS = [
  'Funk = funk carioca/brasileiro (baile funk, MC, batida de tamborzão). NÃO é o funk/soul americano — esse é R&B/Soul.',
  'Trap = 808 grave, hi-hats rápidos, flow cantado/arrastado; inclui trap brasileiro. Se tem rapper ou cantor na frente, é Trap ou Hip-Hop/Rap, NUNCA Lo-Fi.',
  'Lo-Fi = INSTRUMENTAL de estudo/relaxar, chiado e batida crua, sem vocal protagonista. Se a faixa tem letra cantada ou rimada, NÃO é Lo-Fi.',
  'Hip-Hop/Rap = rap, boom bap, rap nacional. Use Trap só quando a produção for de trap.',
  'Sertanejo = dupla sertaneja, viola/acordeão, sofrência, universitário, arrocha. NÃO use para faixa com 808 e rap.',
  'Gospel = louvor e adoração cristã (a LETRA é religiosa), qualquer que seja a batida.',
  'Pagode = pagode e samba de roda moderno; Samba = samba tradicional, escola de samba.',
  'Forró = forró, piseiro, brega nordestino; Axé = axé baiano, carnaval.',
  'MPB = música popular brasileira de compositor (Chico, Caetano, Djavan e herdeiros).',
].join(' ');

export function genreMessages(title: string, artist?: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Você classifica uma música em UM gênero musical desta lista EXATA: ' +
        `${GENRE_TAXONOMY.join(', ')}. ` +
        `Definições que você DEVE seguir: ${GLOSSARIO_DE_GENEROS} ` +
        'Se você NÃO CONHECE esta música ou este artista, responda exatamente DESCONHECIDO. ' +
        'Nunca deduza o gênero pelo clima do título — é preferível responder DESCONHECIDO ' +
        'a arriscar uma categoria errada. ' +
        'Responda SOMENTE com o nome do gênero (ou DESCONHECIDO), sem explicação.',
    },
    { role: 'user', content: `Música: "${title}"${artist ? ` — Artista: ${artist}` : ''}` },
  ];
}

/** Compara rótulos ignorando acento e pontuação: "Hip Hop/Rap" = "Hip-Hop/Rap". */
function chaveDeGenero(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Lê a resposta do classificador — e RECUSA tudo que não for uma resposta.
 *
 * A versão anterior procurava qualquer nome da taxonomia em qualquer lugar do
 * texto. Com um modelo de raciocínio, que escreve o pensamento antes de
 * concluir, isso lia o rascunho como se fosse a decisão: "não é Rock, soa mais
 * como trap nordestino" virava Rock, e "não conheço, talvez Pop" virava Pop.
 * Uma recusa do modelo era transformada em categoria pelo nosso parser.
 *
 * Agora só conta a ÚLTIMA linha — onde a conclusão fica — e ela precisa ser o
 * rótulo inteiro, não uma menção dentro de uma frase. Qualquer outra coisa vira
 * `null`, que deixa a faixa sem categoria e agenda nova tentativa.
 */
export function parseGenre(content: string): Genre | null {
  const linhas = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const conclusao = linhas[linhas.length - 1] ?? '';
  const limpa = conclusao
    .replace(/^(g[eê]nero|resposta|answer|final)\s*[:\-–]\s*/i, '')
    .replace(/^[\s*_`"'[(]+|[\s*_`"'.\])]+$/g, '')
    .trim();
  if (!limpa) return null;
  const chave = chaveDeGenero(limpa);
  if (!chave) return null;
  // "Não sei" é uma resposta boa: preserva o buraco em vez de inventar.
  if (/^(desconhecido|naosei|naoconheco|unknown|none|na)$/.test(chave)) return null;
  return GENRE_TAXONOMY.find((g) => chaveDeGenero(g) === chave) ?? null;
}
