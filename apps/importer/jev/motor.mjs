/**
 * O MOTOR DE DECISÃO — o "Jev nosso".
 *
 * Um modelo de decisão tipada: recebe um ESTADO (texto) e PERGUNTAS tipadas, e
 * devolve, em vez de prosa, uma decisão com probabilidade calibrada para cada
 * uma. Os três tipos (mesmo contrato do Jev da TypeSafe, para quem conhece):
 *
 *   choice — escolhe UMA entre as opções de `criteria` {rótulo: descrição} e
 *            devolve a probabilidade de cada rótulo e a confiança;
 *   score  — posição numa escala ordenada (`criteria` é uma lista, a posição é
 *            a nota) e devolve a nota esperada + a probabilidade de cada nível;
 *   noul   — sim/não com probabilidade de 0 a 1.
 *
 * Como decide, sem rede e sem LLM:
 *
 *   1. ZERO-SHOT: o estado e cada critério viram vetores (embeddings locais,
 *      ver embeddings.mjs). A semelhança de cosseno entre estado e critério vira
 *      probabilidade por um softmax com temperatura. É o que responde qualquer
 *      pergunta nova, sem exemplo nenhum.
 *
 *   2. MEMÓRIA (kNN): quando a pergunta já tem exemplos rotulados (ver
 *      memoria.mjs — o gênero tem ~10 mil faixas curadas do acervo), os k
 *      vizinhos mais parecidos VOTAM, com peso pela semelhança. Voto de
 *      vizinho é evidência muito mais forte do que a descrição de um rótulo:
 *      "MC Kevin" perto de 200 faixas de Funk é Funk, por mais que o título não
 *      diga nada.
 *
 *   3. MISTURA: a memória pesa tanto quanto a sua evidência (quantos vizinhos
 *      realmente parecidos existem); o zero-shot cobre o resto. Com memória
 *      forte o zero-shot some; sem memória o zero-shot é tudo.
 *
 * A CONFIANÇA é a margem entre a melhor e a segunda opção (0–1): "0,9" é
 * decisão clara, "0,1" é cara ou coroa. É ela que quem chama usa para decidir
 * se aceita a resposta ou cai para um juiz mais caro (o LLM da NVIDIA).
 *
 * CALIBRADO EM 20/10/2026 (jev/calibrar.mjs, leave-one-out sobre 6.105 faixas
 * com gênero curado, amostra de 3.053, 26 gêneros): k=5, tau=0,05,
 * semelhança mínima 0,85 → 79,6% de acerto geral. Por confiança: ≥0,2 acerta
 * 96% (metade das faixas), <0,2 acerta 65%. Daí o corte de 0,2 no app. Por
 * gênero: Funk 93%, Trap 90%, Rap 88%, Rock 87%, Pop 83%; os raros (Dance,
 * Eletrônica, R&B, Indie, Metal, com dezenas de exemplos) ficam entre 20 e
 * 35% — é onde o LLM continua necessário até a memória crescer.
 *
 * Tudo aqui é puro: recebe `embed` (texto[] → vetor[]) e `memoria` por
 * injeção, para os testes rodarem sem modelo e sem disco.
 */

/** Temperatura do softmax zero-shot (cosseno entre -1 e 1 é um sinal fraco). */
export const TAU_ZERO_SHOT = 0.05;
/** Temperatura dos votos da memória: vizinho mais perto pesa mais. */
export const TAU_MEMORIA = 0.05;
/** Quantos vizinhos votam. */
export const K_VIZINHOS = 5;
/**
 * Abaixo desta semelhança um vizinho não conta como evidência: é "parecido" só
 * por ser texto no mesmo idioma. Medido com multilingual-e5-small sobre o
 * acervo: o vizinho mais próximo do MESMO gênero tem semelhança p10/p50/p90 =
 * 0,893/0,926/0,976; de OUTRO gênero, 0,872/0,901/0,968 — o cosseno do e5 é
 * comprimido, e 0,85 foi o corte que a varredura da calibração escolheu.
 */
export const SEMELHANCA_MINIMA = 0.85;

