/**
 * Catálogo dos modelos NVIDIA que o Aurial usa, e a política de qual vai em
 * cada tarefa.
 *
 * POR QUE ISSO EXISTE: até aqui TODA chamada ia no `nemotron-3-ultra-550b`,
 * inclusive a que responde uma palavra ("SIM"/"NAO"). Medindo os candidatos
 * contra a nossa própria chave (2026-08-03, servidor de produção):
 *
 *   tarefa de veredito, 5 atribuições corretas + 2 erradas
 *     nemotron-3-nano-30b-a3b    ~3,0s   0 falsos-positivos, pegou os 2 erros
 *     nemotron-3-super-120b-a12b ~2,7s   0 falsos-positivos, pegou os 2 erros
 *     nemotron-mini-4b-instruct  ~0,3s   0 falsos-positivos, PERDEU os 2 erros
 *     nvidia-nemotron-nano-9b-v2 ~3,5s   DISSE "NAO" PARA ATRIBUIÇÃO CORRETA
 *
 *   identidade da faixa, 4 títulos bagunçados
 *     super-120b   1,4–3,9s    JSON idêntico ao ultra nos 4
 *     ultra-550b   4,5–16,6s   idem, só devolveu o título com capitalização melhor
 *
 * Duas conclusões viraram regra aqui: (1) o `nano-9b-v2` está BANIDO da
 * auditoria — falso-positivo não deixa a metadata como está, ele reescreve
 * metadata correta, que é o pior desfecho possível; (2) o Ultra deixa de ser o
 * padrão e passa a ser escalação, porque pagar 4× o tempo por uma resposta
 * igual é só lentidão.
 *
 * O `mini-4b` é dez vezes mais rápido e não erra para mais — mas responde
 * "INCERTO" justamente nos casos errados, e "incerto" faz o worker não mexer.
 * Um porteiro que nunca acusa nada não filtra nada; por isso ele não é o
 * auditor, mesmo sendo o mais barato.
 */

/** Modelos de chat, do mais barato ao mais caro. */
export const CHAT_MODELS = {
  /** Uma palavra, classificação simples. ~0,3s. Recall fraco em erro. */
  mini: 'nvidia/nemotron-mini-4b-instruct',
  /** Veredito e classificação com recall bom. ~3s. */
  nano: 'nvidia/nemotron-3-nano-30b-a3b',
  /** Raciocínio de verdade (identidade, desambiguação). ~2s. */
  super: 'nvidia/nemotron-3-super-120b-a12b',
  /** Escalação: só quando o `super` devolve nada aproveitável. ~4–17s. */
  ultra: 'nvidia/nemotron-3-ultra-550b-a55b',
  /** Texto de vitrine (descrição de mix, bio). */
  creative: 'writer/palmyra-creative-122b',
} as const;

/**
 * Segurança de conteúdo. Devolve JSON
 * `{"User Safety":"safe|unsafe","Safety Categories":"a, b"}` — medido, não
 * suposto. O `nemotron-3.5-content-safety` responde só "User Safety: unsafe",
 * sem categorias, e o `llama-guard-4-12b` estourou 2min de timeout na sondagem.
 */
export const SAFETY_MODEL = 'nvidia/llama-3.1-nemoguard-8b-content-safety';

/**
 * Embeddings de texto — 2048 dimensões, ~240ms. É o mesmo modelo que o
 * importer já usa no `/ai/embed`, então navegador e servidor produzem vetores
 * no MESMO espaço e dá para comparar um com o outro.
 */
export const EMBED_MODEL = 'nvidia/llama-nemotron-embed-1b-v2';
export const EMBED_DIMS = 2048;

/**
 * Tradução (letras). ATENÇÃO ao formato: este modelo IGNORA instrução em
 * `system` — com "Translate to Portuguese" no system ele devolve o texto
 * original em inglês, sem erro nenhum, e a tradução some sem ninguém notar.
 * A instrução TEM que ir na mensagem do usuário. Use `translateMessages()`.
 */
export const TRANSLATE_MODEL = 'nvidia/riva-translate-4b-instruct-v2';

export type ChatTier = keyof typeof CHAT_MODELS;

/** Tarefas que os agentes executam, e o degrau de modelo de cada uma. */
export const TASK_TIER = {
  verify: 'nano',
  genre: 'nano',
  // O gênero do ARTISTA é conhecimento de mundo ("quem é o Alee?"), não leitura
  // de uma faixa — a mesma classe de tarefa que a identidade, e por isso o mesmo
  // degrau. O `nano` classifica uma música pelo nome; saber a carreira de um
  // artista pede o modelo que raciocina.
  artistGenre: 'super',
  cleanTitle: 'nano',
  splitArtists: 'super',
  identity: 'super',
  describe: 'creative',
} as const satisfies Record<string, ChatTier>;

export type AiTask = keyof typeof TASK_TIER;

/** Modelo padrão de uma tarefa. */
export function modelFor(task: AiTask): string {
  return CHAT_MODELS[TASK_TIER[task]];
}

/**
 * Modelo de escalação: o degrau acima, quando existir. Usado quando a primeira
 * tentativa volta vazia ou impossível de parsear — não para "melhorar" uma
 * resposta que já veio boa.
 */
export function escalationFor(task: AiTask): string | null {
  const ladder: ChatTier[] = ['mini', 'nano', 'super', 'ultra'];
  const current = ladder.indexOf(TASK_TIER[task]);
  if (current === -1 || current === ladder.length - 1) return null;
  return CHAT_MODELS[ladder[current + 1]!];
}