export function cosseno(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/** Softmax com temperatura, estável numericamente. */
export function softmax(valores, tau) {
  const maior = Math.max(...valores);
  const exps = valores.map((v) => Math.exp((v - maior) / tau));
  const soma = exps.reduce((s, e) => s + e, 0);
  return exps.map((e) => e / soma);
}

/** Margem entre a melhor e a segunda probabilidade (0–1). */
export function confiancaDe(probabilidades) {
  const ordenadas = Object.values(probabilidades).sort((x, y) => y - x);
  return Math.max(0, Math.min(1, (ordenadas[0] ?? 0) - (ordenadas[1] ?? 0)));
}

/** Texto de um critério: string, objeto ou lista viram uma frase. */
export function textoDoCriterio(valor, rotulo = '') {
  if (valor === null || valor === undefined) return rotulo;
  if (typeof valor === 'string') return rotulo ? `${rotulo}: ${valor}` : valor;
  if (Array.isArray(valor))
    return [rotulo, ...valor.map((v) => textoDoCriterio(v))].filter(Boolean).join('; ');
  if (typeof valor === 'object') {
    const partes = Object.entries(valor).map(([k, v]) => `${k}: ${textoDoCriterio(v)}`);
    return [rotulo, ...partes].filter(Boolean).join('; ');
  }
  return `${rotulo}: ${String(valor)}`;
}

/** O estado como texto único (string, objeto ou lista). */
export function textoDoEstado(state) {
  if (typeof state === 'string') return state;
  if (Array.isArray(state)) return state.map((s) => textoDoEstado(s)).join('\n');
  if (state && typeof state === 'object') {
    return Object.entries(state)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');
  }
  return String(state ?? '');
}

/**
 * Votos da memória: probabilidade por rótulo a partir dos vizinhos, e quanta
 * evidência há (soma dos pesos dos vizinhos acima da semelhança mínima,
 * normalizada para 0–1). `vizinhos` = [{ rotulo, semelhanca }], já os k melhores.
 */
export function votosDaMemoria(
  vizinhos,
  rotulos,
  { tau = TAU_MEMORIA, minimo = SEMELHANCA_MINIMA } = {},
) {
  const uteis = vizinhos.filter((v) => v.semelhanca >= minimo && rotulos.includes(v.rotulo));
  const probabilidades = Object.fromEntries(rotulos.map((r) => [r, 0]));
  if (uteis.length === 0) return { probabilidades, evidencia: 0 };
  const pesos = uteis.map((v) => Math.exp((v.semelhanca - 1) / tau));
  const soma = pesos.reduce((s, p) => s + p, 0);
  uteis.forEach((v, i) => {
    probabilidades[v.rotulo] += pesos[i] / soma;
  });
  // Evidência: a soma dos pesos (cada um entre 0 e 1, 1 = idêntico), saturando
  // em 3 — três vizinhos idênticos, ou uns dez muito parecidos, já bastam para
  // a memória mandar sozinha.
  const evidencia = Math.min(1, pesos.reduce((s, p) => s + p, 0) / 3);
  return { probabilidades, evidencia };
}

/** Mistura memória e zero-shot pela evidência da memória. */
export function misturar(zeroShot, memoria) {
  const saida = {};
  for (const r of Object.keys(zeroShot)) {
    saida[r] =
      memoria.evidencia * (memoria.probabilidades[r] ?? 0) + (1 - memoria.evidencia) * zeroShot[r];
  }
  return saida;
}

/**
 * Responde todas as perguntas sobre um estado.
 *
 * @param {{ state: unknown, questions: Record<string, object> }} pedido
 * @param {{
 *   embed: (textos: string[]) => Promise<number[][]>,
 *   memoria?: { vizinhos: (pergunta: string, vetor: number[], k: number) => Promise<Array<{rotulo: string, semelhanca: number}>> } | null,
 *   tauZeroShot?: number,
 * }} deps
 */
export async function decidir(pedido, { embed, memoria = null, tauZeroShot = TAU_ZERO_SHOT }) {
  const perguntas = Object.entries(pedido.questions ?? {});
  if (perguntas.length === 0) throw new Error('questions vazio');
  for (const [nome, q] of perguntas) validarPergunta(nome, q);

  // UM lote de embeddings para tudo: estado + todos os critérios de todas as
  // perguntas. É o que faz várias perguntas custarem quase o mesmo que uma.
  const textos = [textoDoEstado(pedido.state)];
  const indices = perguntas.map(([, q]) => {
    const criterios = criteriosDe(q);
    const inicio = textos.length;
    for (const c of criterios) textos.push(c.texto);
    return { criterios, inicio };
  });
  const vetores = await embed(textos);
  const vEstado = vetores[0];

  const answers = {};
  const usage = {
    input_tokens: textos.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
    output_tokens: 0,
  };
  for (let p = 0; p < perguntas.length; p += 1) {
    const [nome, q] = perguntas[p];
    const { criterios, inicio } = indices[p];
    const sims = criterios.map((_, i) => cosseno(vEstado, vetores[inicio + i]));
    const rotulos = criterios.map((c) => c.rotulo);
    const zero = Object.fromEntries(rotulos.map((r) => [r, 0]));
    softmax(sims, tauZeroShot).forEach((pr, i) => {
      zero[rotulos[i]] = pr;
    });
    let probabilidades = zero;
    let evidencia = 0;
    if (memoria) {
      const viz = await memoria.vizinhos(nome, vEstado, K_VIZINHOS);
      const votos = votosDaMemoria(viz, rotulos);
      probabilidades = misturar(zero, votos);
      evidencia = votos.evidencia;
    }
    answers[nome] = responder(q, rotulos, probabilidades, evidencia);
  }
  return { model: 'jev-nosso-1', answers, usage };
}

function validarPergunta(nome, q) {
  if (!q || typeof q !== 'object') throw new Error(`pergunta ${nome}: objeto esperado`);
  if (q.type === 'choice') {
    const n = Object.keys(q.criteria ?? {}).length;
    if (n < 2 || n > 255) throw new Error(`pergunta ${nome}: choice precisa de 2 a 255 critérios`);
  } else if (q.type === 'score') {
    const n = Array.isArray(q.criteria) ? q.criteria.length : 0;
    if (n < 2 || n > 10) throw new Error(`pergunta ${nome}: score precisa de 2 a 10 níveis`);
  } else if (q.type !== 'noul') {
    throw new Error(`pergunta ${nome}: type deve ser choice, score ou noul`);
  }
}

/** Os critérios como [{ rotulo, texto }], na ordem da pergunta. */
export function criteriosDe(q) {
  const instrucao = typeof q.instructions === 'string' ? q.instructions : '';
  const com = (texto) => (instrucao ? `${instrucao}. ${texto}` : texto);
  if (q.type === 'choice') {
    return Object.entries(q.criteria).map(([rotulo, v]) => ({
      rotulo,
      texto: com(textoDoCriterio(v, rotulo)),
    }));
  }
  if (q.type === 'score') {
    return q.criteria.map((v, i) => ({
      rotulo: String(i),
      texto: com(textoDoCriterio(v, `nível ${i}`)),
    }));
  }
  // noul: critérios "true"/"false"; sem eles, a própria instrução e a sua negação.
  const c = q.criteria ?? {};
  const sim = c.true ?? instrucao ?? 'sim';
  const nao = c.false ?? (instrucao ? `não: ${instrucao}` : 'não');
  return [
    { rotulo: 'true', texto: textoDoCriterio(sim, 'sim') },
    { rotulo: 'false', texto: textoDoCriterio(nao, 'não') },
  ];
}

function responder(q, rotulos, probabilidades, evidencia) {
  if (q.type === 'choice') {
    const choice = rotulos.reduce(
      (m, r) => (probabilidades[r] > probabilidades[m] ? r : m),
      rotulos[0],
    );
    return {
      type: 'choice',
      choice,
      confidence: confiancaDe(probabilidades),
      probabilities: probabilidades,
      evidence: evidencia,
    };
  }
  if (q.type === 'score') {
    const legend = Object.fromEntries(q.criteria.map((v, i) => [String(i), textoDoCriterio(v)]));
    const score = rotulos.reduce((s, r) => s + Number(r) * probabilidades[r], 0);
    return {
      type: 'score',
      score,
      confidence: confiancaDe(probabilidades),
      legend,
      probabilities: probabilidades,
      evidence: evidencia,
    };
  }
  return { type: 'noul', noul: probabilidades.true ?? 0, evidence: evidencia };
}
